import { useRef, useState } from 'react'
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
  const [presetLabel, setPresetLabel] = useState('1080')
  const [recording, setRecording] = useState(false)
  const handleRef = useRef<RecordHandle | null>(null)

  const onToggle = async () => {
    if (recording) {
      const { blob, hadAudio } = await handleRef.current!.stop()
      setRecording(false)
      if (!hadAudio) toast.warning('Could not capture system audio (video only). Consider installing a virtual audio device.')
      const webm = await blob.arrayBuffer()
      const saved = await window.capture.saveBlob({ data: webm, defaultName: `capture-${Date.now()}.webm` })
      if (saved.ok) {
        const conv = await window.capture.convertToMp4({ webmPath: saved.path })
        if (conv.ok) toast.success(`Saved mp4: ${conv.mp4Path}`)
        else toast.error(`mp4 conversion failed (webm saved): ${conv.error}`)
      }
      return
    }
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      handleRef.current = await startRecording(rect, target)
      setRecording(true)
    } catch {
      toast.error(
        'Could not start recording. Grant Screen Recording permission (System Settings → Privacy & Security → Screen Recording) to this app, then restart.',
      )
    }
  }

  const fixed = presets.filter((p) => p.size)
  const matchFrame = presets.find((p) => p.size === null)

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
