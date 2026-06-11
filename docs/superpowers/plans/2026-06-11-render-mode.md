# Render/Liveモード再編 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動画録画を「Live(実演・音声・画面解像度)」と「Render(仮想時計オフラインレンダリングで4K60保証・音声なし)」の2モードに再編する。

**Architecture:** Renderモードは、作品view専用preloadからページのmain worldへ仮想時計(`performance.now`/`Date.now`/`rAF`/タイマー差し替え)を注入し、Mainが`__iocapRender.step()`で1/60秒ずつ進めながら拡大サーフェス(`acquireCaptureSurface`)で`capturePage`→ffmpegへ固定60fps供給する。現Clean(リアルタイムcapturePageループ)とカーソル合成は削除。

**Tech Stack:** Electron 39 / electron-vite / React / vitest / ffmpeg-static

**設計書:** `docs/superpowers/specs/2026-06-11-render-mode-design.md`

**前提:** 作業ツリーに画質修正(captureSurface等)が未コミットで残っている。Task 0で先にコミットする。

---

### Task 0: 未コミットの画質修正をコミット

**Files:** なし(既存変更のコミットのみ)

- [ ] **Step 1: 検証してコミット**

```bash
npm run typecheck && npx vitest run && \
git add -A src docs && \
git commit -m "feat: 静止画/動画の画質修正(実レンダリング拡大サーフェス・native縮小・フリーズ表示・引き伸ばし廃止)"
```

Expected: typecheck/テスト通過、コミット成功。

---

### Task 1: 仮想時計モジュール (TDD)

**Files:**
- Create: `src/shared/virtualClock.ts`
- Test: `src/shared/virtualClock.test.ts`

ページ注入用に**自己完結**(外部import・TSヘルパ非依存)のファクトリ関数として書く。
`toString()`でシリアライズしてmain worldへ注入するため、関数内でモジュールスコープを参照しないこと。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/shared/virtualClock.test.ts
import { test, expect } from 'vitest'
import { createVirtualClock } from './virtualClock'

// テスト用: 実rAFは即時実行で代用(stepの描画待ちを素通しにする)
const deps = { realRaf: (cb: (t: number) => void): number => (cb(0), 0) }

test('now() starts at 0 and advances by step', async () => {
  const c = createVirtualClock(deps)
  expect(c.now()).toBe(0)
  await c.step(16.5)
  expect(c.now()).toBeCloseTo(16.5, 10)
})

test('setTimeout fires in due order during step', async () => {
  const c = createVirtualClock(deps)
  const order: string[] = []
  c.setTimeout(() => order.push('b'), 20)
  c.setTimeout(() => order.push('a'), 10)
  await c.step(30)
  expect(order).toEqual(['a', 'b'])
})

test('timer scheduled by a timer within the same step still fires', async () => {
  const c = createVirtualClock(deps)
  const order: string[] = []
  c.setTimeout(() => {
    order.push('outer')
    c.setTimeout(() => order.push('inner'), 5)
  }, 5)
  await c.step(20)
  expect(order).toEqual(['outer', 'inner'])
})

test('clearTimeout cancels', async () => {
  const c = createVirtualClock(deps)
  let fired = false
  const id = c.setTimeout(() => (fired = true), 10)
  c.clearTimeout(id)
  await c.step(20)
  expect(fired).toBe(false)
})

test('setInterval fires repeatedly and clearInterval stops it', async () => {
  const c = createVirtualClock(deps)
  let n = 0
  const id = c.setInterval(() => n++, 10)
  await c.step(35) // 10,20,30
  expect(n).toBe(3)
  c.clearInterval(id)
  await c.step(30)
  expect(n).toBe(3)
})

test('rAF callbacks run once per step with virtual timestamp', async () => {
  const c = createVirtualClock(deps)
  const stamps: number[] = []
  const loop = (t: number): void => {
    stamps.push(t)
    c.requestAnimationFrame(loop)
  }
  c.requestAnimationFrame(loop)
  await c.step(16)
  await c.step(16)
  expect(stamps).toEqual([16, 32])
})

test('cancelAnimationFrame cancels', async () => {
  const c = createVirtualClock(deps)
  let fired = false
  const id = c.requestAnimationFrame(() => (fired = true))
  c.cancelAnimationFrame(id)
  await c.step(16)
  expect(fired).toBe(false)
})

