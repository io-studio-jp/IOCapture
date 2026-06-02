import { useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRecording, type RecordHandle } from '../lib/recorder'
import { Button } from '@/components/ui/button'
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
      if (!hadAudio) toast.warning('システム音声を取得できませんでした（映像のみ）。仮想オーディオデバイスの導入を検討してください。')
      const webm = await blob.arrayBuffer()
      const saved = await window.capture.saveBlob({ data: webm, defaultName: `capture-${Date.now()}.webm` })
      if (saved.ok) {
        const conv = await window.capture.convertToMp4({ webmPath: saved.path })
        if (conv.ok) toast.success(`mp4保存: ${conv.mp4Path}`)
        else toast.error(`mp4変換失敗（webmは保存済み）: ${conv.error}`)
      }
      return
    }
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    handleRef.current = await startRecording(rect, target)
    setRecording(true)
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">動画</div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <Button key={p.label} size="sm" variant={presetLabel === p.label ? 'default' : 'secondary'} onClick={() => setPresetLabel(p.label)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Button className="w-full" variant={recording ? 'destructive' : 'default'} onClick={onToggle}>
        {recording ? '■ 停止' : '● 録画'}
      </Button>
    </div>
  )
}
