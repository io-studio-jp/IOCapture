import { useEffect, useState } from 'react'
import { ASPECT_PRESETS, parseAspect, type Aspect } from '../../shared/aspect'
import { useFrameRect } from './lib/useFrameRect'
import { StillControls } from './components/StillControls'
import { VideoControls } from './components/VideoControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'

function App() {
  const [url, setUrl] = useState('')
  const [aspect, setAspect] = useState<Aspect>({ w: 1, h: 1 })
  const [customAspect, setCustomAspect] = useState('')
  const { stageRef, getFrameRect } = useFrameRect(aspect)

  useEffect(() => {
    const offError = window.capture.onLoadError((info) => {
      toast.error(`Load failed (${info.code}): ${info.desc}`)
    })
    const offUrl = window.capture.onUrlChanged((next) => setUrl(next))
    // 前回表示していたURLを復元して自動で読み込む。
    window.capture.getLastUrl().then((last) => {
      if (last) {
        setUrl(last)
        window.capture.loadUrl(last)
      }
    })
    return () => {
      offError()
      offUrl()
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="flex-1" />
        <Button onClick={() => window.capture.loadUrl(url)}>Load</Button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div ref={stageRef} className="relative flex-1 bg-black" />
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
          <section className="space-y-3 px-5 py-5">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Aspect</h2>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  className="w-full px-0"
                  variant={aspect.w === p.aspect.w && aspect.h === p.aspect.h ? 'default' : 'secondary'}
                  onClick={() => setAspect(p.aspect)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={customAspect}
                onChange={(e) => setCustomAspect(e.target.value)}
                placeholder="Custom W:H e.g. 21:9"
                className="h-8"
              />
              <Button size="sm" variant="secondary" onClick={() => { const a = parseAspect(customAspect); if (a) setAspect(a) }}>
                Apply
              </Button>
            </div>
          </section>
          <StillControls aspect={aspect} />
          <VideoControls aspect={aspect} getFrameRect={getFrameRect} />
        </aside>
      </div>
      <Toaster theme="dark" />
    </div>
  )
}

export default App
