# VIDEOオーディオレベルメーター Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VIDEO(MP4)のAudio Select直下に、選択中音声ソースの入力レベルを常時表示するレベルメーターを追加する。

**Architecture:** RMS計算を純関数 `src/shared/audioLevel.ts` に切り出してTDD。プレビューストリーム取得+AnalyserNode+rAFループは `useAudioLevel` フックに隔離し、VideoControlsはレベル値(0〜1 | null)を受けてバーを描くだけ。recorder.ts/Main側は無変更。

**Tech Stack:** Electron + React + TypeScript (electron-vite)、vitest、Web Audio API (AnalyserNode)。

**仕様書:** `docs/superpowers/specs/2026-06-05-audio-level-meter-design.md`

---

### Task 1: shared/audioLevel.ts(純ロジック、TDD)

**Files:**
- Create: `src/shared/audioLevel.ts`
- Test: `src/shared/audioLevel.test.ts`

- [x] **Step 1: 失敗するテストを書く**

`src/shared/audioLevel.test.ts` を新規作成(スタイルは `src/shared/audioSource.test.ts` と同じ):

```ts
import { describe, it, expect } from 'vitest'
import { rmsLevel } from './audioLevel'

describe('rmsLevel', () => {
  it('無音(全サンプル128)は0', () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0)
  })
  it('フルスケール(全サンプル0 = -1.0)は1', () => {
    expect(rmsLevel(new Uint8Array(256).fill(0))).toBe(1)
  })
  it('半振幅(全サンプル192 = +0.5)は0.5', () => {
    expect(rmsLevel(new Uint8Array(256).fill(192))).toBe(0.5)
  })
  it('負方向の半振幅(全サンプル64 = -0.5)も0.5', () => {
    expect(rmsLevel(new Uint8Array(256).fill(64))).toBe(0.5)
  })
  it('空配列は0', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
})
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/audioLevel.test.ts`
Expected: FAIL(`./audioLevel` が存在しない)

- [x] **Step 3: 実装を書く**

`src/shared/audioLevel.ts` を新規作成:

```ts
/**
 * AnalyserNodeのtime domainデータ(Uint8Array、無音=128)からRMSレベルを計算する。
 * 戻り値は0(無音)〜1(フルスケール)。対数変換などの表示調整は呼び出し側で行う。
 */
export function rmsLevel(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (const v of data) {
    const n = (v - 128) / 128
    sum += n * n
  }
  return Math.sqrt(sum / data.length)
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/audioLevel.test.ts`
Expected: PASS(全5テスト)

- [x] **Step 5: 全テストとtypecheckを実行**

Run: `npm test && npm run typecheck`
Expected: 既存テスト含め全てPASS、typecheckエラーなし

- [x] **Step 6: Commit**

```bash
git add src/shared/audioLevel.ts src/shared/audioLevel.test.ts
git commit -m "feat: time domainデータからRMSレベルを計算する純関数を追加"
```

### Task 2: useAudioLevel フック

**Files:**
- Create: `src/renderer/src/lib/useAudioLevel.ts`

フックはブラウザAPI(getUserMedia/getDisplayMedia/AudioContext/rAF)に密結合なのでユニットテストは書かず、Task 4の手動確認で検証する。純ロジック(RMS)はTask 1でテスト済み。

- [x] **Step 1: フックを実装する**

`src/renderer/src/lib/useAudioLevel.ts` を新規作成:

