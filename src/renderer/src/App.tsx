import { useState } from 'react'
import { ASPECT_PRESETS, parseAspect, type Aspect } from '../../shared/aspect'
import { useFrameRect } from './lib/useFrameRect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'

function App() {
  const [url, setUrl] = useState('')
  const [aspect, setAspect] = useState<Aspect>({ w: 1, h: 1 })
  const [customAspect, setCustomAspect] = useState('')
  const { stageRef } = useFrameRect(aspect)

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex gap-2 border-b border-zinc-800 p-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="flex-1" />
        <Button onClick={() => window.capture.loadUrl(url)}>読込</Button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div ref={stageRef} className="relative flex-1 bg-black" />
        <aside className="w-64 space-y-3 overflow-y-auto border-l border-zinc-800 p-3">
          <div className="text-xs text-zinc-400">比率</div>
          <div className="flex flex-wrap gap-1">
            {ASPECT_PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant={aspect.w === p.aspect.w && aspect.h === p.aspect.h ? 'default' : 'secondary'}
                onClick={() => setAspect(p.aspect)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input value={customAspect} onChange={(e) => setCustomAspect(e.target.value)} placeholder="任意 W:H 例 21:9" className="h-8" />
            <Button size="sm" onClick={() => { const a = parseAspect(customAspect); if (a) setAspect(a) }}>適用</Button>
          </div>
        </aside>
      </div>
      <Toaster />
    </div>
  )
}

export default App
