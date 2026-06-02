# WebGL作品キャプチャツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザのWebGL/ジェネラティブ作品を、操作しながら比率・解像度を制御して静止画(PNG透過)と動画(mp4・音込み)でキャプチャするElectronデスクトップツールを作る。

**Architecture:** 1枚のElectronウィンドウ内で、シェルUI(React+shadcn)が「枠の矩形」を計算し、Mainがその矩形ピッタリにWebContentsView(作品)を重ねて配置する。見えている枠＝ビューのbounds＝キャプチャ対象なので操作枠と撮影枠が構造的に一致する。静止画は撮る瞬間だけdeviceScaleFactorを上げてcapturePage、動画はdesktopCapturer→canvasクロップ→システム音声合成→MediaRecorder→ffmpegでmp4。

**Tech Stack:** Electron, TypeScript, electron-vite, React, Tailwind CSS, shadcn/ui, vitest, ffmpeg-static

---

## ファイル構成

| ファイル | 責務 |
|---------|------|
| `src/shared/aspect.ts` | アスペクト比の型・プリセット・パース |
| `src/shared/frameRect.ts` | ステージ領域に比率を内接させた枠矩形の計算 |
| `src/shared/resolution.ts` | cm/dpi→px、長辺→W×H など目標サイズ計算 |
| `src/shared/dpr.ts` | deviceScaleFactor導出・GPU上限チェック |
| `src/shared/videoResolution.ts` | 比率ごとの動画解像度プリセット |
| `src/shared/ipc-types.ts` | Main↔Renderer のIPCチャネル名と型 |
| `src/main/index.ts` | アプリ起動・BrowserWindow生成 |
| `src/main/artworkView.ts` | WebContentsView生成・URL読込・矩形配置・DPR制御 |
| `src/main/capture.ts` | 静止画capturePage＋PNG保存 |
| `src/main/displayMedia.ts` | setDisplayMediaRequestHandler(loopback音声) |
| `src/main/ffmpeg.ts` | webm→mp4変換 |
| `src/main/ipc.ts` | IPCハンドラ登録 |
| `src/preload/index.ts` | contextBridgeでrendererへAPI公開 |
| `src/renderer/src/App.tsx` | シェルUI全体(URLバー・ステージ・サイドパネル) |
| `src/renderer/src/components/*` | shadcnコンポーネントと自作コントロール |
| `src/renderer/src/lib/recorder.ts` | 動画録画パイプライン |
| `docs/manual-test-checklist.md` | キャプチャ系の手動テスト手順 |

---

## Phase 0: プロジェクト雛形

### Task 1: electron-vite + React + TS 雛形生成

**Files:**
- Create: プロジェクト全体（`package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/` 一式）

- [ ] **Step 1: 雛形を生成**

カレントが空のgitリポジトリである前提（specコミット済み）。雛形は一時ディレクトリに作って中身を移す。

Run:
```bash
cd /Users/chiakiuehira/Desktop/record
npm create @quick-start/electron@latest tmp-scaffold -- --template react-ts
cp -R tmp-scaffold/. .
rm -rf tmp-scaffold
npm install
```

- [ ] **Step 2: 起動確認**

Run: `npm run dev`
Expected: Electronウィンドウが開き、雛形のReact画面（"Powered by electron-vite"等）が表示される。確認後 Ctrl+C で終了。

- [ ] **Step 3: コミット**

```bash
git add -A
git commit -m "chore: electron-vite + React + TS 雛形"
```

### Task 2: vitest 導入（shared用のユニットテスト基盤）

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: vitest をインストール**

Run: `npm install -D vitest`

- [ ] **Step 2: 設定ファイルを作成**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/shared/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: package.json にスクリプト追加**

`package.json` の `scripts` に追記:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 動作確認用の捨てテスト**

Create `src/shared/smoke.test.ts`:
```ts
import { test, expect } from 'vitest'
test('vitest works', () => { expect(1 + 1).toBe(2) })
```

Run: `npm test`
Expected: 1 passed。確認後 `rm src/shared/smoke.test.ts`

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "chore: vitest 導入"
```

### Task 3: Tailwind + shadcn/ui 初期化

**Files:**
- Modify: `src/renderer/` 配下（Tailwind設定・`components.json`）

- [ ] **Step 1: Tailwind と依存を導入**

Run:
```bash
npm install -D tailwindcss@latest postcss autoprefixer
npm install class-variance-authority clsx tailwind-merge lucide-react tailwindcss-animate
```

- [ ] **Step 2: Tailwind設定を作成**

Create `src/renderer/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [require('tailwindcss-animate')],
}
```

Create `src/renderer/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`src/renderer/src/assets/` のCSS（雛形のmain.cssまたはbase.css）の先頭に追記:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: shadcn を初期化**

Run: `npx shadcn@latest init`
回答例: style=Default, baseColor=Zinc, CSS variables=yes。
`components.json` が生成され、`@/components` のエイリアスが設定される。電子環境では `tsconfig` と `electron.vite.config.ts` の resolve alias（`@` → `src/renderer/src`）が必要なので、無ければ追加する。

`electron.vite.config.ts` の renderer セクションに alias を確認/追加:
```ts
resolve: { alias: { '@': resolve('src/renderer/src') } }
```
（`import { resolve } from 'path'` を冒頭に）

- [ ] **Step 4: 必要コンポーネントを追加**

Run:
```bash
npx shadcn@latest add button input select slider label dialog sonner tabs
```

- [ ] **Step 5: 起動して Tailwind が効くか確認**

