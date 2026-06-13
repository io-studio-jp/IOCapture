import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { once } from 'events'
import { nativeImage } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import {
  acquireCaptureSurface,
  getArtworkView,
  getMainWindow,
  freezeArtworkPreview,
  unfreezeArtworkPreview,
  setArtworkBoundsLocked
} from './artworkView'
import { showSaveDialogAttached } from './saveDialog'
import { planSupersample } from '../shared/supersample'
import { sumInto, averageToBuffer } from '../shared/frameBlend'
import type { StartRenderArgs, RenderResult, RenderProgress } from '../shared/ipc-types'

const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

// 1フレームのstep+描画にかけてよい上限。超えたら作品の暴走とみなして中断する。
const STEP_TIMEOUT_MS = 5000
// モーションブラーのシャッター角(180°=フレーム間隔の前半だけ露光する映画の標準)。
const SHUTTER = 0.5
// ライブプレビュー更新の最小間隔(ms)とプレビュー長辺。撮影中ステージに実フレームを流す用。
const PREVIEW_INTERVAL_MS = 100
const PREVIEW_MAX_EDGE = 480

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

// 進捗モーダルの表示/非表示。viewが画面外へ退避している間だけtrueにする
// (開始直後/終了直後にviewが画面内へ戻る瞬間にモーダルが被らないようにするため)。
function sendOverlay(visible: boolean): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('render:overlay', visible)
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
  // モーションブラーのサブフレーム数(1=Off)。不正値は1に丸め、暴走防止に上限16でクランプ
  const samples = Number.isFinite(args.blurSamples)
    ? Math.min(16, Math.max(1, Math.floor(args.blurSamples)))
    : 1

  const view = getArtworkView()
  if (!view) return { ok: false, error: 'artwork view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (active) return { ok: false, error: 'already rendering' }

  // スリバー退避中もrAF/コンポジットを止めさせない(オフスクリーン扱いで
  // 実rAFが停止するとstepの描画待ちがタイムアウトする)。
  view.webContents.setBackgroundThrottling(false)
  // 撮影中はリサイズ由来のbounds変更を無視する(退避ビューの画面せり出し・座標崩れ防止)。
  setArtworkBoundsLocked(true)

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
    // SSAA時は2倍で描画し、各フレームをsizeへ高品質縮小する。
    // offscreen: nativeでも撮影中はviewを画面外へ退避し、進捗モーダルを前面に出せるようにする。
    surface = await acquireCaptureSurface(planSupersample(size, args.supersample === true), {
      offscreen: true
    })
    // viewを退避し終えた(=隠れた)ので進捗オーバーレイを表示してよい。
    sendOverlay(true)

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
    // mp4はRGB→YUVの変換行列をBT.709に明示し、色空間タグも付ける(プレイヤー間の色ズレ防止。
    // 明示しないとffmpegがBT.601系を選ぶことがあり、HD再生で彩度がわずかにずれる)。
    const encodeArgs: string[] =
      format === 'webp'
        ? ['-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '4']
        : [
            '-vf',
            'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-preset',
            'medium',
            '-crf',
            '15',
            '-colorspace',
            'bt709',
            '-color_primaries',
            'bt709',
            '-color_trc',
            'bt709',
            '-color_range',
            'tv',
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

    // step()は仮想時刻をms進め、実際の描画が完了したら解決する(暴走はタイムアウトで中断)。
    const stepVirtual = async (ms: number, frameIndex: number): Promise<void> => {
      const stepped = await Promise.race<boolean>([
        wc.executeJavaScript(`window.__iocapRender.step(${ms})`).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), STEP_TIMEOUT_MS))
      ])
      if (!stepped) throw new Error(`frame ${frameIndex}: step timed out (artwork not responding)`)
    }

    // capturePage → サイズ不一致時は高品質リサイズ → stride再パックでタイトなBGRAを返す。
    // SSAA時はここでの縮小がアンチエイリアスになる(平均と縮小は線形なのでブラーとの順序は等価)。
    const captureTightFrame = async (): Promise<Buffer> => {
      const image = await wc.capturePage()
      const ps = image.getSize()
      const frame =
        ps.width !== size.width || ps.height !== size.height
          ? image.resize({ width: size.width, height: size.height, quality: 'best' })
          : image
      const raw = frame.toBitmap()
      if (raw.length === expected) return raw
      const stride = Math.floor(raw.length / size.height)
      const tight = Buffer.allocUnsafe(expected)
      for (let y = 0; y < size.height; y++) {
        raw.copy(tight, y * rowBytes, y * stride, y * stride + rowBytes)
      }
      return tight
    }

    // モーションブラー用のアキュムレータ(毎フレームの確保を避けるため使い回す)。
    const acc = samples > 1 ? new Uint32Array(expected) : null

    const frameMs = 1000 / fps

    // ライブプレビュー: 実際の出力フレームを縮小して進捗モーダルへ流す(render:preview)。
    // 重いので最小間隔で間引く。
    let lastPreviewMs = 0
    const sendPreview = (buf: Buffer): void => {
      const now = Date.now()
      if (now - lastPreviewMs < PREVIEW_INTERVAL_MS) return
      lastPreviewMs = now
      const win = getMainWindow()
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
      try {
        const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(size.width, size.height))
        const preview = nativeImage
          .createFromBitmap(buf, { width: size.width, height: size.height })
          .resize({ width: Math.max(1, Math.round(size.width * scale)) })
        win.webContents.send('render:preview', preview.toDataURL())
      } catch {
        // プレビュー生成失敗は無視(撮影は続行)
      }
    }

    // 5. フレームループ: 仮想時計を1フレームずつ進めて撮影する。
    for (let i = 0; i < total; i++) {
      if (cancelRequested) break

      let buf: Buffer
      if (acc) {
        // モーションブラー: シャッター開(フレーム前半)をsamples分割して撮影・加算し、
        // シャッター閉(後半)は時間だけ進める。平均が1フレームになる。
        acc.fill(0)
        for (let s = 0; s < samples && !cancelRequested; s++) {
          await stepVirtual((frameMs * SHUTTER) / samples, i)
          sumInto(acc, await captureTightFrame())
        }
        if (cancelRequested) break
        await stepVirtual(frameMs * (1 - SHUTTER), i)
        buf = averageToBuffer(acc, samples)
      } else {
        await stepVirtual(frameMs, i)
        buf = await captureTightFrame()
      }

      // 撮ったフレームでプレビューを更新する(間引きあり)。
      sendPreview(buf)

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
    const { canceled, filePath } = await showSaveDialogAttached({
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
    // 5. viewが画面内へ戻る前にモーダルを閉じる(戻る瞬間の作品チラ見えを防ぐ)。
    sendOverlay(false)
    // 6. サーフェス解放(bounds/zoom復元+120ms待機+unfreeze)
    await surface?.release().catch(() => {})
    // 6. プレビュー固定を解除(native-pathではreleaseがno-opでunfreezeしないため必要)
    unfreezeArtworkPreview()
    // 7. リサイズロック解除(releaseでboundsを最新へ戻した後に解く)
    setArtworkBoundsLocked(false)
  }
}
