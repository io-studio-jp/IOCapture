# VIDEO録画のシステム音声オン/オフ切替 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VIDEOモード(MP4出力)でシステム音声を録音するかどうかをトグルで選べるようにする(Smooth/Clean両エンジン対応、prefsに永続化、デフォルトはオン)。

**Architecture:** 音声オフ時は `getDisplayMedia` での音声取得自体をスキップする方式。Main側は音声なしケースを既に処理済みのため変更なし。UI(VideoControls)→ recorder.ts の2関数に `recordAudio` フラグを渡すだけの薄い変更。

**Tech Stack:** Electron + React + TypeScript (electron-vite)。検証は `npm run typecheck` / `npm run lint`(recorder.tsはブラウザAPI依存のためユニットテストなし。仕様書のテスト方針どおり手動確認)。

**仕様書:** `docs/superpowers/specs/2026-06-05-video-audio-toggle-design.md`

---

### Task 1: Prefs型に recordAudio を追加

**Files:**
- Modify: `src/shared/ipc-types.ts`(Prefs型、60行付近)

- [ ] **Step 1: Prefs型にフィールドを追加**

`src/shared/ipc-types.ts` の `Prefs` 型の `videoFormat?: VideoFormat` の直後に1行追加:

```ts
export type Prefs = {
  aspect?: { w: number; h: number }
  stillMode?: 'px' | 'cm'
  longEdge?: number
  widthCm?: number
  dpi?: number
  videoPreset?: string
  hideSelectors?: string
  hideCursor?: boolean
  stillTimer?: number
  videoTimer?: number
  includeCursor?: boolean
  captureEngine?: 'frame' | 'screen'
  outputDir?: string
  intervalCount?: number
  intervalSec?: number
  videoFormat?: VideoFormat
  // VIDEO録画でシステム音声を録音するか(未設定はtrue扱い)
  recordAudio?: boolean
}
```

Main側の `state.ts#setPrefs` はスプレッドでマージするため変更不要。

- [ ] **Step 2: typecheckで型が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなしで終了

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat: PrefsにrecordAudio(システム音声録音の有無)を追加"
```

### Task 2: recorder.ts の2関数に recordAudio 引数を追加

**Files:**
- Modify: `src/renderer/src/lib/recorder.ts`

- [ ] **Step 1: startWindowRecording(Smooth)に recordAudio を追加**

シグネチャの `format` の直後に `recordAudio = true` を挿入し、`getDisplayMedia` の `audio` に渡す:

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

以降は既存のまま(`hadAudio` が false なら音声トラックは `outStream` に追加されず、Main側は音声なしwebmとして処理する既存パスに合流)。

- [ ] **Step 2: startRecording(Clean)に recordAudio を追加**

シグネチャの `format` の直後に `recordAudio = true` を挿入し、音声スキップ条件に加える:

```ts
export async function startRecording(
  target: TargetSize,
  includeCursor = false,
  format: 'mp4' | 'webp' = 'mp4',
  recordAudio = true,
  fps = 60,
): Promise<RecordHandle> {
```

try ブロック先頭の条件(現在 `if (format === 'webp') throw new Error('skip audio')`)を変更:

```ts
    if (format === 'webp' || !recordAudio) throw new Error('skip audio')
```

これにより音声オフ時は音声用 `getDisplayMedia` 自体が呼ばれず(権限プロンプトなし)、`hadAudio = false` のまま `stopFrameCapture(null)` の既存パスで音声なしmp4になる。

- [ ] **Step 3: typecheckで型が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなしで終了(呼び出し側 VideoControls.tsx は引数省略でデフォルト true が効くためこの時点でも壊れない)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/recorder.ts
git commit -m "feat: 録画関数にrecordAudio引数を追加(オフ時は音声取得をスキップ)"
```

### Task 3: VideoControls にシステム音声トグルUIを追加

**Files:**
- Modify: `src/renderer/src/components/VideoControls.tsx`

- [ ] **Step 1: アイコンimportを追加**

lucide-react の import 行(8行付近)に `Volume2, VolumeX` を追加:

```ts
import { Circle, Square, MousePointer2, Zap, Crop, Volume2, VolumeX } from 'lucide-react'
```

- [ ] **Step 2: state とトグル関数を追加**

`includeCursor` の state 定義(24行付近)の直後に追加:

```ts
  // システム音声を録音するか(MP4のみ。WebPは元々音声なし)
  const [recordAudio, setRecordAudioState] = useState(() => window.capture.getPrefs().recordAudio ?? true)
```

`toggleIncludeCursor`(45行付近)の直後に追加:

```ts
  const toggleRecordAudio = (): void =>
    setRecordAudioState((v) => {
      const next = !v
      window.capture.setPrefs({ recordAudio: next })
      return next
    })
```

- [ ] **Step 3: startNow で録画関数に渡し、警告トーストを条件付きに**

`startNow`(67行付近)を変更。Smooth/Clean両方に `recordAudio` を渡し、警告トーストは音声オン時のみ:

```ts
  const startNow = async (): Promise<void> => {
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      if (engine === 'screen') {
        const inset = await window.capture.getContentInset()
        handleRef.current = await startWindowRecording(rect, target, inset, format, recordAudio)
      } else {
        handleRef.current = await startRecording(target, includeCursor, format, recordAudio)
      }
      setRecording(true)
      if (effectiveFormat === 'mp4' && recordAudio && !handleRef.current.hadAudio) {
        toast.warning('Recording without audio. Grant Screen Recording permission for system audio.')
      }
    } catch (e) {
      toast.error(`Could not start recording: ${String(e)}`)
    }
  }
```

- [ ] **Step 4: トグルボタンをJSXに追加**

フォーマット選択の説明文 `{format === 'webp' && <p ...>Animated WebP (no audio)</p>}`(157行付近)の直後に追加(MP4選択時のみ表示):

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

- [ ] **Step 5: typecheck と lint を実行**

Run: `npm run typecheck && npm run lint`
Expected: 両方エラーなしで終了

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/VideoControls.tsx
git commit -m "feat: VIDEOでシステム音声のオン/オフを選べるトグルを追加"
```

### Task 4: 手動確認

**Files:** なし(動作確認のみ)

- [ ] **Step 1: devで起動して確認**

Run: `npm run dev`

確認項目(仕様書のテスト方針どおり):
1. MP4選択時に「System audio: on/off」トグルが表示される。WebP選択時は非表示
2. Clean + MP4 + 音声オン → 録画して音声入りmp4が保存される
3. Clean + MP4 + 音声オフ → 画面録画の権限プロンプトなしで録画でき、音声なしmp4が保存される
4. Smooth + MP4 + 音声オン/オフ → 同様に音声の有無が切り替わる
5. トグルをオフにしてアプリを再起動 → オフのまま保持されている
6. 音声オフ時に「Recording without audio…」の警告トーストが出ない

- [ ] **Step 2: 問題があれば修正してコミット**

問題がなければ完了。
