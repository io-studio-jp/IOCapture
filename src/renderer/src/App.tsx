import { useEffect, useState } from 'react'
import { ASPECT_PRESETS, parseAspect, type Aspect } from '../../shared/aspect'
import { useFrameRect } from './lib/useFrameRect'
import { StillControls } from './components/StillControls'
import { VideoControls } from './components/VideoControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, RotateCw, MousePointerClick } from 'lucide-react'

function App() {
  const [url, setUrl] = useState('')
  // 機能3: アスペクトをprefsから初期化
  const [aspect, setAspectState] = useState<Aspect>(() => window.capture.getPrefs().aspect ?? { w: 1, h: 1 })
  const [customAspect, setCustomAspect] = useState('')
  // 機能6: CSSセレクタ非表示（state変数名はhideSelectorsだが、setterはsetHideを使い命名衝突を回避）
  const [hideSelectors, setHide] = useState(() => window.capture.getPrefs().hideSelectors ?? '')
  // クリックで要素を選んで消すピックモードの状態
  const [picking, setPicking] = useState(false)
  const { stageRef, getFrameRect } = useFrameRect(aspect)

  // アスペクト変更時にprefsへ保存
  const setAspect = (a: Aspect): void => {
    setAspectState(a)
    window.capture.setPrefs({ aspect: a })
  }

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

    // 新しいバージョンがあれば通知（ダウンロードページを開く）。
    window.capture.checkUpdate().then((u) => {
      if (u.update && u.url) {
        const url = u.url
        toast(`新しいバージョン ${u.version} があります`, {
          duration: 12000,
          action: { label: 'Download', onClick: () => window.capture.openExternal(url) },
        })
      }
    })

    // 機能2: キーボードショートカット（Cmd/Ctrl + [ / ] / R）
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '[') { e.preventDefault(); window.capture.goBack() }
      else if (e.key === ']') { e.preventDefault(); window.capture.goForward() }
      else if (e.key === 'r') { e.preventDefault(); window.capture.reload() }
    }
    window.addEventListener('keydown', onKey)

    // ピックモードの状態と、ピックで追加された非表示セレクタを反映
    const offPick = window.capture.onPickState((p) => setPicking(p))
    const offHide = window.capture.onHideSelectorsChanged((sel) => setHide(sel))

    return () => {
      offError()
      offUrl()
      window.removeEventListener('keydown', onKey)
      offPick()
      offHide()
    }
  }, [])

  // 機能6: hideSelectors変更時にprefsへ保存し、MainプロセスにIPCで通知
  useEffect(() => {
    window.capture.setPrefs({ hideSelectors })
    window.capture.setHideSelectors(hideSelectors)
  }, [hideSelectors])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {/* 機能2: ナビゲーションボタン */}
        <Button variant="ghost" size="icon" onClick={() => window.capture.goBack()}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => window.capture.goForward()}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => window.capture.reload()}>
          <RotateCw />
        </Button>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') window.capture.loadUrl(url) }}
          placeholder="https://..."
          className="flex-1"
        />
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
          {/* 機能6: Hide elements セクション */}
          <section className="space-y-3 border-t border-border px-5 py-5">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Hide elements</h2>
            <Button
              size="sm"
              className="w-full"
              variant={picking ? 'destructive' : 'default'}
              onClick={() => (picking ? window.capture.stopPick() : window.capture.startPick())}
            >
              <MousePointerClick />
              {picking ? 'Click an element… (Esc)' : 'Pick element'}
            </Button>
            <Input
              value={hideSelectors}
              onChange={(e) => setHide(e.target.value)}
              placeholder="CSS selectors e.g. header, .menu"
              className="h-8"
            />
            {hideSelectors && (
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setHide('')}>
                Clear
              </Button>
            )}
          </section>
        </aside>
      </div>
      <Toaster
        theme="dark"
        position="bottom-right"
        offset={16}
        style={{ '--width': '256px' } as React.CSSProperties}
      />
    </div>
  )
}

export default App
