import { useEffect, useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRecording, type RecordHandle } from '../lib/recorder'
import { Button } from '@/components/ui/button'
import { Circle, Square } from 'lucide-react'
import { toast } from 'sonner'

export function VideoControls({
  aspect,
  getFrameRect,
}: {
  aspect: Aspect
  getFrameRect: () => Rect
}) {
  const presets = videoPresetsFor(aspect)
  // 機能3: プリセット記憶 - prefsから初期値を取得
  const [presetLabel, setPresetLabelState] = useState(() => window.capture.getPrefs().videoPreset ?? '1080')
  const [recording, setRecording] = useState(false)
  const handleRef = useRef<RecordHandle | null>(null)

  // 機能5: 録画経過時間
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(id)
  }, [recording])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // presetLabel変更時にprefsへ保存するラッパー
  const setPresetLabel = (label: string): void => {
    setPresetLabelState(label)
    window.capture.setPrefs({ videoPreset: label })
  }

  const onToggle = async () => {
    if (recording) {
      const { blob, hadAudio } = await handleRef.current!.stop()
      setRecording(false)
      if (!hadAudio) toast.warning('Could not capture system audio (video only). Consider installing a virtual audio device.')
      const webm = await blob.arrayBuffer()
      const saved = await window.capture.saveBlob({ data: webm, defaultName: `capture-${Date.now()}.webm` })
      if (saved.ok) {
        const conv = await window.capture.convertToMp4({ webmPath: saved.path })
        if (conv.ok) toast.success('Saved mp4', { description: conv.mp4Path.split('/').pop() })
        else toast.error(`mp4 conversion failed (webm saved): ${conv.error}`)
      }
      return
    }
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      const inset = await window.capture.getContentInset()
      handleRef.current = await startRecording(rect, target, inset)
      setRecording(true)
    } catch {
      toast.error(
        'Could not start recording. Grant Screen Recording permission (System Settings → Privacy & Security → Screen Recording) to this app, then restart.',
      )
    }
  }

  const fixed = presets.filter((p) => p.size)
  const matchFrame = presets.find((p) => p.size === null)

  // 機能4: 選択中プリセットのサイズ表示
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
      {/* 機能4: プリセットサイズ表示 */}
      {presetSizeLabel && (
        <p className="text-xs text-muted-foreground">{presetSizeLabel}</p>
      )}
      {/* 機能5: 録画インジケータ＋経過時間 */}
      {recording && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          REC {mmss}
        </div>
      )}
      <Button className="w-full" variant={recording ? 'destructive' : 'default'} onClick={onToggle}>
        {recording ? (
          <Square className="fill-current" />
        ) : (
          <Circle className="size-3 fill-current" />
        )}
        {recording ? 'Stop' : 'Record'}
      </Button>
    </section>
  )
}
