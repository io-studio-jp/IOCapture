import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { writeFile, rm, mkdtemp } from 'fs/promises'
import { copyFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog, screen, BrowserWindow } from 'electron'
import { once } from 'events'
import ffmpegStatic from 'ffmpeg-static'
import { getArtworkView } from './artworkView'
import { drawCursor, ARROW_ROWS } from './cursorSprite'
import type { TargetSize } from '../shared/resolution'

const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

// 作品ビューのフレームを直接取得してffmpegへ供給する録画。OSカーソルは含まれず、
// ウィンドウのタイトルバー等のズレも無い。出力解像度は各フレームをresizeして厳密に合わせる。
let ffmpeg: ChildProcessWithoutNullStreams | null = null
let tmpDir = ''
let videoPath = ''
let size: TargetSize = { width: 0, height: 0 }
let withCursor = false
let format: 'mp4' | 'webp' = 'mp4'
let stopped = false

export function isFrameRecording(): boolean {
  return ffmpeg !== null
}

// カーソル位置を作品ビュー内のフレーム座標(目標解像度)に変換する。範囲外ならnull。
function cursorInFrame(): { x: number; y: number } | null {
  const view = getArtworkView()
  const win = BrowserWindow.getAllWindows()[0]
  if (!view || !win) return null
  const vb = view.getBounds()
  if (vb.width <= 0 || vb.height <= 0) return null
  const content = win.getContentBounds()
  const p = screen.getCursorScreenPoint()
  const fx = (p.x - (content.x + vb.x)) / vb.width
  const fy = (p.y - (content.y + vb.y)) / vb.height
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
  return { x: Math.round(fx * size.width), y: Math.round(fy * size.height) }
}

export async function startFrameCapture(
  target: TargetSize,
  fps: number,
  includeCursor = false,
  fmt: 'mp4' | 'webp' = 'mp4',
): Promise<{ ok: boolean; error?: string }> {
  const view = getArtworkView()
  if (!view) return { ok: false, error: 'view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (ffmpeg) return { ok: false, error: 'already recording' }

  withCursor = includeCursor
  format = fmt

  // 実際にキャプチャできる解像度を測り、targetがそれを超える場合はアップスケールしない
  // （引き伸ばし＋ロス圧縮による「ガビガビ」を防ぐ）。viewはframeと同アスペクトなので
  // 幅基準のスケールでアスペクトは保たれる。
  const round2 = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  let nativeW = target.width
  try {
    const probe = await view.webContents.capturePage()
    const ps = probe.getSize()
    const bm = probe.toBitmap()
    const sf = Math.sqrt(bm.length / 4 / Math.max(1, ps.width * ps.height)) // 実DPR
    nativeW = Math.max(2, ps.width * sf)
  } catch {
    // 測定失敗時はtargetのまま
  }
  const fit = Math.min(1, nativeW / target.width)
  size = { width: round2(target.width * fit), height: round2(target.height * fit) }

  tmpDir = await mkdtemp(join(tmpdir(), 'iocapture-'))
  videoPath = join(tmpDir, format === 'webp' ? 'video.webp' : 'video.mp4')

  // 入力は生BGRAフレーム。到着した実時刻(wall-clock)でタイムスタンプを付けるので、
  // フレーム取得が遅れても「実時間どおりの再生速度」になる（固定fps前提の速回しが起きない）。
  // PNGエンコードを挟まないぶん軽い。
  const inputArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'bgra',
    '-video_size', `${size.width}x${size.height}`,
    '-use_wallclock_as_timestamps', '1',
    '-i', 'pipe:0',
    '-an',
  ]
  const encodeArgs =
    format === 'webp'
      ? // アニメーションWebP（音声なし・ループ）。ロスレス＋速度寄りの圧縮レベルでフレーム落ちを抑える。
        ['-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '2', '-vsync', 'vfr']
      : // H.264 / mp4。実時間の可変フレームレートを保持（再生速度が正しい）。
        ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '16', '-movflags', '+faststart', '-vsync', 'vfr']

  ffmpeg = spawn(ffmpegPath, [...inputArgs, ...encodeArgs, videoPath])
  const proc = ffmpeg
  proc.stdin.on('error', () => {}) // EPIPE等は無視（停止時に閉じるため）
  proc.on('error', () => {})

  const wc = view.webContents

  // 画面上のmacOSカーソル(約18ptの矢印)と同じ見かけサイズにする。
  const MACOS_CURSOR_CSS = 18
  const viewCssH = view.getBounds().height || size.height
  const cursorScale = (MACOS_CURSOR_CSS * size.height) / viewCssH / ARROW_ROWS
  const minIntervalMs = Math.round(1000 / fps)
  const rowBytes = size.width * 4
  const expected = rowBytes * size.height
  // 出力がネイティブ解像度と同じなら縮小不要（resizeコストを省く）。
  const needResize = size.width < Math.floor(nativeW) - 1

  // capturePage を回して各フレームの生BGRAを書き出す。バックプレッシャー時はdrainまで待つ
  // （スキップではなく待機なので、タイムスタンプ=実時間が保たれ再生速度が正しい）。
  stopped = false
  const captureLoop = async (): Promise<void> => {
    while (!stopped && ffmpeg === proc) {
      const t0 = Date.now()
      try {
        const image = await wc.capturePage()
        const frame = needResize
          ? image.resize({ width: size.width, height: size.height, quality: 'good' })
          : image
        const raw = frame.toBitmap()
        // toBitmapは行にパディング(stride)が入ることがある。ffmpegは幅×4でタイトに読むので詰め直す。
        let buf = raw
        if (raw.length !== expected) {
          const stride = Math.floor(raw.length / size.height)
          const tight = Buffer.allocUnsafe(expected)
          for (let y = 0; y < size.height; y++) {
            raw.copy(tight, y * rowBytes, y * stride, y * stride + rowBytes)
          }
          buf = tight
        }
        if (withCursor) {
          const c = cursorInFrame()
          if (c) drawCursor(buf, size.width, size.height, c.x, c.y, cursorScale)
        }
        if (stopped || ffmpeg !== proc || !proc.stdin.writable) break
        if (!proc.stdin.write(buf)) {
          await once(proc.stdin, 'drain') // バックプレッシャー: 受け取れるまで待つ
        }
      } catch {
        await new Promise((r) => setTimeout(r, 16))
      }
      // fpsを上限に（速すぎる無駄取りを防ぐ）。capturePageが遅ければ実時間で進む。
      const dt = Date.now() - t0
      if (dt < minIntervalMs) await new Promise((r) => setTimeout(r, minIntervalMs - dt))
    }
  }
  void captureLoop()

  return { ok: true }
}

