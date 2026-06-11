import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { once } from 'events'
import ffmpegStatic from 'ffmpeg-static'
import {
  acquireCaptureSurface,
  getArtworkView,
  getMainWindow,
  freezeArtworkPreview,
  unfreezeArtworkPreview
} from './artworkView'
import type { StartRenderArgs, RenderResult, RenderProgress } from '../shared/ipc-types'

const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

// 1フレームのstep+描画にかけてよい上限。超えたら作品の暴走とみなして中断する。
const STEP_TIMEOUT_MS = 5000

let active = false
let cancelRequested = false

export function isRendering(): boolean {
  return active
}

export function cancelRender(): void {
  cancelRequested = true
}

function sendProgress(p: RenderProgress): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('render:progress', p)
}

/** 常時注入済みの時計シムをその場で仮想モードへ切替える(リロード無し=作品の状態を保持)。 */
async function engageVirtualClock(wc: Electron.WebContents): Promise<void> {
  const ready = await wc
    .executeJavaScript(`!!(window.__iocapRender && window.__iocapRender.ready)`)
    .catch(() => false)
  if (!ready) {
    // シムはpreloadで常時注入されるため、無いのは旧セッションのページ等の例外ケースのみ。
    throw new Error('artwork preload not active — reload the artwork page once and retry')
  }
  await wc.executeJavaScript(`window.__iocapRender.engage()`)
}

/** 実時間動作へ復帰する(仮想モードでなければ何もしない)。 */
function disengageVirtualClock(): void {
  const wc = getArtworkView()?.webContents
  if (!wc || wc.isDestroyed()) return
  wc.executeJavaScript(`window.__iocapRender && window.__iocapRender.disengage()`).catch(() => {})
}

