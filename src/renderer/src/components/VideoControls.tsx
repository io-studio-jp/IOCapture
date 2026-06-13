import { useEffect, useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRenderRecording, startWindowRecording, type RecordHandle } from '../lib/recorder'
import { resolveCaptureMode } from '../../../shared/captureMode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Circle, Square } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AUDIO_OFF,
  AUDIO_SYSTEM,
  audioSourceOptions,
  resolveAudioSource,
} from '../../../shared/audioSource'
import { useAudioLevel } from '../lib/useAudioLevel'
import { toast } from 'sonner'

export function VideoControls({
  aspect,
  getFrameRect,
}: {
  aspect: Aspect
  getFrameRect: () => Rect
}) {
  const presets = videoPresetsFor(aspect)
  const [presetLabel, setPresetLabelState] = useState(() => window.capture.getPrefs().videoPreset ?? '1080')
  const [recording, setRecording] = useState(false)
  const [counting, setCounting] = useState(false)
  const [timer, setTimerState] = useState(() => window.capture.getPrefs().videoTimer ?? 0)
  // 音声ソース('off' | 'system' | deviceId)。旧recordAudio設定からの移行はresolveAudioSourceが行う
  const [audioSource, setAudioSourceState] = useState(() => resolveAudioSource(window.capture.getPrefs()))
  const [audioSourceLabel, setAudioSourceLabel] = useState(
    () => window.capture.getPrefs().audioSourceLabel,
  )
  // 利用可能な音声入力デバイス一覧(devicechangeで更新)
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([])
  // 出力フォーマット（mp4=音声あり / webp=アニメーション画像・音声なし）
  const [format, setFormatState] = useState<'mp4' | 'webp'>(() => window.capture.getPrefs().videoFormat ?? 'mp4')
  // 録画モード: live=画面録画(音声/カーソル) / render=オフラインレンダリング(任意解像度・固定fps)
  const [mode, setModeState] = useState<'live' | 'render'>(() => resolveCaptureMode(window.capture.getPrefs()))
  const setMode = (m: 'live' | 'render'): void => {
    setModeState(m)
    window.capture.setPrefs({ captureMode: m })
  }
  // Render録画の長さ(秒)
  const [lengthSec, setLengthSecState] = useState(() => window.capture.getPrefs().renderLengthSec ?? 10)
  const setLengthSec = (v: number): void => {
    setLengthSecState(v)
    window.capture.setPrefs({ renderLengthSec: v })
  }
  // Render録画のフレームレート(24/30/60)
  const [fps, setFpsState] = useState(() => window.capture.getPrefs().renderFps ?? 60)
  const setFps = (v: number): void => {
    setFpsState(v)
    window.capture.setPrefs({ renderFps: v })
  }
  // モーションブラーのサブフレーム数(1=Off)
  const [blurSamples, setBlurSamplesState] = useState(() => window.capture.getPrefs().renderBlurSamples ?? 1)
  const setBlurSamples = (v: number): void => {
    setBlurSamplesState(v)
    window.capture.setPrefs({ renderBlurSamples: v })
  }
  // SSAA(2倍描画→縮小)
  const [supersample, setSupersampleState] = useState(() => window.capture.getPrefs().renderSupersample ?? false)
  const setSupersample = (v: boolean): void => {
    setSupersampleState(v)
    window.capture.setPrefs({ renderSupersample: v })
  }
  // Render進捗(録画中のみ)
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null)
  useEffect(() => window.capture.onRenderProgress((p) => setProgress(p)), [])
  // Render中のライブプレビュー(実際の出力フレームを縮小したもの)
  const [renderPreview, setRenderPreview] = useState<string | null>(null)
  useEffect(() => window.capture.onRenderPreview((d) => setRenderPreview(d)), [])
  // 進捗モーダルの表示可否(viewが画面外へ退避中だけtrue。開始/終了の一瞬の被りを防ぐ)
  const [overlayVisible, setOverlayVisible] = useState(false)
  useEffect(() => window.capture.onRenderOverlay((v) => setOverlayVisible(v)), [])
  // 選択中ソースの入力レベル(0〜1)。off/WebP/取得失敗時はnull
  const audioLevel = useAudioLevel(audioSource, mode === 'live' && format === 'mp4')
  const handleRef = useRef<RecordHandle | null>(null)
  // 連打による二重起動を防ぐフラグ。startNow実行中はtrueになる
  const startingRef = useRef(false)

  const setFormat = (f: 'mp4' | 'webp'): void => {
    setFormatState(f)
    window.capture.setPrefs({ videoFormat: f })
  }

  const setTimer = (v: number): void => {
    setTimerState(v)
    window.capture.setPrefs({ videoTimer: v })
  }

  const setAudioSource = (value: string): void => {
    const device = audioDevices.find((d) => d.deviceId === value)
    const label = device ? device.label || 'Microphone' : undefined
    setAudioSourceState(value)
    setAudioSourceLabel(label)
    window.capture.setPrefs({ audioSource: value, audioSourceLabel: label })
  }

  // 音声入力デバイスを列挙し、抜き差し(devicechange)で更新する
  useEffect(() => {
    const refresh = (): void => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) =>
          setAudioDevices(
            all
              .filter((d) => d.kind === 'audioinput')
              .map((d) => ({ deviceId: d.deviceId, label: d.label })),
          ),
        )
        .catch(() => setAudioDevices([]))
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  // 録画経過時間
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(id)
  }, [recording])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const setPresetLabel = (label: string): void => {
    setPresetLabelState(label)
    window.capture.setPrefs({ videoPreset: label })
  }

  const startNow = async (): Promise<void> => {
    // 連打による二重起動を防ぐ
    if (startingRef.current) return
    startingRef.current = true
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      if (mode === 'render') {
        setRecording(true)
        startingRef.current = false // RenderはsetRecording(true)で以降onToggleがCancelに分岐する
        setProgress(null)
        setRenderPreview(null) // 前回フレームの残像を見せない
        const res = await startRenderRecording(target, lengthSec, format, { blurSamples, supersample }, fps)
        setRecording(false)
        setProgress(null)
        if ('mp4Path' in res) {
          toast.success(`Saved ${format}`, {
            description: res.mp4Path.split('/').pop(),
            action: { label: 'Reveal', onClick: () => window.capture.revealFile(res.mp4Path) },
          })
        } else if (!res.canceled) toast.error(`Render failed: ${res.error}`)
        return
      }
      const inset = await window.capture.getContentInset()
      handleRef.current = await startWindowRecording(rect, target, inset, format, audioSource)
      setRecording(true)
      startingRef.current = false // handleRef確定後に解除
      const actual = handleRef.current.size
      if (actual.width < target.width) {
        toast.info(`Recording at ${actual.width}×${actual.height}`, {
          description: 'Limited by on-screen size. Use Render mode for higher resolution.',
        })
      }
      if (format === 'mp4' && audioSource !== AUDIO_OFF && !handleRef.current.hadAudio) {
        toast.warning(
          audioSource === AUDIO_SYSTEM
            ? 'Recording without audio. Grant Screen Recording permission for system audio.'
            : 'Selected audio device unavailable. Recording without audio.',
        )
      }
    } catch (e) {
      startingRef.current = false
      setRecording(false)
      toast.error(`Could not start recording: ${String(e)}`)
    }
  }

  const onToggle = async () => {
    if (recording) {
      if (mode === 'render') {
        window.capture.cancelRender()
        // setRecording(false)はstartNow内のawaitが解決したときに行う
        return
      }
      setRecording(false)
      // 書き出し・変換・保存に時間がかかるので、処理中であることを表示する。
      const loadingId = toast.loading(`Finalizing ${format}…`)
      const res = await handleRef.current!.stop()
      toast.dismiss(loadingId)
      if ('mp4Path' in res) {
        const path = res.mp4Path
        toast.success(`Saved ${format}`, {
          description: path.split('/').pop(),
          action: { label: 'Reveal', onClick: () => window.capture.revealFile(path) },
        })
      } else if (!res.canceled) {
        toast.error(`Save failed: ${res.error}`)
      }
      return
    }
    if (counting) return
    // カウントダウンはLiveモードのみ（Renderは事前指定の長さを今この瞬間から録る）
    if (mode === 'live' && timer > 0) {
      setCounting(true)
      const id = 'video-timer'
      for (let s = timer; s > 0; s--) {
        toast.message(`Recording in ${s}…`, { id })
        await new Promise((r) => setTimeout(r, 1000))
      }
      toast.dismiss(id)
      setCounting(false)
    }
    await startNow()
  }

  const fixed = presets.filter((p) => p.size)
  const matchFrame = presets.find((p) => p.size === null)

  const currentPreset = presets.find((p) => p.label === presetLabel)
  const presetSizeLabel = (() => {
    if (!currentPreset) return null
    if (currentPreset.size) return `→ ${currentPreset.size.width}×${currentPreset.size.height}`
    const rect = getFrameRect()
    return `→ ${rect.width}×${rect.height} (frame)`
  })()

  // Render最終フレーム到達後のffmpeg書き出し中(キャンセル不可)。
  // progressがnull(準備中=シム切替/サーフェス確保など)はfinalizingではない点に注意。
  const finalizing = progress !== null && progress.frame === progress.total

  return (
    <section className="space-y-3 border-t border-border px-5 py-5">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Video</h2>
      {/* 録画モード: Live(画面録画) / Render(オフラインレンダリング) */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="w-full" variant={mode === 'live' ? 'default' : 'secondary'} onClick={() => setMode('live')} disabled={recording || counting}>
          Live
        </Button>
        <Button size="sm" className="w-full" variant={mode === 'render' ? 'default' : 'secondary'} onClick={() => setMode('render')} disabled={recording || counting}>
          Render
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'live'
          ? 'Screen recording · audio & cursor · capped at screen res'
          : 'Offline render · exact fps at any resolution · no audio · records from the current state'}
      </p>

      {/* 出力フォーマット（mp4 / WebP）。 */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="w-full" variant={format === 'mp4' ? 'default' : 'secondary'} onClick={() => setFormat('mp4')} disabled={recording || counting}>
          MP4
        </Button>
        <Button size="sm" className="w-full" variant={format === 'webp' ? 'default' : 'secondary'} onClick={() => setFormat('webp')} disabled={recording || counting}>
          WebP
        </Button>
      </div>
      {format === 'webp' && <p className="text-xs text-muted-foreground">Animated WebP (no audio)</p>}
      {/* 音声ソース(Liveモード+MP4のみ): off / system / 入力デバイス */}
      {mode === 'live' && format === 'mp4' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Audio</Label>
          <Select value={audioSource} onValueChange={setAudioSource} disabled={recording || counting}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {audioSourceOptions(audioDevices, { source: audioSource, label: audioSourceLabel }).map(
                (o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          {audioLevel !== null && (
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              {/* グラデーションを全幅に敷き、レベル分だけ右からのクリップで見せる。
                  RMSは音楽でも0.1〜0.3程度なので3倍ブーストして視認性を上げる */}
              <div
                className="absolute inset-0 bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-[clip-path] duration-100"
                style={{ clipPath: `inset(0 ${100 - Math.min(1, audioLevel * 3) * 100}% 0 0)` }}
              />
            </div>
          )}
        </div>
      )}
      {/* Renderモード専用: 録画長さ指定 */}
      {mode === 'render' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Length (s)</Label>
          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 30, 60].map((s) => (
              <Button key={s} size="sm" className="w-full px-0" variant={lengthSec === s ? 'default' : 'secondary'} onClick={() => setLengthSec(s)} disabled={recording || counting}>
                {s}s
              </Button>
            ))}
          </div>
          <Input type="number" min={1} value={lengthSec} onChange={(e) => setLengthSec(Math.max(1, +e.target.value))} disabled={recording || counting} />
          {/* フレームレート: 仮想時計で正確なfpsを保証(24/30/60) */}
          <Label className="text-xs text-muted-foreground">FPS</Label>
          <div className="grid grid-cols-3 gap-2">
            {[24, 30, 60].map((f) => (
              <Button key={f} size="sm" className="w-full px-0" variant={fps === f ? 'default' : 'secondary'} onClick={() => setFps(f)} disabled={recording || counting}>
                {f}
              </Button>
            ))}
          </div>
          {/* モーションブラー: シャッター180°のサブフレーム合成。レンダリング時間は約N倍 */}
          <Label className="text-xs text-muted-foreground">Motion blur</Label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 4, 8].map((n) => (
              <Button key={n} size="sm" className="w-full px-0" variant={blurSamples === n ? 'default' : 'secondary'} onClick={() => setBlurSamples(n)} disabled={recording || counting}>
                {n === 1 ? 'Off' : `${n}x`}
              </Button>
            ))}
          </div>
          {/* SSAA: 2倍で描画して縮小(エッジが滑らかに)。レンダリング時間増 */}
          <Button size="sm" className="w-full" variant={supersample ? 'default' : 'secondary'} onClick={() => setSupersample(!supersample)} disabled={recording || counting}>
            {supersample ? 'Supersample 2x: on' : 'Supersample 2x: off'}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {fixed.map((p) => (
          <Button
            key={p.label}
            size="sm"
            className="w-full px-0"
            variant={presetLabel === p.label ? 'default' : 'secondary'}
            onClick={() => setPresetLabel(p.label)}
            disabled={recording || counting}
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
          disabled={recording || counting}
        >
          {matchFrame.label}
        </Button>
      )}
      {presetSizeLabel && <p className="text-xs text-muted-foreground">{presetSizeLabel}</p>}

      {/* カウントダウンタイマー（Liveモードのみ。RenderはT=0から再始動するので不要）*/}
      {mode === 'live' && (
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
                disabled={recording || counting}
              >
                {s === 0 ? 'Off' : `${s}s`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Renderの進捗はモーダルで表示する。viewが画面外へ退避している間(overlayVisible)だけ出す。 */}
      {overlayVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-[min(90vw,440px)] space-y-4 rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`size-2 rounded-full bg-red-500 ${finalizing ? '' : 'animate-pulse'}`} />
              {finalizing ? 'Finalizing…' : 'Rendering'}
            </div>
            {/* ライブプレビュー: 実際の出力フレーム。届くまではプレースホルダ。 */}
            <div className="flex max-h-[55vh] items-center justify-center overflow-hidden rounded-lg bg-black">
              {renderPreview ? (
                <img src={renderPreview} alt="" className="max-h-[55vh] w-full object-contain" />
              ) : (
                <div className="py-16 text-xs text-muted-foreground">Preparing…</div>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{finalizing ? 'Encoding…' : progress ? `${progress.frame} / ${progress.total}` : 'starting…'}</span>
                <span>{progress ? Math.round((progress.frame / progress.total) * 100) : 0}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${progress ? (progress.frame / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
            <Button variant="destructive" className="w-full" onClick={onToggle} disabled={finalizing}>
              <Square className="fill-current" /> Cancel
            </Button>
          </div>
        </div>
      )}
      {recording && mode === 'live' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          REC {mmss}
        </div>
      )}
      <Button
        className="w-full"
        variant={recording ? 'destructive' : 'default'}
        onClick={onToggle}
        disabled={counting || (recording && mode === 'render' && finalizing)}
      >
        {recording ? <Square className="fill-current" /> : <Circle className="size-3 fill-current" />}
        {recording ? (mode === 'render' ? 'Cancel' : 'Stop') : counting ? 'Starting…' : 'Record'}
      </Button>
    </section>
  )
}
