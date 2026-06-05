# VIDEO録画の音声ソース選択 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VIDEO録画(MP4)の音声を「オフ / システム音声 / 特定の音声入力デバイス(BlackHole・マイク等)」から統合ドロップダウンで選べるようにする。

**Architecture:** 純ロジック(prefs移行・Select項目生成)を新規 `src/shared/audioSource.ts` に切り出してTDD。recorder.tsの `recordAudio: boolean` 引数を `audioSource: string` に置き換え、deviceId指定時は `getUserMedia` で録音。UIは既存トグルをshadcn Selectに置換。Main側変更なし。

**Tech Stack:** Electron + React + TypeScript (electron-vite)、vitest、shadcn/ui Select。

**仕様書:** `docs/superpowers/specs/2026-06-05-audio-source-select-design.md`

---

### Task 1: shared/audioSource.ts(純ロジック、TDD)

**Files:**
- Create: `src/shared/audioSource.ts`
- Test: `src/shared/audioSource.test.ts`

- [x] **Step 1: 失敗するテストを書く**

`src/shared/audioSource.test.ts` を新規作成(既存テストのスタイルは `src/shared/aspect.test.ts` 等を参照。vitestの `describe/it/expect` を使う):

```ts
import { describe, it, expect } from 'vitest'
import { AUDIO_OFF, AUDIO_SYSTEM, resolveAudioSource, audioSourceOptions } from './audioSource'

describe('resolveAudioSource', () => {
  it('audioSourceがあればそれを返す', () => {
    expect(resolveAudioSource({ audioSource: 'device-123', recordAudio: false })).toBe('device-123')
    expect(resolveAudioSource({ audioSource: AUDIO_OFF })).toBe(AUDIO_OFF)
  })
  it('audioSourceがなくrecordAudio=falseならoff(旧設定からの移行)', () => {
    expect(resolveAudioSource({ recordAudio: false })).toBe(AUDIO_OFF)
  })
  it('どちらもなければsystem', () => {
    expect(resolveAudioSource({})).toBe(AUDIO_SYSTEM)
    expect(resolveAudioSource({ recordAudio: true })).toBe(AUDIO_SYSTEM)
  })
})

describe('audioSourceOptions', () => {
  it('デバイスなしでもoff/systemの2項目を返す', () => {
    expect(audioSourceOptions([], { source: AUDIO_SYSTEM })).toEqual([
      { value: 'off', label: 'Audio off' },
      { value: 'system', label: 'System audio' },
    ])
  })
  it('列挙デバイスを項目に含める', () => {
    const opts = audioSourceOptions(
      [{ deviceId: 'bh-1', label: 'BlackHole 2ch' }],
      { source: AUDIO_SYSTEM },
    )
    expect(opts).toContainEqual({ value: 'bh-1', label: 'BlackHole 2ch' })
  })
  it('labelが空のデバイスはMicrophoneにフォールバック', () => {
    const opts = audioSourceOptions([{ deviceId: 'd-1', label: '' }], { source: AUDIO_SYSTEM })
    expect(opts).toContainEqual({ value: 'd-1', label: 'Microphone' })
  })
  it('保存済みデバイスが列挙に無ければ (not connected) 項目を末尾に追加', () => {
    const opts = audioSourceOptions([], { source: 'gone-1', label: 'Rubix24' })
    expect(opts[opts.length - 1]).toEqual({ value: 'gone-1', label: 'Rubix24 (not connected)' })
  })
  it('保存済みがoff/systemや列挙済みデバイスなら追加しない', () => {
    expect(audioSourceOptions([], { source: AUDIO_OFF })).toHaveLength(2)
    const opts = audioSourceOptions(
      [{ deviceId: 'bh-1', label: 'BlackHole 2ch' }],
      { source: 'bh-1', label: 'BlackHole 2ch' },
    )
    expect(opts).toHaveLength(3)
  })
})
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/audioSource.test.ts`
Expected: FAIL(`./audioSource` が存在しない)