`App.tsx` の適当な要素に `className="text-2xl font-bold text-red-500"` を一時的に付け、`npm run dev` で赤い太字になるか確認。確認後に戻す。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "chore: Tailwind + shadcn/ui 初期化"
```

---

## Phase 1: 純粋ロジック (src/shared) — TDD

### Task 4: アスペクト比モジュール

**Files:**
- Create: `src/shared/aspect.ts`
- Test: `src/shared/aspect.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/shared/aspect.test.ts`:
```ts
import { test, expect } from 'vitest'
import { parseAspect, aspectRatio, ASPECT_PRESETS } from './aspect'

test('parseAspect parses "16:9"', () => {
  expect(parseAspect('16:9')).toEqual({ w: 16, h: 9 })
})
test('parseAspect trims spaces', () => {
  expect(parseAspect(' 4 : 5 ')).toEqual({ w: 4, h: 5 })
})
test('parseAspect rejects non-positive', () => {
  expect(parseAspect('0:5')).toBeNull()
  expect(parseAspect('4:-1')).toBeNull()
  expect(parseAspect('abc')).toBeNull()
})
test('aspectRatio returns w/h', () => {
  expect(aspectRatio({ w: 16, h: 9 })).toBeCloseTo(16 / 9)
})
test('presets include 1:1 and 16:9', () => {
  const labels = ASPECT_PRESETS.map((p) => p.label)
  expect(labels).toContain('1:1')
  expect(labels).toContain('16:9')
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/aspect.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

Create `src/shared/aspect.ts`:
```ts
export type Aspect = { w: number; h: number }

export function parseAspect(input: string): Aspect | null {
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return { w, h }
}

export function aspectRatio(a: Aspect): number {
  return a.w / a.h
}

export const ASPECT_PRESETS: { label: string; aspect: Aspect }[] = [
  { label: '1:1', aspect: { w: 1, h: 1 } },
  { label: '4:5', aspect: { w: 4, h: 5 } },
  { label: '5:4', aspect: { w: 5, h: 4 } },
  { label: '3:2', aspect: { w: 3, h: 2 } },
  { label: '2:3', aspect: { w: 2, h: 3 } },
  { label: '16:9', aspect: { w: 16, h: 9 } },
  { label: '9:16', aspect: { w: 9, h: 16 } },
]
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run src/shared/aspect.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/aspect.ts src/shared/aspect.test.ts
git commit -m "feat: アスペクト比モジュール"
```

### Task 5: 枠矩形の計算

**Files:**
- Create: `src/shared/frameRect.ts`
- Test: `src/shared/frameRect.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/shared/frameRect.test.ts`:
```ts
import { test, expect } from 'vitest'
import { computeFrameRect } from './frameRect'

test('square aspect in wide stage is centered horizontally', () => {
  const r = computeFrameRect({ width: 400, height: 200 }, { w: 1, h: 1 }, 0)
  expect(r).toEqual({ x: 100, y: 0, width: 200, height: 200 })
})
test('16:9 in tall stage is centered vertically', () => {
  const r = computeFrameRect({ width: 160, height: 200 }, { w: 16, h: 9 }, 0)
  expect(r).toEqual({ x: 0, y: 55, width: 160, height: 90 })
})
test('padding shrinks the available area', () => {
  const r = computeFrameRect({ width: 220, height: 220 }, { w: 1, h: 1 }, 10)
  expect(r).toEqual({ x: 10, y: 10, width: 200, height: 200 })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/frameRect.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

Create `src/shared/frameRect.ts`:
```ts
import type { Aspect } from './aspect'

export type Rect = { x: number; y: number; width: number; height: number }

/** ステージ領域(padding控除後)に aspect を最大内接させ、中央寄せした矩形を返す。 */
export function computeFrameRect(
  stage: { width: number; height: number },
  aspect: Aspect,
  padding = 16,
): Rect {
  const availW = Math.max(0, stage.width - padding * 2)
  const availH = Math.max(0, stage.height - padding * 2)
  const target = aspect.w / aspect.h
  let width = availW
  let height = width / target
  if (height > availH) {
    height = availH
    width = height * target
  }
  width = Math.round(width)
  height = Math.round(height)
  const x = padding + Math.round((availW - width) / 2)
  const y = padding + Math.round((availH - height) / 2)
  return { x, y, width, height }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run src/shared/frameRect.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/frameRect.ts src/shared/frameRect.test.ts
git commit -m "feat: 枠矩形の計算"
```

### Task 6: 解像度・実寸モデル

**Files:**
- Create: `src/shared/resolution.ts`
- Test: `src/shared/resolution.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/shared/resolution.test.ts`:
```ts
import { test, expect } from 'vitest'
import { cmToPx, targetFromLongEdge, targetFromWidthCm } from './resolution'

test('cmToPx: 10cm @ 300dpi = 1181px', () => {
  expect(cmToPx(10, 300)).toBe(1181)
})
test('targetFromLongEdge keeps aspect, long edge exact (landscape)', () => {
  expect(targetFromLongEdge({ w: 16, h: 9 }, 1600)).toEqual({ width: 1600, height: 900 })
})
test('targetFromLongEdge keeps aspect, long edge exact (portrait)', () => {
  expect(targetFromLongEdge({ w: 4, h: 5 }, 1000)).toEqual({ width: 800, height: 1000 })
})
test('targetFromWidthCm derives height from aspect', () => {
  // 幅10cm @300dpi=1181px, 1:1 → 1181x1181
  expect(targetFromWidthCm({ w: 1, h: 1 }, 10, 300)).toEqual({ width: 1181, height: 1181 })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/resolution.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

Create `src/shared/resolution.ts`:
```ts
import type { Aspect } from './aspect'

export type TargetSize = { width: number; height: number }

export function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi)
}

/** 長辺ピクセルを固定し、比率からもう片方を導出。 */
export function targetFromLongEdge(aspect: Aspect, longEdgePx: number): TargetSize {
  const ratio = aspect.w / aspect.h
  if (ratio >= 1) {
    return { width: longEdgePx, height: Math.round(longEdgePx / ratio) }
  }
  return { width: Math.round(longEdgePx * ratio), height: longEdgePx }
}

/** 幅をcm+dpiで固定し、比率から高さを導出。 */
export function targetFromWidthCm(aspect: Aspect, widthCm: number, dpi: number): TargetSize {
  const width = cmToPx(widthCm, dpi)
  const ratio = aspect.w / aspect.h
  return { width, height: Math.round(width / ratio) }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run src/shared/resolution.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/resolution.ts src/shared/resolution.test.ts
git commit -m "feat: 解像度・実寸モデル"
```

### Task 7: DPR導出・GPU上限チェック

**Files:**
- Create: `src/shared/dpr.ts`
- Test: `src/shared/dpr.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/shared/dpr.test.ts`:
```ts
import { test, expect } from 'vitest'
import { deriveDeviceScaleFactor, MAX_GPU_DIMENSION, capToGpuLimit } from './dpr'

test('deriveDeviceScaleFactor = target / css', () => {
  expect(deriveDeviceScaleFactor(2400, 800)).toBe(3)
})
test('capToGpuLimit leaves small sizes untouched', () => {
  expect(capToGpuLimit({ width: 2000, height: 1000 })).toEqual({
    ok: true,
    size: { width: 2000, height: 1000 },
  })
})
test('capToGpuLimit scales down oversize keeping aspect', () => {
  const res = capToGpuLimit({ width: 32768, height: 16384 })
  expect(res.ok).toBe(false)
  expect(res.size.width).toBe(MAX_GPU_DIMENSION)
  expect(res.size.height).toBe(MAX_GPU_DIMENSION / 2)
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/dpr.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

Create `src/shared/dpr.ts`:
```ts
import type { TargetSize } from './resolution'

export const MAX_GPU_DIMENSION = 16384

export function deriveDeviceScaleFactor(targetPx: number, cssPx: number): number {
  return targetPx / cssPx
}

/** どちらかの辺が上限超なら、比率を保って上限内に縮める。 */
export function capToGpuLimit(size: TargetSize): { ok: boolean; size: TargetSize } {
  const maxDim = Math.max(size.width, size.height)
  if (maxDim <= MAX_GPU_DIMENSION) return { ok: true, size }
  const scale = MAX_GPU_DIMENSION / maxDim
  return {
    ok: false,
    size: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    },
  }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run src/shared/dpr.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/dpr.ts src/shared/dpr.test.ts
git commit -m "feat: DPR導出・GPU上限チェック"
```

### Task 8: 動画解像度プリセット

**Files:**
- Create: `src/shared/videoResolution.ts`
- Test: `src/shared/videoResolution.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/shared/videoResolution.test.ts`:
```ts
import { test, expect } from 'vitest'
import { videoPresetsFor } from './videoResolution'

test('square presets are NxN', () => {
  const presets = videoPresetsFor({ w: 1, h: 1 })
  const p1080 = presets.find((p) => p.label === '1080')!
  expect(p1080.size).toEqual({ width: 1080, height: 1080 })
})
test('16:9 1080 preset is 1920x1080', () => {
  const presets = videoPresetsFor({ w: 16, h: 9 })
  const p = presets.find((p) => p.label === '1080')!
  expect(p.size).toEqual({ width: 1920, height: 1080 })
})
test('includes match-frame entry', () => {
  const presets = videoPresetsFor({ w: 4, h: 5 })
  expect(presets.some((p) => p.label === '枠に合わせる')).toBe(true)
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/videoResolution.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

Create `src/shared/videoResolution.ts`:
```ts
import type { Aspect } from './aspect'
import type { TargetSize } from './resolution'

/** 短辺(高さ基準)の値からW×Hを作る。比率を保つ。 */
function sizeForShortEdge(aspect: Aspect, height: number): TargetSize {
  const ratio = aspect.w / aspect.h
  // 偶数に丸める（動画コーデックは偶数寸法を好む）
  const width = Math.round((height * ratio) / 2) * 2
  return { width, height }
}

export function videoPresetsFor(
  aspect: Aspect,
): { label: string; size: TargetSize | null }[] {
  return [
    { label: '1080', size: sizeForShortEdge(aspect, 1080) },
    { label: '1440', size: sizeForShortEdge(aspect, 1440) },
    { label: '2160', size: sizeForShortEdge(aspect, 2160) },
    { label: '枠に合わせる', size: null }, // 実行時に枠の実ピクセルを使う
  ]
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run src/shared/videoResolution.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/videoResolution.ts src/shared/videoResolution.test.ts
git commit -m "feat: 動画解像度プリセット"
```

### Task 9: IPC型定義

**Files:**
- Create: `src/shared/ipc-types.ts`

- [ ] **Step 1: 型を定義（テスト不要の宣言のみ）**

Create `src/shared/ipc-types.ts`:
```ts
import type { Rect } from './frameRect'
import type { TargetSize } from './resolution'

export const IPC = {
  loadUrl: 'artwork:loadUrl',
  setFrameRect: 'artwork:setFrameRect',
  captureStill: 'capture:still',
  convertToMp4: 'video:convertToMp4',
  saveBlob: 'file:saveBlob',
} as const

export type LoadUrlArgs = { url: string }
export type SetFrameRectArgs = { rect: Rect }
export type CaptureStillArgs = { target: TargetSize; transparent: boolean }
export type CaptureStillResult = { ok: true; savedPath: string } | { ok: false; error: string }
export type ConvertToMp4Args = { webmPath: string }
export type ConvertToMp4Result = { ok: true; mp4Path: string } | { ok: false; error: string }
export type SaveBlobArgs = { data: ArrayBuffer; defaultName: string }
export type SaveBlobResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p tsconfig.node.json`（雛形のtsconfig名に合わせる。sharedが含まれる構成を確認）
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat: IPC型定義"
```

---

## Phase 2: Main プロセス

### Task 10: 作品ビュー(WebContentsView)管理

**Files:**
- Create: `src/main/artworkView.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 作品ビューのモジュールを実装**

Create `src/main/artworkView.ts`:
```ts
import { WebContentsView, BrowserWindow } from 'electron'
import type { Rect } from '../shared/frameRect'

let view: WebContentsView | null = null

export function ensureArtworkView(win: BrowserWindow): WebContentsView {
  if (view) return view
  view = new WebContentsView()
  win.contentView.addChildView(view)
  view.setBorderRadius?.(0)
  return view
}

export function loadArtworkUrl(win: BrowserWindow, url: string): void {
  const v = ensureArtworkView(win)
  v.webContents.loadURL(url)
}

export function setArtworkRect(rect: Rect): void {
  view?.setBounds(rect)
}

/** 撮る瞬間だけ高DPRにする。終わったら戻す。 */
export async function withDeviceScale<T>(
  scale: number,
  fn: (v: WebContentsView) => Promise<T>,
): Promise<T> {
  if (!view) throw new Error('artwork view not ready')
  const wc = view.webContents
  wc.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: 0, height: 0 },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: 0, height: 0 },
    scale: 1,
    deviceScaleFactor: scale,
  } as Electron.Parameters)
  try {
    // 反映を待つ（再描画を数フレーム待機）
    await new Promise((r) => setTimeout(r, 120))
    return await fn(view)
  } finally {
    wc.disableDeviceEmulation()
  }
}

export function getArtworkView(): WebContentsView | null {
  return view
}
```

- [ ] **Step 2: index.ts でウィンドウ生成時にビューを用意**

`src/main/index.ts` の `createWindow()` 内、`mainWindow.on('ready-to-show', ...)` の後あたりに追記:
```ts
import { ensureArtworkView } from './artworkView'
// ...
mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  ensureArtworkView(mainWindow)
})
```

- [ ] **Step 3: 起動確認**

Run: `npm run dev`
Expected: 起動してエラーが出ない（まだ何も読み込まないので見た目は変化なし）。コンソールに例外が無いこと。

- [ ] **Step 4: コミット**

```bash
git add src/main/artworkView.ts src/main/index.ts
git commit -m "feat: 作品ビュー(WebContentsView)管理"
```

### Task 11: preload で API公開

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`（雛形にあれば）

- [ ] **Step 1: contextBridge でレンダラー向けAPIを公開**

`src/preload/index.ts` を以下で置き換え（雛形の electron-toolkit のパターンを踏襲）:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc-types'
import type {
  CaptureStillArgs, CaptureStillResult,
  ConvertToMp4Args, ConvertToMp4Result,
  SaveBlobArgs, SaveBlobResult,
} from '../shared/ipc-types'
import type { Rect } from '../shared/frameRect'

const api = {
  loadUrl: (url: string) => ipcRenderer.invoke(IPC.loadUrl, { url }),
  setFrameRect: (rect: Rect) => ipcRenderer.send(IPC.setFrameRect, { rect }),
  captureStill: (args: CaptureStillArgs): Promise<CaptureStillResult> =>
    ipcRenderer.invoke(IPC.captureStill, args),
  convertToMp4: (args: ConvertToMp4Args): Promise<ConvertToMp4Result> =>
    ipcRenderer.invoke(IPC.convertToMp4, args),
  saveBlob: (args: SaveBlobArgs): Promise<SaveBlobResult> =>
    ipcRenderer.invoke(IPC.saveBlob, args),
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('capture', api)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.capture = api
}

export type CaptureAPI = typeof api
```

- [ ] **Step 2: 型宣言を追加**

Create/replace `src/preload/index.d.ts`:
```ts
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { CaptureAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    capture: CaptureAPI
  }
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`（雛形に用意されているスクリプト。無ければ `npx tsc --noEmit`）
Expected: エラー無し

- [ ] **Step 4: コミット**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: preload で capture API を公開"
```

### Task 12: IPCハンドラ（URL読込・矩形配置）

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: ハンドラを実装**

Create `src/main/ipc.ts`:
```ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-types'
import type { LoadUrlArgs, SetFrameRectArgs } from '../shared/ipc-types'
import { loadArtworkUrl, setArtworkRect } from './artworkView'

export function registerIpc(getWindow: () => BrowserWindow): void {
  ipcMain.handle(IPC.loadUrl, (_e, args: LoadUrlArgs) => {
    loadArtworkUrl(getWindow(), args.url)
    return { ok: true }
  })

  ipcMain.on(IPC.setFrameRect, (_e, args: SetFrameRectArgs) => {
    setArtworkRect(args.rect)
  })
}
```

- [ ] **Step 2: index.ts で登録**

`src/main/index.ts` の `app.whenReady().then(...)` 内、ウィンドウ生成後に追記:
```ts
import { registerIpc } from './ipc'
// createWindow() のあと
registerIpc(() => BrowserWindow.getAllWindows()[0])
```

- [ ] **Step 3: 手動確認**

`npm run dev` 起動後、レンダラーのDevToolsコンソールで:
```js
await window.capture.loadUrl('https://threejs.org/examples/#webgl_geometry_cube')
window.capture.setFrameRect({ x: 50, y: 50, width: 600, height: 600 })
```
Expected: ウィンドウ左上(50,50)に600×600でthree.jsのサンプルが表示される。

- [ ] **Step 4: コミット**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: IPCハンドラ(URL読込・矩形配置)"
```

### Task 13: 静止画キャプチャ（高DPR + capturePage + 保存）

**Files:**
- Create: `src/main/capture.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: capture モジュールを実装**

Create `src/main/capture.ts`:
```ts
import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { withDeviceScale, getArtworkView } from './artworkView'
import { deriveDeviceScaleFactor } from '../shared/dpr'
import type { CaptureStillArgs, CaptureStillResult } from '../shared/ipc-types'

export async function captureStill(args: CaptureStillArgs): Promise<CaptureStillResult> {
  const view = getArtworkView()
  if (!view) return { ok: false, error: 'view not ready' }

  const bounds = view.getBounds()
  const cssW = bounds.width
  const scale = deriveDeviceScaleFactor(args.target.width, cssW)

  try {
    const image = await withDeviceScale(scale, async (v) => {
      return v.webContents.capturePage() // viewport全域
    })
    const png = image.toPNG()

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return { ok: false, error: 'canceled' }
    await writeFile(filePath, png)
    return { ok: true, savedPath: filePath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
```

> 注: 透過PNGは作品canvasのアルファとwebContentsの背景透過に依存する。背景透過が要る作品では、ビュー生成時に `transparent` なwebContents設定が必要になる場合がある。v1は不透明背景を既定とし、透過は作品が対応していれば反映される範囲とする。

- [ ] **Step 2: ipc.ts にハンドラ追加**

`src/main/ipc.ts` の `registerIpc` 内に追記:
```ts
import { captureStill } from './capture'
import type { CaptureStillArgs } from '../shared/ipc-types'
// ...
ipcMain.handle(IPC.captureStill, (_e, args: CaptureStillArgs) => captureStill(args))
```

- [ ] **Step 3: 手動確認**

`npm run dev`、DevToolsコンソールで作品を読み込んだ後:
```js
const r = await window.capture.captureStill({ target: { width: 3000, height: 3000 }, transparent: false })
console.log(r)
```
Expected: 保存ダイアログが出て、保存したPNGが約3000×3000px（枠が正方形の場合）になっている。`sips -g pixelWidth -g pixelHeight <file>` で確認。

- [ ] **Step 4: コミット**

```bash
git add src/main/capture.ts src/main/ipc.ts
git commit -m "feat: 静止画キャプチャ(高DPR+capturePage)"
```

### Task 14: システム音声ループバックのハンドラ

**Files:**
- Create: `src/main/displayMedia.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: displayMedia ハンドラを実装**

Create `src/main/displayMedia.ts`:
```ts
import { session, desktopCapturer } from 'electron'

/** レンダラーの getDisplayMedia 要求に対し、アプリウィンドウ映像＋ループバック音声を返す。 */
export function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
        // 自アプリのウィンドウを優先（なければ最初のソース）
        const own = sources.find((s) => /record|capture/i.test(s.name)) ?? sources[0]
        // macOS(ScreenCaptureKit)対応なら 'loopback' でシステム音声、不可なら音声なし
        callback({ video: own, audio: 'loopback' })
      })
    },
    { useSystemPicker: false },
  )
}
```

> macOSで `audio: 'loopback'` が不可な環境では映像のみが返る。レンダラー側は音声トラックの有無を検出して通知する（Task 18）。

- [ ] **Step 2: index.ts で登録**

`src/main/index.ts` の `app.whenReady().then(...)` 内、`registerIpc` の近くに追記:
```ts
import { registerDisplayMediaHandler } from './displayMedia'
// ...
registerDisplayMediaHandler()
```

- [ ] **Step 3: 起動確認**

`npm run dev` で起動し、コンソールに例外が出ないことのみ確認（実際の録画はTask 18で検証）。

- [ ] **Step 4: コミット**

```bash
git add src/main/displayMedia.ts src/main/index.ts
git commit -m "feat: システム音声ループバックのdisplayMediaハンドラ"
```

### Task 15: webm→mp4 変換（ffmpeg）＋ Blob保存

**Files:**
- Create: `src/main/ffmpeg.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: ffmpeg-static を導入**

Run: `npm install ffmpeg-static`

`electron.vite.config.ts` の main セクションで ffmpeg-static を external 扱いにする（bundleせずnode_modulesから解決）。`build.rollupOptions.external` に `'ffmpeg-static'` を追加。

- [ ] **Step 2: ffmpeg モジュールを実装**

Create `src/main/ffmpeg.ts`:
```ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'
import type { ConvertToMp4Args, ConvertToMp4Result } from '../shared/ipc-types'

const run = promisify(execFile)

export async function convertToMp4(args: ConvertToMp4Args): Promise<ConvertToMp4Result> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  const mp4Path = args.webmPath.replace(/\.webm$/i, '') + '.mp4'
  try {
    await run(ffmpegPath, [
      '-y',
      '-i', args.webmPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      mp4Path,
    ])
    return { ok: true, mp4Path }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
```

- [ ] **Step 3: Blob保存ハンドラを ipc.ts に追加**

`src/main/ipc.ts` に追記:
```ts
import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { convertToMp4 } from './ffmpeg'
import type { ConvertToMp4Args, SaveBlobArgs } from '../shared/ipc-types'
// registerIpc 内:
ipcMain.handle(IPC.convertToMp4, (_e, args: ConvertToMp4Args) => convertToMp4(args))

ipcMain.handle(IPC.saveBlob, async (_e, args: SaveBlobArgs) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: args.defaultName,
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  await writeFile(filePath, Buffer.from(args.data))
  return { ok: true, path: filePath }
})
```

- [ ] **Step 4: 手動確認**

任意のwebmを用意し、DevToolsで:
```js
const r = await window.capture.convertToMp4({ webmPath: '/絶対パス/test.webm' })
console.log(r)
```
Expected: 同ディレクトリに `.mp4` が生成され再生できる。

- [ ] **Step 5: コミット**

```bash
git add src/main/ffmpeg.ts src/main/ipc.ts electron.vite.config.ts package.json
git commit -m "feat: webm→mp4変換とBlob保存"
```

---

## Phase 3: Renderer シェルUI (React + shadcn)

### Task 16: ステージレイアウトと枠矩形の通知

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/lib/useFrameRect.ts`

- [ ] **Step 1: 枠矩形を計算してMainへ送るフックを実装**

Create `src/renderer/src/lib/useFrameRect.ts`:
```ts
import { useEffect, useRef } from 'react'
import { computeFrameRect } from '../../../shared/frameRect'
import type { Aspect } from '../../../shared/aspect'

/** stage要素の実サイズから枠矩形を計算し、Mainへ送る。ResizeObserverで追従。 */
export function useFrameRect(aspect: Aspect) {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      const rect = computeFrameRect({ width: r.width, height: r.height }, aspect, 16)
      // ステージはウィンドウ内のオフセットを持つため加算
      window.capture.setFrameRect({
        x: Math.round(r.left + rect.x),
        y: Math.round(r.top + rect.y),
        width: rect.width,
        height: rect.height,
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [aspect])

  return stageRef
}
```

> 重要: WebContentsView はウィンドウ左上原点の絶対座標で配置される。ステージ要素の `getBoundingClientRect().left/top`（＝ウィンドウ内オフセット）を枠矩形に加算すること。これで「見えている枠＝ビュー」が一致する。

- [ ] **Step 2: App.tsx に右パネルレイアウトを実装**

`src/renderer/src/App.tsx` を置き換え:
```tsx
import { useState } from 'react'
import { ASPECT_PRESETS, type Aspect } from '../../shared/aspect'
import { useFrameRect } from './lib/useFrameRect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function App(): JSX.Element {
  const [url, setUrl] = useState('')
  const [aspect, setAspect] = useState<Aspect>({ w: 1, h: 1 })
  const stageRef = useFrameRect(aspect)

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex gap-2 border-b border-zinc-800 p-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="flex-1"
        />
        <Button onClick={() => window.capture.loadUrl(url)}>読込</Button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div ref={stageRef} className="relative flex-1 bg-black" />
        <aside className="w-64 border-l border-zinc-800 p-3 space-y-3">
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
        </aside>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 任意W:H入力を追加**

`src/renderer/src/App.tsx` の `aside` 内、比率プリセットの下に任意W:H入力を追加する。importに `parseAspect` を加える（`import { ASPECT_PRESETS, parseAspect, type Aspect } from '../../shared/aspect'`）。`useState` で `const [customAspect, setCustomAspect] = useState('')` を足し、以下を `aside` 内に追記:
```tsx
<div className="flex items-center gap-1">
  <Input
    value={customAspect}
    onChange={(e) => setCustomAspect(e.target.value)}
    placeholder="任意 W:H 例 21:9"
    className="h-8"
  />
  <Button
    size="sm"
    onClick={() => {
      const a = parseAspect(customAspect)
      if (a) setAspect(a)
    }}
  >
    適用
  </Button>
</div>
```

- [ ] **Step 4: 手動確認**

`npm run dev`、URLを入れて読込→比率ボタンを切替、任意W:H（例 `21:9`）を適用。
Expected: 黒ステージ内に作品が表示され、比率を変えると枠（＝作品ビュー）の形が即座に変わり、中央に収まる。ステージ領域からはみ出さない。任意W:Hも反映される。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/App.tsx src/renderer/src/lib/useFrameRect.ts
git commit -m "feat: ステージレイアウトと枠矩形通知(任意W:H含む)"
```

### Task 17: 解像度コントロール（静止画）

**Files:**
- Create: `src/renderer/src/components/StillControls.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 静止画コントロールを実装**

Create `src/renderer/src/components/StillControls.tsx`:
```tsx
import { useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import { targetFromLongEdge, targetFromWidthCm } from '../../../shared/resolution'
import { capToGpuLimit } from '../../../shared/dpr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export function StillControls({ aspect }: { aspect: Aspect }): JSX.Element {
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
    if (!ok) toast.warning(`GPU上限のため ${size.width}×${size.height}px に縮小しました`)
    const res = await window.capture.captureStill({ target: size, transparent: true })
    if (res.ok) toast.success(`保存: ${res.savedPath}`)
    else if (res.error !== 'canceled') toast.error(`失敗: ${res.error}`)
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">静止画</div>
      <div className="flex gap-1">
        <Button size="sm" variant={mode === 'px' ? 'default' : 'secondary'} onClick={() => setMode('px')}>px</Button>
        <Button size="sm" variant={mode === 'cm' ? 'default' : 'secondary'} onClick={() => setMode('cm')}>cm/dpi</Button>
      </div>
      {mode === 'px' ? (
        <div>
          <Label className="text-xs">長辺px</Label>
          <Input type="number" value={longEdge} onChange={(e) => setLongEdge(+e.target.value)} />
        </div>
      ) : (
        <div className="flex gap-2">
          <div>
            <Label className="text-xs">幅cm</Label>
            <Input type="number" value={widthCm} onChange={(e) => setWidthCm(+e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">dpi</Label>
            <Input type="number" value={dpi} onChange={(e) => setDpi(+e.target.value)} />
          </div>
        </div>
      )}
      <Button className="w-full" onClick={onCapture}>📷 静止画を撮る</Button>
    </div>
  )
}
```

- [ ] **Step 2: sonner の Toaster を App に設置**

`src/renderer/src/App.tsx` の冒頭import群に `import { Toaster } from '@/components/ui/sonner'`、`StillControls` をimportし、`aside` 内に `<StillControls aspect={aspect} />`、ルートの最後に `<Toaster />` を追加。

- [ ] **Step 3: 手動確認**

作品読込後、長辺3000で「静止画を撮る」。
Expected: 保存ダイアログ→PNG保存。`sips`で約3000pxを確認。cm/dpiモードで10cm/300dpiなら約1181px。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/components/StillControls.tsx src/renderer/src/App.tsx
git commit -m "feat: 静止画の解像度コントロール"
```

### Task 18: 動画録画パイプライン

**Files:**
- Create: `src/renderer/src/lib/recorder.ts`
- Create: `src/renderer/src/components/VideoControls.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 録画ロジックを実装**

Create `src/renderer/src/lib/recorder.ts`:
```ts
import type { Rect } from '../../../shared/frameRect'
import type { TargetSize } from '../../../shared/resolution'

export type RecordHandle = {
  stop: () => Promise<{ blob: Blob; hadAudio: boolean }>
}

/**
 * アプリウィンドウのストリームを取得し、frameRect でクロップ、
 * targetでスケールして MediaRecorder で録画する。音声があれば合成。
 */
export async function startRecording(
  frameRect: Rect,
  target: TargetSize,
  fps = 30,
): Promise<RecordHandle> {
  // Main の displayMedia ハンドラが映像＋loopback音声を返す
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  })
  const hadAudio = stream.getAudioTracks().length > 0

  const videoEl = document.createElement('video')
  videoEl.srcObject = new MediaStream(stream.getVideoTracks())
  videoEl.muted = true
  await videoEl.play()

  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')!

  let raf = 0
  const draw = (): void => {
    // frameRect はCSSピクセル。ソース(ウィンドウ映像)はデバイスピクセルなのでdprを掛ける
    ctx.drawImage(
      videoEl,
      frameRect.x * dpr, frameRect.y * dpr,
      frameRect.width * dpr, frameRect.height * dpr,
      0, 0, canvas.width, canvas.height,
    )
    raf = requestAnimationFrame(draw)
  }
  draw()

  const outStream = canvas.captureStream(fps)
  if (hadAudio) outStream.addTrack(stream.getAudioTracks()[0])

  const chunks: Blob[] = []
  const rec = new MediaRecorder(outStream, { mimeType: 'video/webm;codecs=vp9,opus' })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(100)

  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          cancelAnimationFrame(raf)
          stream.getTracks().forEach((t) => t.stop())
          resolve({ blob: new Blob(chunks, { type: 'video/webm' }), hadAudio })
        }
        rec.stop()
      }),
  }
}
```

> frameRect はウィンドウ左上原点のCSSピクセル（Task 16で送ったものと同じ基準）。ソースのウィンドウ映像はデバイスピクセルなので `dpr` を掛けてクロップ範囲を合わせる。

- [ ] **Step 2: 動画コントロールを実装**

Create `src/renderer/src/components/VideoControls.tsx`:
```tsx
import { useRef, useState } from 'react'
import type { Aspect } from '../../../shared/aspect'
import type { Rect } from '../../../shared/frameRect'
import { videoPresetsFor } from '../../../shared/videoResolution'
import { startRecording, type RecordHandle } from '../lib/recorder'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function VideoControls({
  aspect,
  getFrameRect,
}: {
  aspect: Aspect
  getFrameRect: () => Rect
}): JSX.Element {
  const presets = videoPresetsFor(aspect)
  const [presetLabel, setPresetLabel] = useState('1080')
  const [recording, setRecording] = useState(false)
  const handleRef = useRef<RecordHandle | null>(null)

  const onToggle = async () => {
    if (recording) {
      const { blob, hadAudio } = await handleRef.current!.stop()
      setRecording(false)
      if (!hadAudio) toast.warning('システム音声を取得できませんでした（映像のみ）。仮想オーディオデバイスの導入を検討してください。')
      const webm = await blob.arrayBuffer()
      const saved = await window.capture.saveBlob({ data: webm, defaultName: `capture-${Date.now()}.webm` })
      if (saved.ok) {
        const conv = await window.capture.convertToMp4({ webmPath: saved.path })
        if (conv.ok) toast.success(`mp4保存: ${conv.mp4Path}`)
        else toast.error(`mp4変換失敗（webmは保存済み）: ${conv.error}`)
      }
      return
    }
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    handleRef.current = await startRecording(rect, target)
    setRecording(true)
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">動画</div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <Button key={p.label} size="sm" variant={presetLabel === p.label ? 'default' : 'secondary'} onClick={() => setPresetLabel(p.label)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Button className="w-full" variant={recording ? 'destructive' : 'default'} onClick={onToggle}>
        {recording ? '■ 停止' : '● 録画'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: App から frameRect を取得できるようにする**

`src/renderer/src/lib/useFrameRect.ts` を、最後に送った矩形を ref で保持し `getFrameRect()` を返すよう全置き換え:
```ts
import { useEffect, useRef } from 'react'
import { computeFrameRect, type Rect } from '../../../shared/frameRect'
import type { Aspect } from '../../../shared/aspect'

export function useFrameRect(aspect: Aspect) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lastRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => {
      const r = el.getBoundingClientRect()
      const rect = computeFrameRect({ width: r.width, height: r.height }, aspect, 16)
      const windowRect: Rect = {
        x: Math.round(r.left + rect.x),
        y: Math.round(r.top + rect.y),
        width: rect.width,
        height: rect.height,
      }
      lastRect.current = windowRect
      window.capture.setFrameRect(windowRect)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [aspect])

  return { stageRef, getFrameRect: () => lastRect.current }
}
```

`frameRect.ts` の `Rect` を named export しているため `import { computeFrameRect, type Rect }` が使える（Task 5で定義済み）。

`App.tsx` の受け取りを `const { stageRef, getFrameRect } = useFrameRect(aspect)` に変更し、`aside` 内に `<VideoControls aspect={aspect} getFrameRect={getFrameRect} />` を追加（importも）。

- [ ] **Step 4: 手動確認（音込み）**

音の鳴る作品（または音楽再生中）で「● 録画」→操作→「■ 停止」。
Expected: webm保存ダイアログ→保存→mp4生成。mp4を再生し、枠どおりの映像＋（環境が対応していれば）音が入っていること。音が無ければ警告トーストが出る。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/lib/recorder.ts src/renderer/src/lib/useFrameRect.ts src/renderer/src/components/VideoControls.tsx src/renderer/src/App.tsx
git commit -m "feat: 動画録画パイプライン(クロップ+音声+mp4)"
```

### Task 19: 読込エラー表示

**Files:**
- Modify: `src/main/artworkView.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 読込失敗をrendererへ通知**

`src/main/artworkView.ts` の `ensureArtworkView` 内、view生成直後に追記:
```ts
view.webContents.on('did-fail-load', (_e, code, desc, url) => {
  win.webContents.send('artwork:loadError', { code, desc, url })
})
```

`src/preload/index.ts` の `api` に追記:
```ts
onLoadError: (cb: (info: { code: number; desc: string; url: string }) => void) =>
  ipcRenderer.on('artwork:loadError', (_e, info) => cb(info)),
```

- [ ] **Step 2: rendererでトースト表示**

`App.tsx` の `useEffect` で購読:
```tsx
useEffect(() => {
  window.capture.onLoadError((info) => {
    toast.error(`読込失敗 (${info.code}): ${info.desc}`)
  })
}, [])
```

- [ ] **Step 3: 手動確認**

存在しないURL（`https://invalid.invalid`）を読込。
Expected: 「読込失敗」トーストが出て、アプリは操作可能なまま。

- [ ] **Step 4: コミット**

```bash
git add src/main/artworkView.ts src/preload/index.ts src/renderer/src/App.tsx
git commit -m "feat: 読込エラー表示"
```

---

## Phase 4: 手動テストチェックリスト

### Task 20: 手動テストチェックリストの作成

**Files:**
- Create: `docs/manual-test-checklist.md`

- [ ] **Step 1: チェックリストを作成**

Create `docs/manual-test-checklist.md`:
```markdown
# 手動テストチェックリスト

各項目を three.js / p5.js / 生WebGL の3系統で確認する。

## 表示・操作
- [ ] URLを読み込むと作品が枠内に表示される
- [ ] 作品をマウス操作できる（ドラッグ・クリック・スクロール）
- [ ] 比率を切り替えると枠と作品が即座に組み直される
- [ ] ウィンドウをリサイズしても枠が追従し、はみ出さない

## 枠＝撮影枠の一致
- [ ] 静止画の出力範囲が、画面で見えていた枠と一致する
- [ ] 動画の出力範囲が、画面で見えていた枠と一致する

## 静止画
- [ ] 長辺px指定で、出力PNGがその実ピクセルになる（sipsで確認）
- [ ] cm+dpi指定で実寸どおりのピクセルになる（10cm/300dpi≒1181px）
- [ ] 高DPRでも構図が崩れない（拡大ではなく高精細になっている）
- [ ] 16384px超の指定で警告が出て上限に丸められる
- [ ] 1:1 で正方形PNGが出る

## 動画
- [ ] 1080/1440/2160 各プリセットで、その解像度のmp4が出る
- [ ] 「枠に合わせる」で枠の実ピクセルのmp4が出る
- [ ] 1:1 で正方形動画が出る
- [ ] 操作しながら録れる（カクつきの程度を作品ごとに記録）
- [ ] システム音声が入る（対応環境）
- [ ] 音声非対応環境では警告が出て映像のみで保存される
- [ ] webm→mp4変換が成功する。失敗時もwebmは残る

## エラー
- [ ] 不正URLで読込失敗トーストが出てもアプリは生存する
- [ ] 保存ダイアログのキャンセルで何も起きない
```

- [ ] **Step 2: コミット**

```bash
git add docs/manual-test-checklist.md
git commit -m "docs: 手動テストチェックリスト"
```

---

## 完了条件

- `npm test` が全てパス（shared の純粋ロジック）
- `docs/manual-test-checklist.md` の全項目を3系統の作品で確認
- 静止画PNG・動画mp4が、画面の枠と一致した範囲・指定解像度で出力される
- システム音声は対応環境で録れ、非対応環境では映像のみ＋警告にフォールバックする