// 辺長を2の倍数に丸める(libx264はodd幅を拒否する)。最小2px。
const round2 = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export async function startRender(args: StartRenderArgs): Promise<RenderResult> {
  const { target, fps, durationSec, format } = args

  const view = getArtworkView()
  if (!view) return { ok: false, error: 'artwork view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (active) return { ok: false, error: 'already rendering' }

  // スリバー退避中もrAF/コンポジットを止めさせない(オフスクリーン扱いで
  // 実rAFが停止するとstepの描画待ちがタイムアウトする)。
  view.webContents.setBackgroundThrottling(false)

  active = true
  cancelRequested = false

  const size = { width: round2(target.width), height: round2(target.height) }
  const total = Math.max(1, Math.round(durationSec * fps))
  const rowBytes = size.width * 4
  const expected = rowBytes * size.height

  let tmpDir = ''
  let proc: ChildProcessWithoutNullStreams | null = null
  let surface: Awaited<ReturnType<typeof acquireCaptureSurface>> | null = null

  try {
    // 1. 現在の見た目でプレビューを固定する(録画中のサーフェス操作をユーザーに見せない)。
    await freezeArtworkPreview()

    // 2. 時計シムをその場で仮想モードへ(リロード無し=作品の状態・パラメータを保持)。
    await engageVirtualClock(view.webContents)

    // 3. キャプチャサーフェスを確保(内部のfreezeはfrozenフラグで既にスキップされる)。
    surface = await acquireCaptureSurface(size)

    // 4. 一時ディレクトリとffmpegプロセスを準備する。
    const ext = format === 'webp' ? 'webp' : 'mp4'
    tmpDir = await mkdtemp(join(tmpdir(), 'iocapture-render-'))
    const videoPath = join(tmpDir, `video.${ext}`)

    // CFR入力: 仮想時計で正確なフレームレートが保証されるため固定fps入力を使う。
    const inputArgs = [
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'bgra',
      '-video_size',
      `${size.width}x${size.height}`,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-an'
    ]
    // オフラインなので品質優先のエンコード設定。
    const encodeArgs: string[] =
      format === 'webp'
        ? ['-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '4']
        : [
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-preset',
            'medium',
            '-crf',
            '15',
            '-movflags',
            '+faststart',
            '-r',
            String(fps)
          ]

    proc = spawn(ffmpegPath, [
      ...inputArgs,
      ...encodeArgs,
      videoPath
    ]) as ChildProcessWithoutNullStreams
    // closeはspawn直後に待ち受けておく。ループ中にffmpegが落ちてもイベントを取り逃さない。
    // spawn失敗('error'イベント)でもrejectせず-1に潰してawait側で扱う。
    const closed: Promise<number | null> = once(proc, 'close').then(
      ([code]) => code as number | null,
      () => -1
    )
    proc.stdin.on('error', () => {}) // EPIPE等は無視(停止時にstdinを閉じるため)
    proc.on('error', () => {})

    const wc = view.webContents

    // ffmpegがフレームを受け取れなくなった等、キャンセル以外の早期離脱の理由。
    let aborted: string | null = null

    // 5. フレームループ: 仮想時計を1フレームずつ進めて撮影する。
    for (let i = 0; i < total; i++) {
      if (cancelRequested) break

      // step()は1フレーム進んで実際の描画が完了したら解決するPromise。
      const stepped = await Promise.race<boolean>([
        wc.executeJavaScript(`window.__iocapRender.step(${1000 / fps})`).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), STEP_TIMEOUT_MS))
      ])
      if (!stepped) {
        throw new Error(`frame ${i}: step timed out (artwork not responding)`)
      }

      // capturePage → サイズ不一致時は高品質リサイズ → stride再パック → ffmpegへ書き込み。
      const image = await wc.capturePage()
      const ps = image.getSize()
      const frame =
        ps.width !== size.width || ps.height !== size.height
          ? image.resize({ width: size.width, height: size.height, quality: 'best' })
          : image
      const raw = frame.toBitmap()
      // toBitmapは行にストライドパディングが入ることがある。ffmpegは幅×4でタイトに読むので詰め直す。
      let buf: Buffer = raw
      if (raw.length !== expected) {
        const stride = Math.floor(raw.length / size.height)
        const tight = Buffer.allocUnsafe(expected)
        for (let y = 0; y < size.height; y++) {
          raw.copy(tight, y * rowBytes, y * stride, y * stride + rowBytes)
        }
        buf = tight
      }

      if (!proc.stdin.writable) {
        aborted = 'ffmpeg stdin closed unexpectedly'
        break
      }
      if (!proc.stdin.write(buf)) {
        // バックプレッシャー: 受け取れるまで待つ。ffmpegが死んだ場合もclosedで抜ける。
        await Promise.race([once(proc.stdin, 'drain'), closed])
        if (proc.exitCode !== null) {
          aborted = `ffmpeg exited early (code ${proc.exitCode})`
          break
        }
      }

      // 進捗通知: 10フレームごとと最終フレーム。
      if (i % 10 === 0 || i === total - 1) {
        sendProgress({ frame: i + 1, total })
      }
    }

    // 6. stdin終了 → ffmpeg書き出し完了を待つ(既に終了していればendは不要)。
    if (proc.exitCode === null) proc.stdin.end()
    const code = await closed

    if (cancelRequested) {
      return { ok: false, canceled: true }
    }
    if (aborted) {
      return { ok: false, error: aborted }
    }
    if (code !== 0) {
      return { ok: false, error: `ffmpeg failed (code ${code})` }
    }

    // 7. 保存ダイアログ → ファイルをコピー。
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `render-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (canceled || !filePath) {
      return { ok: false, canceled: true }
    }
    await copyFile(videoPath, filePath)
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    // ffmpegプロセスが残っていたら強制終了する。
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.stdin.destroy()
      proc.kill()
    }
    // 準備中にキャンセルされた場合はエラーではなくキャンセル扱いにする。
    if (cancelRequested) return { ok: false, canceled: true }
    return { ok: false, error: String(e) }
  } finally {
    // ORDER MATTERS:
    // 1. active解除
    active = false
    // 2. 一時ディレクトリを削除
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    // 3. 時計シムを実時間へ復帰(リロード無し。作品はその状態のまま動き出す)
    disengageVirtualClock()
    // 4. バックグラウンドスロットリングを通常運用に戻す
    try {
      if (!view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(true)
    } catch {
      // 破棄競合等は無視(復帰処理を止めない)
    }
    // 5. サーフェス解放(bounds/zoom復元+120ms待機+unfreeze)
    await surface?.release().catch(() => {})
    // 6. プレビュー固定を解除(native-pathではreleaseがno-opでunfreezeしないため必要)
    unfreezeArtworkPreview()
  }
}