- [x] **Step 3: 実装を書く**

`src/shared/audioSource.ts` を新規作成:

```ts
/** 音声ソース指定。'off' | 'system' | それ以外は音声入力デバイスのdeviceId */
export type AudioSource = string

export const AUDIO_OFF = 'off'
export const AUDIO_SYSTEM = 'system'

/** prefsから初期音声ソースを解決する(旧recordAudio設定からの移行を含む) */
export function resolveAudioSource(prefs: {
  audioSource?: string
  recordAudio?: boolean
}): AudioSource {
  if (prefs.audioSource) return prefs.audioSource
  return prefs.recordAudio === false ? AUDIO_OFF : AUDIO_SYSTEM
}

/**
 * 列挙した音声入力デバイスと保存済み選択からSelect項目リストを作る。
 * 保存済みデバイスが列挙に無い場合(取り外し等)は「(not connected)」項目を末尾に追加し、
 * 選択状態を維持できるようにする。
 */
export function audioSourceOptions(
  devices: { deviceId: string; label: string }[],
  saved: { source: AudioSource; label?: string },
): { value: string; label: string }[] {
  const options = [
    { value: AUDIO_OFF, label: 'Audio off' },
    { value: AUDIO_SYSTEM, label: 'System audio' },
    ...devices.map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' })),
  ]
  const isDevice = saved.source !== AUDIO_OFF && saved.source !== AUDIO_SYSTEM
  if (isDevice && !devices.some((d) => d.deviceId === saved.source)) {
    options.push({ value: saved.source, label: `${saved.label ?? 'Device'} (not connected)` })
  }
  return options
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/audioSource.test.ts`
Expected: PASS(全6テスト)

- [x] **Step 5: 全テストとtypecheckを実行**

Run: `npm test && npm run typecheck`
Expected: 既存テスト含め全てPASS、typecheckエラーなし

- [x] **Step 6: Commit**

```bash
git add src/shared/audioSource.ts src/shared/audioSource.test.ts
git commit -m "feat: 音声ソース解決とSelect項目生成の純ロジックを追加"
```

### Task 2: Prefsに audioSource / audioSourceLabel を追加

**Files:**
- Modify: `src/shared/ipc-types.ts`(Prefs型、60行付近)

- [x] **Step 1: Prefs型にフィールドを追加**

`src/shared/ipc-types.ts` の `Prefs` 型を変更。`recordAudio` の行を以下のように置き換える:

変更前:
```ts
  // VIDEO録画でシステム音声を録音するか(未設定はtrue扱い)
  recordAudio?: boolean
```

変更後:
```ts
  // VIDEO録画でシステム音声を録音するか(旧設定。audioSourceへ移行済み、読み取りのみ)
  recordAudio?: boolean
  // VIDEO録画の音声ソース('off' | 'system' | 音声入力デバイスのdeviceId)
  audioSource?: string
  // audioSourceがデバイスのときの表示名(未接続時のSelect表示に使う)
  audioSourceLabel?: string
```

- [x] **Step 2: typecheckで確認**

Run: `npm run typecheck`
Expected: エラーなし

- [x] **Step 3: Commit**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat: PrefsにaudioSource/audioSourceLabelを追加(recordAudioは移行元として残す)"
```

### Task 3: recorder.ts の引数を audioSource に変更

**Files:**
- Modify: `src/renderer/src/lib/recorder.ts`

- [x] **Step 1: importを追加**

ファイル先頭のimport群に追加:

```ts
import { AUDIO_OFF, AUDIO_SYSTEM, type AudioSource } from '../../../shared/audioSource'
```

- [x] **Step 2: デバイストラック取得ヘルパーを追加**

import群の直後(`export type RecordResult` の前)に追加:

```ts
/** 指定deviceIdの音声入力トラックを取得する。失敗(未接続・権限拒否)はnull。 */
async function getDeviceAudioTrack(deviceId: string): Promise<MediaStreamTrack | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    })
    return stream.getAudioTracks()[0] ?? null
  } catch {
    return null
  }
}
```

- [x] **Step 3: startWindowRecording(Smooth)を変更**

シグネチャの `recordAudio = true` を `audioSource: AudioSource = AUDIO_SYSTEM` に変更し、音声取得を分岐:

変更前(現在の14-25行付近):
```ts
export async function startWindowRecording(
  frameRect: Rect,
  target: TargetSize,
  inset: { x: number; y: number },
  format: 'mp4' | 'webp' = 'mp4',
  recordAudio = true,
  fps = 60,
): Promise<RecordHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } } as MediaTrackConstraints,
    audio: recordAudio,
  })
  const hadAudio = stream.getAudioTracks().length > 0
