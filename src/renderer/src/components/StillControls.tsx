import { useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import { targetFromLongEdge, targetFromWidthCm } from '../../../shared/resolution'
import { capToGpuLimit } from '../../../shared/dpr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export function StillControls({ aspect }: { aspect: Aspect }) {
  const [mode, setMode] = useState<'px' | 'cm'>('px')
  const [longEdge, setLongEdge] = useState(3000)
  const [widthCm, setWidthCm] = useState(10)
  const [dpi, setDpi] = useState(300)

  const onCapture = async () => {
    const raw =
      mode === 'px'
        ? targetFromLongEdge(aspect, longEdge)
        : targetFromWidthCm(aspect, widthCm, dpi)
    const { ok, size } = capToGpuLimit(raw)
    if (!ok) toast.warning(`GPU上限のため ${size.width}×${size.height}px に縮小しました`)
    const res = await window.capture.captureStill({ target: size, transparent: true })
    if (res.ok) toast.success(`保存: ${res.savedPath}`)
    else if (res.error !== 'canceled') toast.error(`失敗: ${res.error}`)
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">静止画</div>
      <div className="flex gap-1">
        <Button size="sm" variant={mode === 'px' ? 'default' : 'secondary'} onClick={() => setMode('px')}>px</Button>
        <Button size="sm" variant={mode === 'cm' ? 'default' : 'secondary'} onClick={() => setMode('cm')}>cm/dpi</Button>
      </div>
      {mode === 'px' ? (
        <div>
          <Label className="text-xs">長辺px</Label>
          <Input type="number" value={longEdge} onChange={(e) => setLongEdge(+e.target.value)} />
        </div>
      ) : (
        <div className="flex gap-2">
          <div>
            <Label className="text-xs">幅cm</Label>
            <Input type="number" value={widthCm} onChange={(e) => setWidthCm(+e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">dpi</Label>
            <Input type="number" value={dpi} onChange={(e) => setDpi(+e.target.value)} />
          </div>
        </div>
      )}
      <Button className="w-full" onClick={onCapture}>📷 静止画を撮る</Button>
    </div>
  )
}
