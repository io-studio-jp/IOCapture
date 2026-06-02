import { useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import { targetFromLongEdge, targetFromWidthCm } from '../../../shared/resolution'
import { capToGpuLimit } from '../../../shared/dpr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Camera } from 'lucide-react'
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
    if (!ok) toast.warning(`Reduced to ${size.width}×${size.height}px due to GPU limit`)
    const res = await window.capture.captureStill({ target: size, transparent: true })
    if (res.ok) toast.success(`Saved ${res.width}×${res.height}px: ${res.savedPath}`)
    else if (res.error !== 'canceled') toast.error(`Failed: ${res.error}`)
  }

  return (
    <section className="space-y-3 border-t border-border px-5 py-5">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Still</h2>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="w-full" variant={mode === 'px' ? 'default' : 'secondary'} onClick={() => setMode('px')}>px</Button>
        <Button size="sm" className="w-full" variant={mode === 'cm' ? 'default' : 'secondary'} onClick={() => setMode('cm')}>cm/dpi</Button>
      </div>
      {mode === 'px' ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Long edge (px)</Label>
          <Input type="number" value={longEdge} onChange={(e) => setLongEdge(+e.target.value)} />
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Width (cm)</Label>
            <Input type="number" value={widthCm} onChange={(e) => setWidthCm(+e.target.value)} />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">DPI</Label>
            <Input type="number" value={dpi} onChange={(e) => setDpi(+e.target.value)} />
          </div>
        </div>
      )}
      <Button className="w-full" onClick={onCapture}>
        <Camera />
        Capture Still
      </Button>
    </section>
  )
}
