import { useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { targetFromLongEdge, targetFromWidthCm } from '../../../shared/resolution'
import { capToGpuLimit } from '../../../shared/dpr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Camera, FolderOpen, Layers } from 'lucide-react'
import { toast } from 'sonner'

export function StillControls({
  aspect,
  getFrameRect,
}: {
  aspect: Aspect
  getFrameRect: () => Rect
}) {
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

  // 連続撮影（インターバル）
  const [outputDir, setOutputDir] = useState(() => window.capture.getPrefs().outputDir ?? '')
  const [intervalCount, setIntervalCountState] = useState(() => window.capture.getPrefs().intervalCount ?? 10)
  const [intervalSec, setIntervalSecState] = useState(() => window.capture.getPrefs().intervalSec ?? 3)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const setIntervalCount = (v: number): void => {
    setIntervalCountState(v)
    window.capture.setPrefs({ intervalCount: v })
  }
  const setIntervalSec = (v: number): void => {
    setIntervalSecState(v)
    window.capture.setPrefs({ intervalSec: v })
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
    if (res.ok)
      toast.success(`Saved ${res.width}×${res.height}px`, {
        description: res.savedPath.split('/').pop(),
        action: { label: 'Reveal', onClick: () => window.capture.revealFile(res.savedPath) },
      })
    else if (res.error !== 'canceled') toast.error(`Failed: ${res.error}`)
  }

  const currentTarget = (): { width: number; height: number } => {
    const raw = mode === 'px' ? targetFromLongEdge(aspect, longEdge) : targetFromWidthCm(aspect, widthCm, dpi)
    return capToGpuLimit(raw).size
  }

  const chooseFolder = async (): Promise<string | null> => {
    const dir = await window.capture.chooseFolder()
    if (dir) {
      setOutputDir(dir)
      window.capture.setPrefs({ outputDir: dir })
    }
    return dir
  }

  const onInterval = async (): Promise<void> => {
    if (running) {
      runningRef.current = false
      return
    }
    let dir = outputDir
    if (!dir) {
      dir = (await chooseFolder()) ?? ''
      if (!dir) return
    }
    const target = currentTarget()
    const base = Date.now()
    runningRef.current = true
    setRunning(true)
    let saved = 0
    for (let i = 1; i <= intervalCount && runningRef.current; i++) {
      const name = `capture-${base}-${String(i).padStart(3, '0')}.png`
      const res = await window.capture.captureStillTo({ target, dir, name })
      if (res.ok) saved++
      toast.message(`Shot ${i}/${intervalCount}`, { id: 'interval' })
      // 次の撮影まで待機（停止に素早く反応するよう小刻みにチェック）。
      if (i < intervalCount) {
        const until = Date.now() + intervalSec * 1000
        while (Date.now() < until && runningRef.current) {
          await new Promise((r) => setTimeout(r, 100))
        }
      }
    }
    runningRef.current = false
    setRunning(false)
    toast.dismiss('interval')
    toast.success(`Saved ${saved} shots`, {
      description: dir.split('/').pop(),
      action: { label: 'Reveal', onClick: () => window.capture.revealFile(dir) },
    })
  }

  const folderName = outputDir ? outputDir.split('/').pop() : 'Choose folder…'

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
      {/* 機能4: 出力解像度の数値表示。画面表示の物理pxも添える(それ未満の指定では
          等倍比較で画面のほうが高精細になるため、超えたい場合の目安を示す) */}
      <p className="text-xs text-muted-foreground">→ {target.width}×{target.height} px</p>
      {(() => {
        const rect = getFrameRect()
        const dpr = window.devicePixelRatio || 1
        const nativeLong = Math.round(Math.max(rect.width, rect.height) * dpr)
        if (nativeLong > 0 && Math.max(target.width, target.height) < nativeLong) {
          return (
            <p className="text-xs text-muted-foreground">
              Screen shows ≈ {nativeLong} px (long edge). Use a larger size to exceed screen detail.
            </p>
          )
        }
        return null
      })()}
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
      <Button className="w-full" onClick={onCapture} disabled={running}>
        <Camera />
        Capture Still
      </Button>

      {/* 連続撮影（インターバル） */}
      <div className="space-y-2 border-t border-border pt-3">
        <Label className="text-xs text-muted-foreground">Interval (auto-save)</Label>
        <Button size="sm" variant="secondary" className="w-full justify-start" onClick={chooseFolder} disabled={running}>
          <FolderOpen />
          <span className="truncate">{folderName}</span>
        </Button>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Count</Label>
            <Input type="number" min={1} value={intervalCount} onChange={(e) => setIntervalCount(+e.target.value)} disabled={running} />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Every (s)</Label>
            <Input type="number" min={0} step="0.5" value={intervalSec} onChange={(e) => setIntervalSec(+e.target.value)} disabled={running} />
          </div>
        </div>
        <Button className="w-full" variant={running ? 'destructive' : 'default'} onClick={onInterval}>
          <Layers />
          {running ? 'Stop' : 'Start interval'}
        </Button>
      </div>
    </section>
  )
}
