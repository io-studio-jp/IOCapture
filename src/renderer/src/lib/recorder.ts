import type { TargetSize } from '../../../shared/resolution'
import type { Rect } from '../../../shared/frameRect'
import { capToSourceWidth } from '../../../shared/videoResolution'
import { AUDIO_OFF, AUDIO_SYSTEM, type AudioSource } from '../../../shared/audioSource'

/** 指定deviceIdの音声入力トラックを取得する。失敗(未接続・権限拒否)はnull。 */
async function getDeviceAudioTrack(deviceId: string): Promise<MediaStreamTrack | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    })
    return stream.getAudioTracks()[0] ?? null
  } catch {
    return null
  }
}

export type RecordResult = { mp4Path: string } | { canceled?: boolean; error?: string }
export type RecordHandle = {
  hadAudio: boolean
  /** 実際に録画される解像度。表示中のビューの物理解像度が上限のため、要求targetより小さいことがある。 */
  size: TargetSize
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
  audioSource: AudioSource = AUDIO_SYSTEM,
  fps = 60,
): Promise<RecordHandle> {
  // 音声: system=画面録画のループバック / deviceId=入力デバイス / off=なし
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } } as MediaTrackConstraints,
    audio: audioSource === AUDIO_SYSTEM,
  })
  let audioTrack: MediaStreamTrack | null = stream.getAudioTracks()[0] ?? null
  if (audioSource !== AUDIO_SYSTEM && audioSource !== AUDIO_OFF) {
    audioTrack = await getDeviceAudioTrack(audioSource)
  }
  const hadAudio = audioTrack !== null

  const videoEl = document.createElement('video')
  videoEl.srcObject = new MediaStream(stream.getVideoTracks())
  videoEl.muted = true
  await videoEl.play()

  const dpr = window.devicePixelRatio || 1
  const sx = (frameRect.x + inset.x) * dpr
  const sy = (frameRect.y + inset.y) * dpr
  const sw = frameRect.width * dpr
  const sh = frameRect.height * dpr
  // ソース(クロップ領域の物理px)を超えるターゲットは引き伸ばさずキャップする
  // (拡大＋リアルタイムVP8圧縮による画質劣化を防ぐ。縮小はOK)。
  const outSize = capToSourceWidth(target, sw)
  const canvas = document.createElement('canvas')
  canvas.width = outSize.width
  canvas.height = outSize.height
  const ctx = canvas.getContext('2d')!

  let raf = 0
  const draw = (): void => {
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    raf = requestAnimationFrame(draw)
  }
  draw()

  const outStream = canvas.captureStream(fps)
  if (audioTrack) outStream.addTrack(audioTrack)
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
    size: outSize,
    stop: () =>
      new Promise<RecordResult>((resolve) => {
        rec.onstop = async () => {
          cancelAnimationFrame(raf)
          stream.getTracks().forEach((t) => t.stop())
          audioTrack?.stop()
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
 * Renderモード: 仮想時計オフラインレンダリング(Main主導)。任意解像度・固定fps保証・音声なし。
 * 録画中はMainがフリーズ表示と進捗イベントを出す。完了/キャンセルまで解決しない。
 */
export async function startRenderRecording(
  target: TargetSize,
  durationSec: number,
  format: 'mp4' | 'webp' = 'mp4',
  fps = 60,
): Promise<RecordResult> {
  const res = await window.capture.startRender({ target, fps, durationSec, format })
  if (res.ok) return { mp4Path: res.mp4Path }
  return { canceled: res.canceled, error: res.error }
}
