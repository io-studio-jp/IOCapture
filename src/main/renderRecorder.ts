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
  unfreezeArtworkPreview,
} from './artworkView'
import { setVirtualRenderMode } from './renderState'
import type { StartRenderArgs, StopFrameCaptureResult, RenderProgress } from '../shared/ipc-types'

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

/** 作品ビューを仮想時計モードでリロードし、window.__iocapRender.ready が立つまで待つ。 */
async function reloadIntoVirtualMode(): Promise<void> {
  const view = getArtworkView()
  if (!view) throw new Error('artwork view not ready')
  const wc = view.webContents
  setVirtualRenderMode(true)
  wc.reload()
  // 最初のポーリングは少し待ってからにする(リロードの起動を待つ)。
  await new Promise((r) => setTimeout(r, 300))
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const ready = await wc
      .executeJavaScript(`!!(window.__iocapRender && window.__iocapRender.ready)`)
      .catch(() => false)
    if (ready) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('virtual clock not ready after 15s (artwork load timeout)')
}

/** 作品ビューをライブモードに戻す。 */
function reloadIntoLiveMode(): void {
  const view = getArtworkView()
  if (!view) return
  setVirtualRenderMode(false)
  view.webContents.reload()
}

// 辺長を2の倍数に丸める(libx264はodd幅を拒否する)。最小2px。
const round2 = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export async function startRender(args: StartRenderArgs): Promise<StopFrameCaptureResult> {
  const { target, fps, durationSec, format } = args

  const view = getArtworkView()
  if (!view) return { ok: false, error: 'artwork view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (active) return { ok: false, error: 'already rendering' }

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
    // 1. リロード前にライブの見た目でプレビューを固定する(ユーザーに再起動が見えない)。
    await freezeArtworkPreview()

    // 2. 仮想時計モードでリロード。
    await reloadIntoVirtualMode()

    // 3. キャプチャサーフェスを確保(内部のfreezeはfrozenフラグで既にスキップされる)。
    surface = await acquireCaptureSurface(size)

    // 4. 一時ディレクトリとffmpegプロセスを準備する。
    const ext = format === 'webp' ? 'webp' : 'mp4'
    tmpDir = await mkdtemp(join(tmpdir(), 'iocapture-render-'))
    const videoPath = join(tmpDir, `video.${ext}`)

    // CFR入力: 仮想時計で正確なフレームレートが保証されるため固定fps入力を使う。
    const inputArgs = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'bgra',
      '-video_size', `${size.width}x${size.height}`,
      '-framerate', String(fps),
      '-i', 'pipe:0',
      '-an',
    ]
    // オフラインなので品質優先のエンコード設定。
    const encodeArgs: string[] =
      format === 'webp'
        ? ['-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '4']
        : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '15', '-movflags', '+faststart', '-r', String(fps)]

    proc = spawn(ffmpegPath, [...inputArgs, ...encodeArgs, videoPath]) as ChildProcessWithoutNullStreams
    proc.stdin.on('error', () => {}) // EPIPE等は無視(停止時にstdinを閉じるため)
    proc.on('error', () => {})

    const wc = view.webContents

    // 5. フレームループ: 仮想時計を1フレームずつ進めて撮影する。
    for (let i = 0; i < total; i++) {
      if (cancelRequested) break

      // step()は1フレーム進んで実際の描画が完了したら解決するPromise。
      const stepped = await Promise.race<boolean>([
        wc
          .executeJavaScript(`window.__iocapRender.step(${1000 / fps})`)
          .then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), STEP_TIMEOUT_MS)),
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

      if (!proc.stdin.writable) break
      if (!proc.stdin.write(buf)) {
        await once(proc.stdin, 'drain') // バックプレッシャー: 受け取れるまで待つ
      }

      // 進捗通知: 10フレームごとと最終フレーム。
      if (i % 10 === 0 || i === total - 1) {
        sendProgress({ frame: i + 1, total })
      }
    }

    // 6. stdin終了 → ffmpeg書き出し完了を待つ。
    proc.stdin.end()
    await once(proc, 'close')

    if (cancelRequested) {
      return { ok: false, canceled: true }
    }

    // 7. 保存ダイアログ → ファイルをコピー。
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `render-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (canceled || !filePath) {
      return { ok: false, canceled: true }
    }
    await copyFile(videoPath, filePath)
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    // ffmpegプロセスが残っていたら強制終了する。
    if (proc && !proc.killed) {
      proc.stdin.destroy()
      proc.kill()
    }
    return { ok: false, error: String(e) }
  } finally {
    // ORDER MATTERS:
    // 1. active解除
    active = false
    // 2. 一時ディレクトリを削除
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    // 3. ライブモードへ復帰(実時間に戻り始める)
    reloadIntoLiveMode()
    // 4. サーフェス解放(bounds/zoom復元+120ms待機+unfreeze)
    await surface?.release().catch(() => {})
    // 5. プレビュー固定を解除(native-pathではreleaseがno-opでunfreezeしないため必要)
    unfreezeArtworkPreview()
  }
}