```ts
import { useEffect, useState } from 'react'
import { AUDIO_OFF, AUDIO_SYSTEM, type AudioSource } from '../../../shared/audioSource'
import { rmsLevel } from '../../../shared/audioLevel'

/**
 * 選択中音声ソースの入力レベル(0〜1)をプレビュー用ストリームで監視して返す。
 * off・無効時・取得失敗(権限なし/未接続)・デバイス抜去はnull。
 * 録画用ストリームとは独立に開閉するので、このフックの失敗が録画に影響することはない。
 */
export function useAudioLevel(audioSource: AudioSource, enabled: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled || audioSource === AUDIO_OFF) {
      setLevel(null)
      return
    }
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

    const start = async (): Promise<void> => {
      try {
        if (audioSource === AUDIO_SYSTEM) {
          // システム音声: ループバック取得。映像トラックは使わないので即停止
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          stream.getVideoTracks().forEach((t) => t.stop())
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: audioSource } },
          })
        }
        const track = stream.getAudioTracks()[0]
        if (cancelled || !track) {
          stream.getTracks().forEach((t) => t.stop())
          if (!cancelled) setLevel(null)
          return
        }
        // デバイス抜去でトラックが終了したらメーターを消す(再取得は選び直し時のみ)
        track.addEventListener('ended', () => {
          if (!cancelled) setLevel(null)
        })
        ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(new MediaStream([track]))
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        let prev = -1
        const tick = (): void => {
          analyser.getByteTimeDomainData(data)
          const v = rmsLevel(data)
          // 微小変化ではsetStateしない(再レンダー抑制)
          if (Math.abs(v - prev) > 0.01) {
            prev = v
            setLevel(v)
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // 権限なし・デバイス未接続など。メーター非表示にするだけで何も壊さない
        stream?.getTracks().forEach((t) => t.stop())
        stream = null
        if (!cancelled) setLevel(null)
      }
    }
    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
      setLevel(null)
    }
  }, [audioSource, enabled])

  return level
}
```

- [x] **Step 2: typecheckとlintで確認**

Run: `npm run typecheck && npx eslint src/renderer/src/lib/useAudioLevel.ts`
Expected: typecheckエラーなし、新規ファイルにlintエラーなし(リポジトリ全体の `npm run lint` には既存ファイル由来のエラーがあるため、新規ファイル単体で確認する)

- [x] **Step 3: Commit**

```bash
git add src/renderer/src/lib/useAudioLevel.ts
git commit -m "feat: 音声ソースの入力レベルを監視するuseAudioLevelフックを追加"
```

### Task 3: VideoControls にレベルメーターを追加

**Files:**
- Modify: `src/renderer/src/components/VideoControls.tsx`

- [x] **Step 1: importを追加**

import群(`resolveAudioSource` のimportの後)に追加:

```ts
import { useAudioLevel } from '../lib/useAudioLevel'
```

- [x] **Step 2: フックを呼ぶ**

`audioDevices` のstate定義の直後に追加:

```ts
  // 選択中ソースの入力レベル(0〜1)。off/WebP/取得失敗時はnull
  const audioLevel = useAudioLevel(audioSource, format === 'mp4')
```

- [x] **Step 3: JSXにメーターを追加**

Audio Selectブロック内、`</Select>` の直後(`</div>` の前)に追加:

```tsx
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
```

変更後のAudioブロック全体は以下になる:

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
```

- [x] **Step 4: typecheck・テスト・lintを実行**

Run: `npm run typecheck && npm test && npx eslint src/renderer/src/components/VideoControls.tsx`
Expected: typecheck・全テストPASS。lintは既存3エラー(24:8 / 102:23 / 139:29 付近の Missing return type 等)のみで、今回の追加による新規エラーがないこと

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/components/VideoControls.tsx
git commit -m "feat: Audio Select直下にオーディオレベルメーターを追加"
```

### Task 4: 手動確認

**Files:** なし(動作確認のみ)

- [ ] **Step 1: devで起動して確認**

Run: `npm run dev`

確認項目(仕様書のテスト方針どおり):
1. MP4 + System audio選択 → 音楽を再生するとメーターが振れる
2. BlackHole等のデバイス選択 → そのデバイスに流した音だけでメーターが振れる
3. Audio off選択 / WebP選択 → メーター非表示
4. 録画中もメーターが動き続ける(録画は正常に保存される)
5. デバイス選択中に取り外し → メーターが消える(エラーにならない)
6. ソースを切り替えるとメーターが追従する(古いストリームが解放され、アクティビティモニタ等でリークがない)

- [ ] **Step 2: 問題があれば修正してコミット**

問題がなければ完了。
