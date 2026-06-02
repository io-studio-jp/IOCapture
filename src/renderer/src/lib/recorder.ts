import type { Rect } from '../../../shared/frameRect'
import type { TargetSize } from '../../../shared/resolution'

export type RecordHandle = {
  stop: () => Promise<{ blob: Blob; hadAudio: boolean }>
}

export async function startRecording(
  frameRect: Rect,
  target: TargetSize,
  inset: { x: number; y: number } = { x: 0, y: 0 },
  hideCursor = false,
  fps = 60,
): Promise<RecordHandle> {
  // 高いフレームレートを要求し、hideCursor時はOSのキャプチャ設定でカーソルを
  // ストリームから除外する（画面上のカーソルは消えない＝操作はしやすいまま、録画にだけ入らない）。
  const video = {
    frameRate: { ideal: fps },
    ...(hideCursor ? { cursor: 'never' } : {}),
  } as MediaTrackConstraints
  const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true })
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

  // 高解像度でもfpsを保ちやすいよう、軽いVP8＋十分なビットレートを指定する。
  const pixels = target.width * target.height
  const bitrate = Math.min(40_000_000, Math.max(8_000_000, Math.round(pixels * fps * 0.12)))
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm'
  const chunks: Blob[] = []
  const rec = new MediaRecorder(outStream, { mimeType: mime, videoBitsPerSecond: bitrate })
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
