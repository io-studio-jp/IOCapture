import { useEffect, useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRecording, startWindowRecording, type RecordHandle } from '../lib/recorder'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Circle, Square, MousePointer2, Zap, Crop } from 'lucide-react'
import { toast } from 'sonner'

export function VideoControls({
  aspect,
  getFrameRect,
}: {
  aspect: Aspect
  getFrameRect: () => Rect
}) {
  const presets = videoPresetsFor(aspect)
  const [presetLabel, setPresetLabelState] = useState(() => window.capture.getPrefs().videoPreset ?? '1080')
  const [recording, setRecording] = useState(false)
  const [counting, setCounting] = useState(false)
  const [timer, setTimerState] = useState(() => window.capture.getPrefs().videoTimer ?? 0)
  // カーソルを録画に含めるか（フレームに矢印を合成）
  const [includeCursor, setIncludeCursorState] = useState(() => window.capture.getPrefs().includeCursor ?? false)
  // 出力フォーマット（mp4=音声あり / webp=アニメーション画像・音声なし）
  const [format, setFormatState] = useState<'mp4' | 'webp'>(() => window.capture.getPrefs().videoFormat ?? 'mp4')
  // 録画エンジン: frame=クリーン(capturePage) / screen=滑らか(画面録画)
  const [engine, setEngineState] = useState<'frame' | 'screen'>(() => window.capture.getPrefs().captureEngine ?? 'frame')
  const handleRef = useRef<RecordHandle | null>(null)

  const setFormat = (f: 'mp4' | 'webp'): void => {
    setFormatState(f)
    window.capture.setPrefs({ videoFormat: f })
  }
  const setEngine = (e: 'frame' | 'screen'): void => {
    setEngineState(e)
    window.capture.setPrefs({ captureEngine: e })
  }
  // screen方式はmp4のみ（MediaRecorderはアニメWebPを作れない）
  const effectiveFormat: 'mp4' | 'webp' = engine === 'screen' ? 'mp4' : format

  const setTimer = (v: number): void => {
    setTimerState(v)
    window.capture.setPrefs({ videoTimer: v })
  }
  const toggleIncludeCursor = (): void =>
    setIncludeCursorState((v) => {
      const next = !v
      window.capture.setPrefs({ includeCursor: next })
      return next
    })

  // 録画経過時間
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(id)
  }, [recording])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const setPresetLabel = (label: string): void => {
    setPresetLabelState(label)
    window.capture.setPrefs({ videoPreset: label })
  }

  const startNow = async (): Promise<void> => {
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      if (engine === 'screen') {
        const inset = await window.capture.getContentInset()
        handleRef.current = await startWindowRecording(rect, target, inset)
      } else {
        handleRef.current = await startRecording(target, includeCursor, format)
      }
      setRecording(true)
      if (effectiveFormat === 'mp4' && !handleRef.current.hadAudio) {
        toast.warning('Recording without audio. Grant Screen Recording permission for system audio.')
      }
    } catch (e) {
      toast.error(`Could not start recording: ${String(e)}`)
    }
  }

  const onToggle = async () => {
    if (recording) {
      setRecording(false)
      // 書き出し・変換・保存に時間がかかるので、処理中であることを表示する。
      const loadingId = toast.loading(`Finalizing ${effectiveFormat}…`)
      const res = await handleRef.current!.stop()
      toast.dismiss(loadingId)
      if ('mp4Path' in res) {
        const path = res.mp4Path
        toast.success(`Saved ${effectiveFormat}`, {
          description: path.split('/').pop(),
          action: { label: 'Reveal', onClick: () => window.capture.revealFile(path) },
        })
      } else if (!res.canceled) {
        toast.error(`Save failed: ${res.error}`)
      }
      return
    }
    if (counting) return
    if (timer > 0) {
      setCounting(true)
      const id = 'video-timer'
      for (let s = timer; s > 0; s--) {
        toast.message(`Recording in ${s}…`, { id })
        await new Promise((r) => setTimeout(r, 1000))
      }
      toast.dismiss(id)
      setCounting(false)
    }
    await startNow()
  }

  const fixed = presets.filter((p) => p.size)
  const matchFrame = presets.find((p) => p.size === null)

  const currentPreset = presets.find((p) => p.label === presetLabel)
  const presetSizeLabel = (() => {
    if (!currentPreset) return null
    if (currentPreset.size) return `→ ${currentPreset.size.width}×${currentPreset.size.height}`
    const rect = getFrameRect()
    return `→ ${rect.width}×${rect.height} (frame)`
  })()

  return (
    <section className="space-y-3 border-t border-border px-5 py-5">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Video</h2>
      {/* 録画エンジン: Smooth(画面録画) / Clean(フレーム取得) */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="w-full" variant={engine === 'screen' ? 'default' : 'secondary'} onClick={() => setEngine('screen')} disabled={recording || counting}>
          <Zap />
          Smooth
        </Button>
        <Button size="sm" className="w-full" variant={engine === 'frame' ? 'default' : 'secondary'} onClick={() => setEngine('frame')} disabled={recording || counting}>
          <Crop />
          Clean
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {engine === 'screen' ? 'Screen capture · smooth · cursor included' : 'Frame capture · clean · any resolution'}
      </p>

      {/* 出力フォーマット（Clean時のみ。Smoothはmp4固定） */}
      {engine === 'frame' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="w-full" variant={format === 'mp4' ? 'default' : 'secondary'} onClick={() => setFormat('mp4')} disabled={recording || counting}>
              MP4
            </Button>
            <Button size="sm" className="w-full" variant={format === 'webp' ? 'default' : 'secondary'} onClick={() => setFormat('webp')} disabled={recording || counting}>
              WebP
            </Button>
          </div>
          {format === 'webp' && <p className="text-xs text-muted-foreground">Animated WebP (no audio)</p>}
        </>
      )}
      <div className="grid grid-cols-3 gap-2">
        {fixed.map((p) => (
          <Button
            key={p.label}
            size="sm"
            className="w-full px-0"
            variant={presetLabel === p.label ? 'default' : 'secondary'}
            onClick={() => setPresetLabel(p.label)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {matchFrame && (
        <Button
          size="sm"
          className="w-full"
          variant={presetLabel === matchFrame.label ? 'default' : 'secondary'}
          onClick={() => setPresetLabel(matchFrame.label)}
        >
          {matchFrame.label}
        </Button>
      )}
      {presetSizeLabel && <p className="text-xs text-muted-foreground">{presetSizeLabel}</p>}

      {/* カーソルを録画に含めるか（Clean時のみ。Smoothは常にカーソルあり） */}
      {engine === 'frame' && (
        <Button
          size="sm"
          className="w-full"
          variant={includeCursor ? 'default' : 'secondary'}
          onClick={toggleIncludeCursor}
          disabled={recording || counting}
        >
          <MousePointer2 />
          {includeCursor ? 'Cursor in video: on' : 'Cursor in video: off'}
        </Button>
      )}

      {/* カウントダウンタイマー */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Timer</Label>
        <div className="grid grid-cols-4 gap-2">
          {[0, 3, 5, 10].map((s) => (
            <Button
              key={s}
              size="sm"
              className="w-full px-0"
              variant={timer === s ? 'default' : 'secondary'}
              onClick={() => setTimer(s)}
              disabled={recording || counting}
            >
              {s === 0 ? 'Off' : `${s}s`}
            </Button>
          ))}
        </div>
      </div>

      {recording && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          REC {mmss}
        </div>
      )}
      <Button
        className="w-full"
        variant={recording ? 'destructive' : 'default'}
        onClick={onToggle}
        disabled={counting}
      >
        {recording ? <Square className="fill-current" /> : <Circle className="size-3 fill-current" />}
        {recording ? 'Stop' : counting ? 'Starting…' : 'Record'}
      </Button>
    </section>
  )
}