test('VIRTUAL_CLOCK_BOOTSTRAP is self-contained injectable source', async () => {
  const { VIRTUAL_CLOCK_BOOTSTRAP } = await import('./virtualClock')
  // window相当のグローバルを持つ関数として評価できること(構文チェック+依存チェック)
  const win = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    requestAnimationFrame: (cb: (t: number) => void) => (cb(0), 0),
    performance: { now: () => 0 },
    Date,
  }
  const fn = new Function('window', 'performance', 'Date', VIRTUAL_CLOCK_BOOTSTRAP + '; return window.__iocapRender')
  const render = fn(win, win.performance, win.Date)
  expect(render.ready).toBe(true)
  await render.step(16)
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/virtualClock.test.ts`
Expected: FAIL (`createVirtualClock` が存在しない)

- [ ] **Step 3: 最小実装**

```ts
// src/shared/virtualClock.ts
/**
 * 仮想時計: ページの時間進行(タイマー/rAF/now)を実時間から切り離し、step(ms)で進める。
 * Renderモード(オフラインレンダリング)で1フレームずつ確実に描画させるための心臓部。
 *
 * 注意: createVirtualClock は toString() でページのmain worldへ注入されるため、
 * 自己完結であること(モジュールスコープの変数・import・TSヘルパを参照しない)。
 */
export type VirtualClockDeps = {
  /** 実rAF: stepの最後に実フレームの描画完了を待つために使う */
  realRaf: (cb: (t: number) => void) => number
}

export function createVirtualClock(deps: VirtualClockDeps): {
  now: () => number
  step: (ms: number) => Promise<void>
  setTimeout: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearTimeout: (id: number) => void
  setInterval: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearInterval: (id: number) => void
  requestAnimationFrame: (cb: (t: number) => void) => number
  cancelAnimationFrame: (id: number) => void
} {
  let now = 0
  let nextId = 1
  type Timer = {
    id: number
    due: number
    every: number | null
    cb: (...a: unknown[]) => void
    args: unknown[]
  }
  const timers: Timer[] = []
  let rafQueue: { id: number; cb: (t: number) => number | void }[] = []

  const addTimer = (
    cb: (...a: unknown[]) => void,
    ms: number,
    every: number | null,
    args: unknown[],
  ): number => {
    const id = nextId++
    timers.push({ id, due: now + Math.max(0, ms), every, cb, args })
    return id
  }
  const removeTimer = (id: number): void => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }

  return {
    now: () => now,
    setTimeout: (cb, ms = 0, ...args) => addTimer(cb, ms, null, args),
    clearTimeout: removeTimer,
    setInterval: (cb, ms = 0, ...args) => addTimer(cb, ms, Math.max(1, ms), args),
    clearInterval: removeTimer,
    requestAnimationFrame: (cb) => {
      const id = nextId++
      rafQueue.push({ id, cb })
      return id
    },
    cancelAnimationFrame: (id) => {
      const i = rafQueue.findIndex((r) => r.id === id)
      if (i >= 0) rafQueue.splice(i, 1)
    },
    async step(ms) {
      const target = now + ms
      // 期限順にタイマーを実行。実行中に追加された期限内タイマーも拾う
      for (;;) {
        let earliest: Timer | null = null
        for (const t of timers) {
          if (t.due <= target && (!earliest || t.due < earliest.due)) earliest = t
        }
        if (!earliest) break
        now = Math.max(now, earliest.due)
        if (earliest.every != null) earliest.due += earliest.every
        else removeTimer(earliest.id)
        earliest.cb(...earliest.args)
      }
      now = target
      // rAFはフレームにつき1回。実行中のrequestAnimationFrameは次フレームへ
      const q = rafQueue
      rafQueue = []
      for (const r of q) r.cb(now)
      // 実フレームの描画完了を待つ(ダブルrAF)。capturePageが新しい絵を見られるように
      await new Promise<void>((res) => deps.realRaf(() => deps.realRaf(() => res())))
    },
  }
}

/**
 * ページのmain worldへ注入するブートストラップ。グローバルを仮想時計に差し替え、
 * window.__iocapRender = { step, ready } を公開する。
 * 注入はページスクリプトより先(artwork preloadのwebFrame.executeJavaScript)に行うこと。
 */
export const VIRTUAL_CLOCK_BOOTSTRAP = `(() => {
  const createVirtualClock = ${createVirtualClock.toString()};
  const clock = createVirtualClock({
    realRaf: window.requestAnimationFrame.bind(window),
  });
  const RealDate = Date;
  const t0 = RealDate.now();
  performance.now = () => clock.now();
  window.Date = new Proxy(RealDate, {
    construct(target, args) {
      return args.length ? new target(...args) : new target(t0 + clock.now());
    },
    apply() {
      return new RealDate(t0 + clock.now()).toString();
    },
  });
  window.Date.now = () => t0 + clock.now();
  window.requestAnimationFrame = (cb) => clock.requestAnimationFrame(cb);
  window.cancelAnimationFrame = (id) => clock.cancelAnimationFrame(id);
  window.setTimeout = (cb, ms, ...a) => clock.setTimeout(cb, ms, ...a);
  window.clearTimeout = (id) => clock.clearTimeout(id);
  window.setInterval = (cb, ms, ...a) => clock.setInterval(cb, ms, ...a);
  window.clearInterval = (id) => clock.clearInterval(id);
  window.__iocapRender = { step: (ms) => clock.step(ms), ready: true };
})()`
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/shared/virtualClock.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: コミット**

