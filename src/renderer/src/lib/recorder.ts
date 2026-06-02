import type { TargetSize } from '../../../shared/resolution'

export type RecordResult = { mp4Path: string } | { canceled?: boolean; error?: string }
export type RecordHandle = {
  hadAudio: boolean
  stop: () => Promise<RecordResult>
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
    if (format === 'webp') throw new Error('skip audio')
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
