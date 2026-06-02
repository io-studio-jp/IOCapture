import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { writeFile, rm, mkdtemp } from 'fs/promises'
import { copyFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog, screen, BrowserWindow } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { getArtworkView } from './artworkView'
import { drawCursor } from './cursorSprite'
import type { TargetSize } from '../shared/resolution'

const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

// 作品ビューのフレームを直接取得してffmpegへ供給する録画。OSカーソルは含まれず、
// ウィンドウのタイトルバー等のズレも無い。出力解像度は各フレームをresizeして厳密に合わせる。
let ffmpeg: ChildProcessWithoutNullStreams | null = null
let writer: ReturnType<typeof setInterval> | null = null
let subscribed = false
let latest: Electron.NativeImage | null = null
let tmpDir = ''
let videoPath = ''
let size: TargetSize = { width: 0, height: 0 }
let withCursor = false

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
): Promise<{ ok: boolean; error?: string }> {
  const view = getArtworkView()
  if (!view) return { ok: false, error: 'view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (ffmpeg) return { ok: false, error: 'already recording' }

  withCursor = includeCursor
  // 偶数寸法（H.264が要求）に丸める。
  size = { width: Math.round(target.width / 2) * 2, height: Math.round(target.height / 2) * 2 }

  tmpDir = await mkdtemp(join(tmpdir(), 'iocapture-'))
  videoPath = join(tmpDir, 'video.mp4')

  ffmpeg = spawn(ffmpegPath, [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'bgra',
    '-video_size', `${size.width}x${size.height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    videoPath,
  ])
  ffmpeg.stdin.on('error', () => {}) // EPIPE等は無視（停止時に閉じるため）
  ffmpeg.on('error', () => {})

  const wc = view.webContents
  wc.beginFrameSubscription(false, (image) => {
    latest = image
  })
  subscribed = true

  // 一定間隔で最新フレームを目標解像度に整えて書き込む（出力fpsを一定に保つ）。
  const cursorScale = Math.max(2, Math.round(size.height / 540))
  writer = setInterval(() => {
    if (!latest || !ffmpeg) return
    const frame = latest.resize({ width: size.width, height: size.height, quality: 'good' })
    const buf = frame.toBitmap()
    if (withCursor) {
      const c = cursorInFrame()
      if (c) drawCursor(buf, size.width, size.height, c.x, c.y, cursorScale)
    }
    // バックプレッシャー時はドロップしてメモリ肥大を防ぐ。
    if (ffmpeg.stdin.writable) ffmpeg.stdin.write(buf)
  }, Math.round(1000 / fps))

  return { ok: true }
}

function stopCaptureLoop(): void {
  const view = getArtworkView()
  if (subscribed) {
    view?.webContents.endFrameSubscription()
    subscribed = false
  }
  if (writer) {
    clearInterval(writer)
    writer = null
  }
  latest = null
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

    // 音声があれば mux する。
    if (audio && audio.byteLength > 0 && ffmpegPath) {
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
          '-shortest',
          mixedPath,
        ])
        mux.on('close', (code) => (code === 0 ? resolve() : reject(new Error('mux failed'))))
        mux.on('error', reject)
      })
      finalPath = mixedPath
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.mp4`,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
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