```bash
git add src/shared/virtualClock.ts src/shared/virtualClock.test.ts
git commit -m "feat: 仮想時計モジュール(オフラインレンダリングの時間制御)を追加"
```

---

### Task 2: captureMode prefsと移行ロジック (TDD)

**Files:**
- Create: `src/shared/captureMode.ts`
- Test: `src/shared/captureMode.test.ts`
- Modify: `src/shared/ipc-types.ts` (Prefsに`captureMode`/`renderLengthSec`追加)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/shared/captureMode.test.ts
import { test, expect } from 'vitest'
import { resolveCaptureMode } from './captureMode'

test('captureMode set -> use it', () => {
  expect(resolveCaptureMode({ captureMode: 'render' })).toBe('render')
})
test('legacy captureEngine screen -> live', () => {
  expect(resolveCaptureMode({ captureEngine: 'screen' })).toBe('live')
})
test('legacy captureEngine frame -> render', () => {
  expect(resolveCaptureMode({ captureEngine: 'frame' })).toBe('render')
})
test('nothing set -> live (操作しても安全なデフォルト)', () => {
  expect(resolveCaptureMode({})).toBe('live')
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/shared/captureMode.test.ts`
Expected: FAIL (モジュールなし)

- [ ] **Step 3: 実装**

```ts
// src/shared/captureMode.ts
import type { Prefs } from './ipc-types'

export type CaptureMode = 'live' | 'render'

/** 旧captureEngine(screen/frame)からの移行を含めて録画モードを解決する。 */
export function resolveCaptureMode(prefs: Pick<Prefs, 'captureMode' | 'captureEngine'>): CaptureMode {
  if (prefs.captureMode === 'live' || prefs.captureMode === 'render') return prefs.captureMode
  if (prefs.captureEngine === 'screen') return 'live'
  if (prefs.captureEngine === 'frame') return 'render'
  return 'live'
}
```

`src/shared/ipc-types.ts` のPrefsを修正:

```ts
  // 旧: 録画エンジン(captureModeへ移行済み。読み取りのみ)
  captureEngine?: 'frame' | 'screen'
  // 録画モード: live=画面録画(音声/カーソル) / render=オフラインレンダリング(4K60保証)
  captureMode?: 'live' | 'render'
  // Renderモードの録画秒数
  renderLengthSec?: number
```

(既存の `captureEngine?: 'frame' | 'screen'` 行をコメントごと置き換える)

- [ ] **Step 4: テスト通過と全体確認**

Run: `npx vitest run && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/captureMode.ts src/shared/captureMode.test.ts src/shared/ipc-types.ts
git commit -m "feat: captureMode(live/render) prefsと旧captureEngineからの移行を追加"
```

---

### Task 3: artworkViewにacquireCaptureSurfaceを導入(リファクタ)

**Files:**
- Modify: `src/main/artworkView.ts` (withCaptureSurfaceを分解)

Renderは録画の間ずっとサーフェスを保持する必要があるため、「確保(acquire)→解放(release)」
のAPIに分解し、既存の `withCaptureSurface` はその上の薄いラッパーにする。

- [ ] **Step 1: withCaptureSurfaceを書き換え**

`src/main/artworkView.ts` の `withCaptureSurface` 全体を以下に置き換える
(freezePreview/unfreezePreview/定数はそのまま使う):

```ts
export type CaptureSurfaceHandle = {
  /** enlarge時: capturePageが返すはずの物理px。native時はnull(そのまま撮って縮小する) */
  expected: TargetSize | null
  release: () => Promise<void>
}

/**
 * 撮影サーフェスを確保する。targetが表示以下ならnative(何もしない)。
 * 超えるなら、フリーズ画像を表示→viewを左端2pxスリバーを残して画面外で拡大
 * →zoomでレイアウト維持、まで済ませた状態で返す。releaseで完全に元へ戻す。
 */
export async function acquireCaptureSurface(target: TargetSize): Promise<CaptureSurfaceHandle> {
  if (!view) throw new Error('artwork view not ready')
  const wc = view.webContents
  const prevBounds = view.getBounds()
  const prevZoom = wc.getZoomFactor()
  const sf =
    mainWin && !mainWin.isDestroyed()
      ? screen.getDisplayMatching(mainWin.getBounds()).scaleFactor
      : screen.getPrimaryDisplay().scaleFactor
  const plan = planCaptureSurface(target, prevBounds.width, sf)
  if (plan.kind === 'native') return { expected: null, release: async () => {} }

  await freezePreview(wc)
  view.setBounds({
    x: CAPTURE_SLIVER_PX - plan.bounds.width,
    y: prevBounds.y,
    ...plan.bounds,
  })
  wc.setZoomFactor(plan.zoomFactor)
  // サイズ・DPRを変えただけでは多くの作品はcanvasを描き直さない。
  // resizeイベントを送って作品自身に高解像度バッファで再描画させ、数フレーム安定を待つ。
  await settleAfterDprChange(wc)
  return {
    expected: plan.expected,
    release: async () => {
      if (!view) return
      wc.setZoomFactor(prevZoom)
      view.setBounds(prevBounds)
      // 表示を元へ戻すため、作品にもう一度再レイアウトを促す。
      wc.executeJavaScript(`window.dispatchEvent(new Event('resize'))`).catch(() => {})
      // 元のサイズでの再描画が画面に乗るまで少し待ってからフリーズ画像を外す。
      await new Promise((r) => setTimeout(r, 120))
      unfreezePreview()
    },
  }
}

/** 1回だけ撮る用途のラッパー: 確保→fn→解放。 */
export async function withCaptureSurface<T>(
  target: TargetSize,
  fn: (v: WebContentsView) => Promise<T>,
): Promise<T> {
  const handle = await acquireCaptureSurface(target)
  try {
    return await fn(view!)
  } finally {
    await handle.release()
  }
}
```

- [ ] **Step 2: 検証**

Run: `npm run typecheck && npx vitest run`
Expected: PASS(既存テストに影響なし)

- [ ] **Step 3: コミット**

```bash
git add src/main/artworkView.ts
git commit -m "refactor: 撮影サーフェスをacquire/release型に分解(Render録画の保持に備える)"
```

---

### Task 4: 作品view専用preloadと仮想時計の注入

**Files:**
- Create: `src/preload/artwork.ts`
- Modify: `electron.vite.config.ts` (preloadのエントリ追加)
- Modify: `src/main/artworkView.ts` (WebContentsViewにpreload設定)
- Modify: `src/main/renderState.ts` を新規作成(フラグ保持) + `src/main/ipc.ts`(sync IPC)

- [ ] **Step 1: Renderフラグ保持モジュールを作る**

```ts
// src/main/renderState.ts
// Renderモード(仮想時計)のフラグ。artwork preloadがsendSyncで読む。
let virtual = false

export function setVirtualRenderMode(on: boolean): void {
  virtual = on
}

export function isVirtualRenderMode(): boolean {
  return virtual
}
```

- [ ] **Step 2: artwork preloadを作る**

```ts
// src/preload/artwork.ts
// 作品view専用preload。Renderモードのときだけ、ページの全スクリプトより先に
// 仮想時計をmain worldへ注入する(preloadはドキュメント解析前に実行される)。
import { ipcRenderer, webFrame } from 'electron'
import { VIRTUAL_CLOCK_BOOTSTRAP } from '../shared/virtualClock'

if (ipcRenderer.sendSync('render:isVirtual') === true) {
  void webFrame.executeJavaScript(VIRTUAL_CLOCK_BOOTSTRAP)
}
```

- [ ] **Step 3: electron-viteにpreloadエントリを追加**

`electron.vite.config.ts` の `preload: {},` を置き換え:

```ts
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          artwork: resolve('src/preload/artwork.ts'),
        },
      },
    },
  },
