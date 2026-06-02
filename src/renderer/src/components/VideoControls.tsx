import { useEffect, useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRecording, type RecordHandle } from '../lib/recorder'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Circle, Square, MousePointer2 } from 'lucide-react'
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
  // カーソルを録画に含めるか（ON=ウィンドウキャプチャ方式）
  const [includeCursor, setIncludeCursorState] = useState(() => window.capture.getPrefs().includeCursor ?? false)
  const handleRef = useRef<RecordHandle | null>(null)

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
      handleRef.current = await startRecording(target, includeCursor)
      setRecording(true)
      if (!handleRef.current.hadAudio) {
        toast.warning('Recording without audio. Grant Screen Recording permission for system audio.')
      }
    } catch (e) {
      toast.error(`Could not start recording: ${String(e)}`)
    }
  }

  const onToggle = async () => {
    if (recording) {
      setRecording(false)
      const res = await handleRef.current!.stop()
      if ('mp4Path' in res) {
        const path = res.mp4Path
        toast.success('Saved mp4', {
          description: path.split('/').pop(),
          action: { label: 'Reveal', onClick: () => window.capture.revealFile(path) },
        })
      }
      else if (!res.canceled) toast.error(`Save failed: ${res.error}`)
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

      {/* カーソルを録画に含めるか */}
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