```

変更後:
```ts
export async function startWindowRecording(
  frameRect: Rect,
  target: TargetSize,
  inset: { x: number; y: number },
  format: 'mp4' | 'webp' = 'mp4',
  audioSource: AudioSource = AUDIO_SYSTEM,
  fps = 60,
): Promise<RecordHandle> {
  // 音声: system=画面録画のループバック / deviceId=入力デバイス / off=なし
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } } as MediaTrackConstraints,
    audio: audioSource === AUDIO_SYSTEM,
  })
  let audioTrack: MediaStreamTrack | null = stream.getAudioTracks()[0] ?? null
  if (audioSource !== AUDIO_SYSTEM && audioSource !== AUDIO_OFF) {
    audioTrack = await getDeviceAudioTrack(audioSource)
  }
  const hadAudio = audioTrack !== null
```

さらに、outStreamへのトラック追加(現在の50行付近 `if (hadAudio) outStream.addTrack(stream.getAudioTracks()[0])`)を変更:

```ts
  if (audioTrack) outStream.addTrack(audioTrack)
```

停止処理(`rec.onstop` 内の `stream.getTracks().forEach((t) => t.stop())` の直後)にデバイストラックの停止を追加:

```ts
          audioTrack?.stop()
```

- [x] **Step 4: startRecording(Clean)を変更**

シグネチャと音声取得部を変更。

変更前(現在の84-114行付近):
```ts
export async function startRecording(
  target: TargetSize,
  includeCursor = false,
  format: 'mp4' | 'webp' = 'mp4',
  recordAudio = true,
  fps = 60,
): Promise<RecordHandle> {
  const started = await window.capture.startFrameCapture(target, fps, includeCursor, format)
  if (!started.ok) throw new Error(started.error || 'failed to start frame capture')

  // 音声のみ録音（システム音声ループバック）。映像トラックは使わないので停止する。
  // WebPは画像形式で音声を持てないため、またrecordAudio=falseのときも録音しない。
  let audioRec: MediaRecorder | null = null
  let audioStream: MediaStream | null = null
  const chunks: Blob[] = []
  let hadAudio = false
  try {
    if (format === 'webp' || !recordAudio) throw new Error('skip audio')
    audioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    audioStream.getVideoTracks().forEach((t) => t.stop())
    const audioTracks = audioStream.getAudioTracks()
    if (audioTracks.length) {
      hadAudio = true
      audioRec = new MediaRecorder(new MediaStream([audioTracks[0]]), {
        mimeType: 'audio/webm;codecs=opus',
      })
      audioRec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      audioRec.start(100)
    }
  } catch {
    hadAudio = false
  }
```

変更後:
```ts
export async function startRecording(
  target: TargetSize,
  includeCursor = false,
  format: 'mp4' | 'webp' = 'mp4',
  audioSource: AudioSource = AUDIO_SYSTEM,
  fps = 60,
): Promise<RecordHandle> {
  const started = await window.capture.startFrameCapture(target, fps, includeCursor, format)
  if (!started.ok) throw new Error(started.error || 'failed to start frame capture')

  // 音声のみ録音(system=ループバック / deviceId=入力デバイス)。
  // WebPは画像形式で音声を持てないため、またaudioSource=offのときも録音しない。
  let audioRec: MediaRecorder | null = null
  let audioStream: MediaStream | null = null
  const chunks: Blob[] = []
  let hadAudio = false
  try {
    if (format === 'webp' || audioSource === AUDIO_OFF) throw new Error('skip audio')
    let audioTrack: MediaStreamTrack | null = null
    if (audioSource === AUDIO_SYSTEM) {
      audioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      audioStream.getVideoTracks().forEach((t) => t.stop())
      audioTrack = audioStream.getAudioTracks()[0] ?? null
    } else {
      audioTrack = await getDeviceAudioTrack(audioSource)
      if (audioTrack) audioStream = new MediaStream([audioTrack])
    }
    if (audioTrack) {
      hadAudio = true
      audioRec = new MediaRecorder(new MediaStream([audioTrack]), {
        mimeType: 'audio/webm;codecs=opus',
      })
      audioRec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      audioRec.start(100)
    }
  } catch {
    hadAudio = false
  }
```

stop処理は既存のまま(`audioStream?.getTracks().forEach((t) => t.stop())` がデバイストラックも停止する)。

- [x] **Step 5: typecheckで確認**

Run: `npm run typecheck`
Expected: VideoControls.tsx の呼び出し箇所で型エラーが出る場合がある(`recordAudio: boolean` を渡しているため)。booleanはstringに代入不可なのでエラーになるはず。**この時点ではVideoControls未修正のためエラーは想定内**。エラー内容が「VideoControls.tsxの引数型不一致」のみであることを確認し、Task 4で解消する。

注: もしエラーを出さずにコミットしたい場合は、Task 4と合わせて1コミットにせず、このタスクのコミットは「typecheckがVideoControlsの引数エラーのみ」を確認した上で行う(ビルドを壊すコミットを避けたい場合はTask 4完了後にまとめてtypecheckを通す)。

- [x] **Step 6: Commit**

```bash
git add src/renderer/src/lib/recorder.ts
git commit -m "feat: 録画関数の音声指定をaudioSource(off/system/deviceId)に変更"
```

### Task 4: VideoControls のトグルをSelectに置き換え

**Files:**
- Modify: `src/renderer/src/components/VideoControls.tsx`

- [x] **Step 1: importを変更**

`Volume2, VolumeX` のimportを削除し、Select関連とaudioSourceロジックを追加:

変更前:
```ts
import { Circle, Square, MousePointer2, Zap, Crop, Volume2, VolumeX } from 'lucide-react'
```

変更後:
```ts
import { Circle, Square, MousePointer2, Zap, Crop } from 'lucide-react'
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
```

- [x] **Step 2: stateを置き換え**

`recordAudio` のstate定義とトグル関数を削除:

削除(26行付近):
```ts
  // システム音声を録音するか(MP4のみ。WebPは元々音声なし)
  const [recordAudio, setRecordAudioState] = useState(() => window.capture.getPrefs().recordAudio ?? true)
```

削除(toggleRecordAudio関数全体):
```ts
  const toggleRecordAudio = (): void =>
    setRecordAudioState((v) => {
      const next = !v
      window.capture.setPrefs({ recordAudio: next })
      return next
    })
```

同じ場所(state定義のあった26行付近)に追加:

```ts
  // 音声ソース('off' | 'system' | deviceId)。旧recordAudio設定からの移行はresolveAudioSourceが行う
  const [audioSource, setAudioSourceState] = useState(() => resolveAudioSource(window.capture.getPrefs()))
  const [audioSourceLabel, setAudioSourceLabel] = useState(
    () => window.capture.getPrefs().audioSourceLabel,
  )
  // 利用可能な音声入力デバイス一覧(devicechangeで更新)
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([])
```

トグル関数のあった場所に追加:

```ts
  const setAudioSource = (value: string): void => {
    const device = audioDevices.find((d) => d.deviceId === value)
    const label = device ? device.label || 'Microphone' : undefined
    setAudioSourceState(value)
    setAudioSourceLabel(label)
    window.capture.setPrefs({ audioSource: value, audioSourceLabel: label })
  }
```

- [x] **Step 3: デバイス列挙のeffectを追加**

録画経過時間のuseEffect(54行付近)の手前に追加:

```ts
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
```

- [x] **Step 4: startNow の呼び出しとトーストを変更**

変更前(関連部分):
```ts
        handleRef.current = await startWindowRecording(rect, target, inset, format, recordAudio)
      } else {
        handleRef.current = await startRecording(target, includeCursor, format, recordAudio)
      }
      setRecording(true)
      if (effectiveFormat === 'mp4' && recordAudio && !handleRef.current.hadAudio) {
        toast.warning('Recording without audio. Grant Screen Recording permission for system audio.')
      }
```

変更後:
```ts
        handleRef.current = await startWindowRecording(rect, target, inset, format, audioSource)
      } else {
        handleRef.current = await startRecording(target, includeCursor, format, audioSource)
      }
      setRecording(true)
      // 音声を録るはずだったのに取れなかったときだけ警告(原因はソースにより異なる)
      if (effectiveFormat === 'mp4' && audioSource !== AUDIO_OFF && !handleRef.current.hadAudio) {
        toast.warning(
          audioSource === AUDIO_SYSTEM
            ? 'Recording without audio. Grant Screen Recording permission for system audio.'
            : 'Selected audio device unavailable. Recording without audio.',
        )
      }