```

- [ ] **Step 4: WebContentsViewへpreloadを設定 + sync IPC**

`src/main/artworkView.ts` の `ensureArtworkView` 内 `view = new WebContentsView()` を:

```ts
  view = new WebContentsView({
    webPreferences: {
      // Renderモード時に仮想時計を注入する専用preload
      preload: join(__dirname, '../preload/artwork.js'),
    },
  })
```

ファイル先頭に `import { join } from 'path'` を追加。

`src/main/ipc.ts` の `registerIpc` 内に追加(`import { isVirtualRenderMode } from './renderState'`):

```ts
  // 作品preloadがRenderモード(仮想時計)かを同期で問い合わせる
  ipcMain.on('render:isVirtual', (e) => {
    e.returnValue = isVirtualRenderMode()
  })
```

- [ ] **Step 5: 検証**

Run: `npm run typecheck && npx electron-vite build && ls out/preload/artwork.js`
Expected: ビルド成功、`out/preload/artwork.js` が存在

- [ ] **Step 6: コミット**

```bash
git add src/preload/artwork.ts electron.vite.config.ts src/main/artworkView.ts src/main/renderState.ts src/main/ipc.ts
git commit -m "feat: 作品view専用preloadでRenderモード時に仮想時計を注入"
```

---

### Task 5: 実機検証 — 仮想時計の注入とstepが本物のページで機能するか

**Files:**
- Create: `/tmp/iocapture-dpr-test/virtual-clock-e2e.js` (リポジトリ外・検証用)

プラン続行の前提を実機で確認する(preloadのwebFrame.executeJavaScriptがページスクリプトより
先に走ること、step→capturePageで絵が進むこと)。

- [ ] **Step 1: 検証スクリプトを書いて実行**

```js
// /tmp/iocapture-dpr-test/virtual-clock-e2e.js
// rAFで動くcanvasを仮想時計で2ステップ進め、capturePageの絵が決定的に変わるか確認。
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron')
const { writeFileSync } = require('fs')
const path = require('path')

