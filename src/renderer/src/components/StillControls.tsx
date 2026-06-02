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
  // 機能3: プリセット記憶 - prefsから初期値を取得
  const [mode, setModeState] = useState<'px' | 'cm'>(() => window.capture.getPrefs().stillMode ?? 'px')
  const [longEdge, setLongEdgeState] = useState(() => window.capture.getPrefs().longEdge ?? 3000)
  const [widthCm, setWidthCmState] = useState(() => window.capture.getPrefs().widthCm ?? 10)
  const [dpi, setDpiState] = useState(() => window.capture.getPrefs().dpi ?? 300)
  // セルフタイマー（秒）。0でオフ。
  const [timer, setTimerState] = useState(() => window.capture.getPrefs().stillTimer ?? 0)
  const setTimer = (v: number): void => {
    setTimerState(v)
    window.capture.setPrefs({ stillTimer: v })
  }

  // 各state変更時にprefsへ保存するラッパー
  const setMode = (m: 'px' | 'cm'): void => {
    setModeState(m)
    window.capture.setPrefs({ stillMode: m })
  }
  const setLongEdge = (v: number): void => {
    setLongEdgeState(v)
    window.capture.setPrefs({ longEdge: v })
  }
  const setWidthCm = (v: number): void => {
    setWidthCmState(v)
    window.capture.setPrefs({ widthCm: v })
  }
  const setDpi = (v: number): void => {
    setDpiState(v)
    window.capture.setPrefs({ dpi: v })
  }

  // 機能4: 出力解像度の計算
  const rawTarget = mode === 'px'
    ? targetFromLongEdge(aspect, longEdge)
    : targetFromWidthCm(aspect, widthCm, dpi)
  const { size: target } = capToGpuLimit(rawTarget)

  const onCapture = async () => {
    // セルフタイマー: 指定秒だけカウントダウン（同一トーストを更新）。
    if (timer > 0) {
      const id = 'still-timer'
      for (let s = timer; s > 0; s--) {
        toast.message(`Capturing in ${s}…`, { id })
        await new Promise((r) => setTimeout(r, 1000))
      }
      toast.dismiss(id)
    }
    const raw =
      mode === 'px'
        ? targetFromLongEdge(aspect, longEdge)
        : targetFromWidthCm(aspect, widthCm, dpi)
    const { ok, size } = capToGpuLimit(raw)
    if (!ok) toast.warning(`Reduced to ${size.width}×${size.height}px due to GPU limit`)
    const res = await window.capture.captureStill({ target: size, transparent: true })
    if (res.ok) toast.success(`Saved ${res.width}×${res.height}px`, { description: res.savedPath.split('/').pop() })
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
      {/* 機能4: 出力解像度の数値表示 */}
      <p className="text-xs text-muted-foreground">→ {target.width}×{target.height} px</p>
      {/* セルフタイマー */}
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
            >
              {s === 0 ? 'Off' : `${s}s`}
            </Button>
          ))}
        </div>
      </div>
      <Button className="w-full" onClick={onCapture}>
        <Camera />
        Capture Still
      </Button>
    </section>
  )
}