function stopCaptureLoop(): void {
  stopped = true
}

/** 録画停止 → 映像確定 → （あれば）音声と合成 → 保存ダイアログ。 */
export async function stopFrameCapture(
  audio: ArrayBuffer | null,
): Promise<{ ok: true; mp4Path: string } | { ok: false; canceled?: boolean; error?: string }> {
  if (!ffmpeg) return { ok: false, error: 'not recording' }
  stopCaptureLoop()

  // ffmpeg(映像)を閉じて書き出し完了を待つ。
  const proc = ffmpeg
  ffmpeg = null
  await new Promise<void>((resolve) => {
    proc.on('close', () => resolve())
    proc.stdin.end()
  })

  try {
    let finalPath = videoPath

    // mp4 のみ音声を mux する（WebPは画像形式なので音声なし）。
    if (format === 'mp4' && audio && audio.byteLength > 0 && ffmpegPath) {
      const audioPath = join(tmpDir, 'audio.webm')
      const mixedPath = join(tmpDir, 'final.mp4')
      await writeFile(audioPath, Buffer.from(audio))
      await new Promise<void>((resolve, reject) => {
        const mux = spawn(ffmpegPath, [
          '-y',
          '-i', videoPath,
          '-i', audioPath,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '256k',
          '-shortest',
          mixedPath,
        ])
        mux.on('close', (code) => (code === 0 ? resolve() : reject(new Error('mux failed'))))
        mux.on('error', reject)
      })
      finalPath = mixedPath
    }

    const ext = format === 'webp' ? 'webp' : 'mp4'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (canceled || !filePath) {
      await cleanup()
      return { ok: false, canceled: true }
    }
    await copyFile(finalPath, filePath)
    await cleanup()
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    await cleanup()
    return { ok: false, error: String(e) }
  }
}

async function cleanup(): Promise<void> {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    tmpDir = ''
  }
}