// ビルド済みのapp本体からpreloadとブートストラップを使う
const PRELOAD = path.resolve(__dirname, '../../Users/…') // ← 実行時はリポジトリの out/preload/artwork.js への絶対パスに置き換える

const HTML = `data:text/html,${encodeURIComponent(`
<!doctype html><body style="margin:0">
<canvas id="c" width="400" height="100"></canvas>
<script>
  const x = document.getElementById('c').getContext('2d')
  let frame = 0
  function loop(t){
    frame++
    x.fillStyle='#fff'; x.fillRect(0,0,400,100)
    x.fillStyle='#000'; x.font='20px monospace'
    x.fillText('frame='+frame+' t='+t.toFixed(1), 10, 50)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
</script></body>`)}`

ipcMain.on('render:isVirtual', (e) => { e.returnValue = true })

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 600, height: 300, show: true })
  const view = new WebContentsView({ webPreferences: { preload: PRELOAD } })
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 400, height: 100 })
  await view.webContents.loadURL(HTML)
  await new Promise((r) => setTimeout(r, 500))
  const wc = view.webContents
  console.log('[ready]', await wc.executeJavaScript('!!window.__iocapRender'))
  for (let i = 1; i <= 3; i++) {
    await wc.executeJavaScript('window.__iocapRender.step(1000/60)')
    const img = await wc.capturePage()
    writeFileSync(`/tmp/iocapture-dpr-test/vc-step${i}.png`, img.toPNG())
  }
  console.log('[done] vc-step1..3.png を確認(frame=1,2,3 と表示されるはず)')
  app.quit()
})
```

Run:
```bash
npx electron-vite build && npx electron /tmp/iocapture-dpr-test/virtual-clock-e2e.js
# PRELOADはリポジトリのout/preload/artwork.jsの絶対パスに書き換えてから実行
```
Expected: `[ready] true`、vc-step1〜3.png がそれぞれ `frame=1 t=16.7` / `frame=2 t=33.3` / `frame=3 t=50.0` を表示

- [ ] **Step 2: 結果に問題があれば設計に立ち戻る**

`[ready] false` の場合: webFrame注入のタイミング問題。`wc.on('dom-ready')`での注入や
`contextIsolation: false` 化を検討し、設計書を更新してから先へ進む。

(コミット対象なし。検証のみ)

---

### Task 6: Mainのレンダリングループ (renderRecorder.ts)

**Files:**
- Create: `src/main/renderRecorder.ts`
- Modify: `src/shared/ipc-types.ts` (IPCキーと型)

- [ ] **Step 1: 型とIPCキーを追加**

`src/shared/ipc-types.ts`:

```ts
// IPC定数に追加
  startRender: 'video:startRender',
  cancelRender: 'video:cancelRender',
```

```ts
// 型を追加(StopFrameCaptureResultの近くに)
export type StartRenderArgs = {
  target: TargetSize
  fps: number
  durationSec: number
  format: VideoFormat
}
export type RenderProgress = { frame: number; total: number }
```

- [ ] **Step 2: renderRecorder本体**

```ts
// src/main/renderRecorder.ts
import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { once } from 'events'
import ffmpegStatic from 'ffmpeg-static'
import { acquireCaptureSurface, getArtworkView, getMainWindow } from './artworkView'
import { setVirtualRenderMode } from './renderState'
import type { StartRenderArgs, StopFrameCaptureResult, RenderProgress } from '../shared/ipc-types'

const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

// 1フレームのstep+描画にかけてよい上限。超えたら作品の暴走とみなして中断する。
const STEP_TIMEOUT_MS = 5000

