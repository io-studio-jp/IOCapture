import { useEffect, useState } from 'react'
import { AUDIO_OFF, AUDIO_SYSTEM, type AudioSource } from '../../../shared/audioSource'
import { rmsLevel } from '../../../shared/audioLevel'

/**
 * 選択中音声ソースの入力レベル(0〜1)をプレビュー用ストリームで監視して返す。
 * off・無効時・取得失敗(権限なし/未接続)・デバイス抜去はnull。
 * 録画用ストリームとは独立に開閉するので、このフックの失敗が録画に影響することはない。
 */
export function useAudioLevel(audioSource: AudioSource, enabled: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled || audioSource === AUDIO_OFF) {
      return
    }
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

    const start = async (): Promise<void> => {
      try {
        if (audioSource === AUDIO_SYSTEM) {
          // システム音声: ループバック取得。映像トラックは使わないので即停止
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          stream.getVideoTracks().forEach((t) => t.stop())
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: audioSource } }
          })
        }
        const track = stream.getAudioTracks()[0]
        if (cancelled || !track) {
          stream.getTracks().forEach((t) => t.stop())
          if (!cancelled) setLevel(null)
          return
        }
        // デバイス抜去でトラックが終了したらメーターを消す(再取得は選び直し時のみ)
        track.addEventListener('ended', () => {
          if (!cancelled) setLevel(null)
        })
        ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(new MediaStream([track]))
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        let prev = -1
        const tick = (): void => {
          analyser.getByteTimeDomainData(data)
          const v = rmsLevel(data)
          // 微小変化ではsetStateしない(再レンダー抑制)
          if (Math.abs(v - prev) > 0.01) {
            prev = v
            setLevel(v)
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // 権限なし・デバイス未接続など。メーター非表示にするだけで何も壊さない
        stream?.getTracks().forEach((t) => t.stop())
        stream = null
        if (!cancelled) setLevel(null)
      }
    }
    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
      setLevel(null)
    }
  }, [audioSource, enabled])

  return level
}
