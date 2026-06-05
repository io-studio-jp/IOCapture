import type { TargetSize } from '../../../shared/resolution'
import type { Rect } from '../../../shared/frameRect'

export type RecordResult = { mp4Path: string } | { canceled?: boolean; error?: string }
export type RecordHandle = {
  hadAudio: boolean
  stop: () => Promise<RecordResult>
}

/**
 * Smooth方式: OSのウィンドウ画面録画(desktopCapturer)をcanvasで枠にクロップして録る。
 * 60fps級に滑らかだが、本物のカーソルが入り、解像度は表示ピクセル基準。停止時にMainでmp4化。
 */
export async function startWindowRecording(
  frameRect: Rect,
  target: TargetSize,
  inset: { x: number; y: number },
  format: 'mp4' | 'webp' = 'mp4',
  recordAudio = true,
  fps = 60,
): Promise<RecordHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } } as MediaTrackConstraints,
    audio: recordAudio,
  })
  const hadAudio = stream.getAudioTracks().length > 0

  const videoEl = document.createElement('video')
  videoEl.srcObject = new MediaStream(stream.getVideoTracks())
  videoEl.muted = true
  await videoEl.play()

  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(target.width / 2) * 2
  canvas.height = Math.round(target.height / 2) * 2
  const ctx = canvas.getContext('2d')!
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
  const pixels = canvas.width * canvas.height
  const bitrate = Math.min(40_000_000, Math.max(8_000_000, Math.round(pixels * fps * 0.12)))
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm'
  const chunks: Blob[] = []
  const rec = new MediaRecorder(outStream, { mimeType: mime, videoBitsPerSecond: bitrate })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(100)

  return {
    hadAudio,
    stop: () =>
      new Promise<RecordResult>((resolve) => {
        rec.onstop = async () => {
          cancelAnimationFrame(raf)
          stream.getTracks().forEach((t) => t.stop())
          outStream.getTracks().forEach((t) => t.stop())
          const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
          const res = await window.capture.saveWebmAsMp4(buf, format)
          if (res.ok) resolve({ mp4Path: res.mp4Path })
          else resolve({ canceled: res.canceled, error: res.error })
        }
        rec.stop()
      }),
  }
}

/**
 * 動画録画（唯一の方式）。映像はMainが作品ビューのフレームを直接取得して生成する
 * （枠ピッタリ・解像度自由）。includeCursorがtrueのときはMainが各フレームに矢印カーソルを
 * 合成する。音声のみrendererでループバック録音し、停止時にMainで合成する。
 */
export async function startRecording(
  target: TargetSize,
  includeCursor = false,
  format: 'mp4' | 'webp' = 'mp4',
  recordAudio = true,
  fps = 60,
): Promise<RecordHandle> {
  const started = await window.capture.startFrameCapture(target, fps, includeCursor, format)
  if (!started.ok) throw new Error(started.error || 'failed to start frame capture')

  // 音声のみ録音（システム音声ループバック）。映像トラックは使わないので停止する。
  // WebPは画像形式で音声を持てないため録音しない。
  let audioRec: MediaRecorder | null = null
  let audioStream: MediaStream | null = null
  const chunks: Blob[] = []
  let hadAudio = false
  try {
    if (format === 'webp' || !recordAudio) throw new Error('skip audio')
    audioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    audioStream.getVideoTracks().forEach((t) => t.stop())
    const audioTracks = audioStream.getAudioTracks()
    if (audioTracks.length) {
      hadAudio = true
      audioRec = new MediaRecorder(new MediaStream([audioTracks[0]]), {
        mimeType: 'audio/webm;codecs=opus',
      })
      audioRec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      audioRec.start(100)
    }
  } catch {
    hadAudio = false
  }

  return {
    hadAudio,
    stop: async () => {
      let audioBuf: ArrayBuffer | null = null
      if (audioRec) {
        await new Promise<void>((resolve) => {
          audioRec!.onstop = () => resolve()
          audioRec!.stop()
        })
        audioBuf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer()
      }
      audioStream?.getTracks().forEach((t) => t.stop())
      const res = await window.capture.stopFrameCapture(audioBuf)
      if (res.ok) return { mp4Path: res.mp4Path }
      return { canceled: res.canceled, error: res.error }
    },
  }
}