let active = false
let cancelRequested = false

export function isRendering(): boolean {
  return active
}

export function cancelRender(): void {
  cancelRequested = true
}

function sendProgress(p: RenderProgress): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('render:progress', p)
  }
}

/** 仮想時計付きで作品をリロードし、__iocapRenderが現れるまで待つ。 */
async function reloadIntoVirtualMode(): Promise<void> {
  const view = getArtworkView()
  if (!view) throw new Error('view not ready')
  const wc = view.webContents
  setVirtualRenderMode(true)
  wc.reload()
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('virtual clock not ready (timeout)')), 15000)
    const poll = async (): Promise<void> => {
      const ok = await wc.executeJavaScript('!!(window.__iocapRender && window.__iocapRender.ready)').catch(() => false)
      if (ok) {
        clearTimeout(t)
        resolve()
      } else setTimeout(poll, 100)
    }
    setTimeout(poll, 300)
  })
}

/** 実時間動作へ戻す(フラグ解除してリロード)。 */
function reloadIntoLiveMode(): void {
  setVirtualRenderMode(false)
  getArtworkView()?.webContents.reload()
}

export async function startRender(args: StartRenderArgs): Promise<StopFrameCaptureResult> {
  const view = getArtworkView()
  if (!view) return { ok: false, error: 'view not ready' }
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  if (active) return { ok: false, error: 'already rendering' }
  active = true
  cancelRequested = false

  const { target, fps, durationSec, format } = args
  const total = Math.max(1, Math.round(durationSec * fps))
  const round2 = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  const size = { width: round2(target.width), height: round2(target.height) }

  let surface: Awaited<ReturnType<typeof acquireCaptureSurface>> | null = null
  let tmpDir = ''
  try {
    await reloadIntoVirtualMode()
    surface = await acquireCaptureSurface(size)
    const wc = view.webContents

    tmpDir = await mkdtemp(join(tmpdir(), 'iocapture-render-'))
    const outName = format === 'webp' ? 'video.webp' : 'video.mp4'
    const outPath = join(tmpDir, outName)
    const inputArgs = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'bgra',
      '-video_size', `${size.width}x${size.height}`,
      '-framerate', String(fps),
      '-i', 'pipe:0',
      '-an',
    ]
    const encodeArgs =
      format === 'webp'
        ? ['-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '4']
        : // オフラインなので品質優先(リアルタイムのveryfast/16より高品質)
          ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '15', '-movflags', '+faststart', '-r', String(fps)]
    const proc = spawn(ffmpegPath, [...inputArgs, ...encodeArgs, outPath])
    proc.stdin.on('error', () => {})
    proc.on('error', () => {})

    const rowBytes = size.width * 4
    const expectedLen = rowBytes * size.height

    for (let i = 0; i < total; i++) {
      if (cancelRequested) break
      // 仮想時刻を1フレーム進める(作品が暴走したらタイムアウト)
      const stepped = await Promise.race([
        wc.executeJavaScript(`window.__iocapRender.step(${1000 / fps})`).then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), STEP_TIMEOUT_MS)),
      ])
      if (!stepped) throw new Error(`frame ${i}: step timed out (artwork not responding)`)

      const image = await wc.capturePage()
      const sized =
        image.getSize().width === size.width && image.getSize().height === size.height
          ? image
          : image.resize({ width: size.width, height: size.height, quality: 'best' })
      const raw = sized.toBitmap()
      let buf = raw
      if (raw.length !== expectedLen) {
        // toBitmapのstride詰め直し(frameRecorderと同じ理由)
        const stride = Math.floor(raw.length / size.height)
        const tight = Buffer.allocUnsafe(expectedLen)
        for (let y = 0; y < size.height; y++) {
          raw.copy(tight, y * rowBytes, y * stride, y * stride + rowBytes)
        }
        buf = tight
      }
      if (!proc.stdin.writable) throw new Error('ffmpeg pipe closed unexpectedly')
      if (!proc.stdin.write(buf)) await once(proc.stdin, 'drain')
      if (i % 10 === 0 || i === total - 1) sendProgress({ frame: i + 1, total })
    }

    const canceledMidway = cancelRequested
    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve())
      proc.stdin.end()
    })
    if (canceledMidway) {
      return { ok: false, canceled: true }
    }

    const ext = format === 'webp' ? 'webp' : 'mp4'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `render-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    await copyFile(outPath, filePath)
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    return { ok: false, error: String(e) }
  } finally {
    active = false
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    await surface?.release().catch(() => {})
    reloadIntoLiveMode()
  }
}
```