```

- [x] **Step 5: JSXのトグルボタンをSelectに置き換え**

変更前(157行付近):
```tsx
      {/* システム音声を録音するか(MP4のみ。WebPは音声を持てない) */}
      {format === 'mp4' && (
        <Button
          size="sm"
          className="w-full"
          variant={recordAudio ? 'default' : 'secondary'}
          onClick={toggleRecordAudio}
          disabled={recording || counting}
        >
          {recordAudio ? <Volume2 /> : <VolumeX />}
          {recordAudio ? 'System audio: on' : 'System audio: off'}
        </Button>
      )}
```

変更後:
```tsx
      {/* 音声ソース(MP4のみ。WebPは音声を持てない): off / system / 入力デバイス */}
      {format === 'mp4' && (
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
        </div>
      )}
```

注: `SelectTrigger` に `size="sm"` プロップが無い場合(shadcnのバージョンによる)は `className="h-8 w-full"` に読み替える。`src/renderer/src/components/ui/select.tsx` の `SelectTrigger` 定義を確認して合わせること。

- [x] **Step 6: typecheck・lint・全テストを実行**

Run: `npm run typecheck && npm run lint && npm test`
Expected: すべてエラーなし(Task 3で出ていた引数型エラーも解消)

- [x] **Step 7: Commit**

```bash
git add src/renderer/src/components/VideoControls.tsx
git commit -m "feat: 音声ソース選択Select(off/system/入力デバイス)をVIDEOに追加"
```

### Task 5: 手動確認

**Files:** なし(動作確認のみ)

- [x] **Step 1: devで起動して確認**

Run: `npm run dev`

確認項目(仕様書のテスト方針どおり):
1. MP4選択時に「Audio」Selectが表示され、`Audio off` / `System audio` / 入力デバイス(BlackHole 2ch, Rubix24等)が並ぶ。WebP選択時は非表示
2. System audio → 音声入りmp4(Smooth/Clean両方)
3. BlackHole等のデバイス選択 → そのデバイスに流した音だけ入ったmp4(両エンジン)。初回はマイク権限のOSプロンプトが出る
4. Audio off → 音声なしmp4、警告トーストなし
5. デバイスを選択したまま取り外して録画 → 音声なしで録画継続+「Selected audio device unavailable」トースト
6. 選択がアプリ再起動後も保持される。旧recordAudio=falseだった場合は `Audio off` になっている

- [x] **Step 2: 問題があれば修正してコミット**

問題がなければ完了。
