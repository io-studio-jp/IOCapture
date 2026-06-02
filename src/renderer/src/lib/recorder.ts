import type { Rect } from '../../../shared/frameRect'
import type { TargetSize } from '../../../shared/resolution'

export type RecordHandle = {
  stop: () => Promise<{ blob: Blob; hadAudio: boolean }>
}

export async function startRecording(
  frameRect: Rect,
  target: TargetSize,
  inset: { x: number; y: number } = { x: 0, y: 0 },
  fps = 30,
): Promise<RecordHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const hadAudio = stream.getAudioTracks().length > 0

  const videoEl = document.createElement('video')
  videoEl.srcObject = new MediaStream(stream.getVideoTracks())
  videoEl.muted = true
  await videoEl.play()

  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')!

  // desktopCapturerはウィンドウ外枠（タイトルバー込み）を撮るため、frameRect（コンテンツ
  // 領域基準のCSSpx）に inset（タイトルバー高さ等）を足してから device px に変換する。
  const sx = (frameRect.x + inset.x) * dpr
  const sy = (frameRect.y + inset.y) * dpr
  const sw = frameRect.width * dpr
  const sh = frameRect.height * dpr

  let raf = 0
  const draw = (): void => {
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    raf = requestAnimationFrame(draw)
  }
  draw()

  const outStream = canvas.captureStream(fps)
  if (hadAudio) outStream.addTrack(stream.getAudioTracks()[0])

  const chunks: Blob[] = []
  const rec = new MediaRecorder(outStream, { mimeType: 'video/webm;codecs=vp9,opus' })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(100)

  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          cancelAnimationFrame(raf)
          stream.getTracks().forEach((t) => t.stop())
          outStream.getTracks().forEach((t) => t.stop())
          resolve({ blob: new Blob(chunks, { type: 'video/webm' }), hadAudio })
        }
        rec.stop()
      }),
  }
}