注: `getMainWindow` は `src/main/artworkView.ts` に小さなexportを追加する:

```ts
export function getMainWindow(): BrowserWindow | null {
  return mainWin
}
```

また `writeFileSync` 未使用ならimportから外す(lint対象)。

- [ ] **Step 3: IPCハンドラとpreload API**

`src/main/ipc.ts`:

```ts
import { startRender, cancelRender } from './renderRecorder'
import type { StartRenderArgs } from '../shared/ipc-types'
// registerIpc内:
  ipcMain.handle(IPC.startRender, (_e, args: StartRenderArgs) => startRender(args))
  ipcMain.on(IPC.cancelRender, () => cancelRender())
```

`src/preload/index.ts` のapiに追加:

```ts
  startRender: (args: StartRenderArgs): Promise<StopFrameCaptureResult> =>
    ipcRenderer.invoke(IPC.startRender, args),
  cancelRender: () => ipcRenderer.send(IPC.cancelRender),
  onRenderProgress: (cb: (p: RenderProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: RenderProgress): void => cb(p)
    ipcRenderer.on('render:progress', handler)
    return (): void => { ipcRenderer.removeListener('render:progress', handler) }
  },
```

(import文に `StartRenderArgs`, `RenderProgress` を追加)

- [ ] **Step 4: 検証**

Run: `npm run typecheck && npx vitest run && npx electron-vite build`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/renderRecorder.ts src/main/artworkView.ts src/main/ipc.ts src/shared/ipc-types.ts src/preload/index.ts
git commit -m "feat: Renderモードのオフラインレンダリングループ(固定fps・進捗・キャンセル)を追加"
```

---

### Task 7: UI再編 (VideoControls: Live/Render)

**Files:**
- Modify: `src/renderer/src/lib/recorder.ts` (startRecordingをRender呼び出しに置換)
- Modify: `src/renderer/src/components/VideoControls.tsx`

- [ ] **Step 1: recorder.tsのstartRecordingを置換**

`startRecording` 関数(音声録音ロジックごと)を削除し、以下に置き換える:

```ts
/**
 * Renderモード: 仮想時計オフラインレンダリング(Main主導)。4K60保証・音声なし。
 * 録画中はMainがフリーズ表示と進捗イベントを出す。完了/キャンセルまで解決しない。
 */
export async function startRenderRecording(
  target: TargetSize,
  durationSec: number,
  format: 'mp4' | 'webp' = 'mp4',
  fps = 60,
): Promise<RecordResult> {
  const res = await window.capture.startRender({ target, fps, durationSec, format })
  if (res.ok) return { mp4Path: res.mp4Path }
  return { canceled: res.canceled, error: res.error }
}
```

(`AUDIO_OFF`等のimportはstartWindowRecordingで使用継続。未使用になったものだけ削除)

- [ ] **Step 2: VideoControlsを再編**

主要な変更(完全なコードで置き換える):

1. import: `startRecording` → `startRenderRecording`、`resolveCaptureMode` を追加、`MousePointer2`/`Crop`/`Zap` → `Clapperboard`/`Radio` 等に変更可(アイコンは任意)
2. state:

```tsx
  // 録画モード: live=画面録画(音声/カーソル) / render=オフラインレンダリング(4K60保証)
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
  // Render進捗(録画中のみ)
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null)
  useEffect(() => window.capture.onRenderProgress((p) => setProgress(p)), [])
```

3. `engine` state・`includeCursor` state・カーソルトグルUIを削除
4. `startNow` を分岐:

```tsx
  const startNow = async (): Promise<void> => {
    const rect = getFrameRect()
    const preset = presets.find((p) => p.label === presetLabel)!
    const target = preset.size ?? { width: rect.width, height: rect.height }
    try {
      if (mode === 'render') {
        setRecording(true)
        setProgress(null)
        const res = await startRenderRecording(target, lengthSec, format)
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
      setRecording(false)
      toast.error(`Could not start recording: ${String(e)}`)
    }
  }
```

5. `onToggle`: Renderモードで録画中なら `window.capture.cancelRender()` を呼ぶ
   (`handleRef.current.stop()` はLiveのみ)
6. モード切替UI(旧エンジン切替の位置):

```tsx
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
          : 'Offline render · guaranteed 60fps at any resolution · no audio · restarts artwork'}
      </p>
```

7. Render選択時のみLength入力(Audioセレクトの代わり):

```tsx
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
        </div>
      )}
