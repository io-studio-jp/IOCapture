import type { TargetSize } from '../../../shared/resolution'

export type RecordHandle = {
  hadAudio: boolean
  stop: () => Promise<{ mp4Path: string } | { canceled?: boolean; error?: string }>
}

/**
 * 動画録画。映像はMainが作品ビューのフレームを直接取得して生成する（OSカーソルは入らない・
 * 枠ピッタリ・解像度自由）。音声のみrendererでループバック録音し、停止時にMainで合成する。
 */
export async function startRecording(target: TargetSize, fps = 60): Promise<RecordHandle> {
  const started = await window.capture.startFrameCapture(target, fps)
  if (!started.ok) throw new Error(started.error || 'failed to start frame capture')

  // 音声のみ録音（システム音声ループバック）。映像トラックは使わないので停止する。
  let audioRec: MediaRecorder | null = null
  let audioStream: MediaStream | null = null
  const chunks: Blob[] = []
  let hadAudio = false
  try {
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