```

(Audioセレクト・レベルメーターは `mode === 'live' && format === 'mp4'` 条件に変更。
`useAudioLevel` の第2引数も `mode === 'live' && format === 'mp4'` にする)

8. 録画中表示: Renderは進捗、Liveは経過時間:

```tsx
      {recording && mode === 'render' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            Rendering… {progress ? `${progress.frame}/${progress.total}` : 'starting'}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress ? (progress.frame / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {recording && mode === 'live' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          REC {mmss}
        </div>
      )}
```

9. 録画ボタンのラベル: Render録画中は `Cancel`

- [ ] **Step 3: 検証**

Run: `npm run typecheck && npx vitest run && npx eslint src/renderer/src/components/VideoControls.tsx src/renderer/src/lib/recorder.ts`
Expected: PASS / エラー増加なし

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/lib/recorder.ts src/renderer/src/components/VideoControls.tsx
git commit -m "feat: 録画UIをLive/Renderモードに再編(Render: 長さ指定・進捗・キャンセル)"
```

---

### Task 8: 旧Cleanエンジンとカーソル合成の削除

**Files:**
- Delete: `src/main/frameRecorder.ts`, `src/main/cursorSprite.ts`
- Modify: `src/main/ipc.ts`, `src/shared/ipc-types.ts`, `src/preload/index.ts`

- [ ] **Step 1: 参照を削除**

- `src/main/ipc.ts`: `startFrameCapture`/`stopFrameCapture` のimportとhandlerを削除
- `src/shared/ipc-types.ts`: IPCキー `startFrameCapture`/`stopFrameCapture`、型
  `StartFrameCaptureArgs`/`StartFrameCaptureResult`/`StopFrameCaptureArgs` を削除
  (`StopFrameCaptureResult` は saveWebmAsMp4/startRender が使うため**残す**)
- `src/preload/index.ts`: `startFrameCapture`/`stopFrameCapture` メソッドと型importを削除
- Prefsの `includeCursor` を「旧設定(読み取りのみ)」コメントに変更(フィールド自体は残す)

- [ ] **Step 2: ファイル削除と確認**

```bash
git rm src/main/frameRecorder.ts src/main/cursorSprite.ts
grep -rn "frameRecorder\|cursorSprite\|startFrameCapture\|stopFrameCapture\|includeCursor" src/ || echo CLEAN
```

Expected: prefs型の旧フィールドコメント以外ヒットなし

- [ ] **Step 3: 検証**

Run: `npm run typecheck && npx vitest run && npx electron-vite build`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add -A src
git commit -m "refactor: 旧Cleanエンジン(リアルタイムループ)とカーソル合成を削除"
```

---

### Task 9: 受け入れ確認と手動チェックリスト更新

**Files:**
- Modify: `docs/manual-test-checklist.md`

- [ ] **Step 1: 受け入れ条件の実測**

アプリを起動(`npm run dev`)し、uurr.io等を読み込んでRenderモード・2160プリセット・10秒で録画。
保存したファイルを確認:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 <保存したmp4>
```

Expected: `3840,2160,60/1,600` (アスペクト16:9時。3:2なら3240×2160,600フレーム)

確認項目:
- 録画中: フリーズ画像+進捗バー、Cancelで中断できる
- 終了後: プレビューが通常(実時間)に戻る
- Liveモード: 音声・カーソル込みで従来どおり録れる
- 静止画: 挙動が変わっていない

- [ ] **Step 2: チェックリストに追記**

`docs/manual-test-checklist.md` に「Render/Live」セクションを追加:

```markdown
## Video: Render mode
- [ ] Render+2160で重い作品を録ってもフレーム数=秒数×60 (ffprobeで確認)
- [ ] 録画中はフリーズ画像+進捗表示、Cancelで中断できる(ファイルは保存されない)
- [ ] 録画終了/中断後にプレビューが実時間動作へ戻る
- [ ] rAFベースでない作品(CSSアニメ等)は進まない=既知の制約

## Video: Live mode
- [ ] 音声(system/デバイス)・カーソル込みで録れる
- [ ] 画面表示より大きいプリセットはキャップされ、トーストで実解像度を知らせる
```

- [ ] **Step 3: コミット**

```bash
git add docs/manual-test-checklist.md
git commit -m "docs: Render/Liveモードの手動テスト項目を追加"
```

---

## セルフレビュー結果

- 仕様カバレッジ: 仮想時計(Task1,4,5)・レンダリングループ/CFR/進捗/キャンセル(Task6)・UI再編とprefs移行(Task2,7)・旧コード削除(Task8)・受け入れ条件(Task9) — 設計書の全セクションに対応タスクあり
- step()タイムアウト→中断・部分動画は保存しない(Task6のSTEP_TIMEOUT_MS+throw)が設計書と一致
- 型整合: `StopFrameCaptureResult` はsaveWebmAs/startRenderで共用のため残す(Task8で明記)
