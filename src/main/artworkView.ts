import { join } from 'path'
import { WebContentsView, BrowserWindow, screen, ipcMain } from 'electron'
import type { Rect } from '../shared/frameRect'
import type { TargetSize } from '../shared/resolution'
import { planCaptureSurface } from '../shared/captureSurface'
import { setLastUrl } from './state'

let view: WebContentsView | null = null
let lastRect: Rect | null = null
let mainWin: BrowserWindow | null = null

// 機能6: CSS非表示セレクタ
let hideSelectors = ''
let picking = false
// Renderモード用: プレビュー固定状態フラグ。一度固定したらリロード後のt=0ブランクで上書きしない。
let frozen = false

// 作品ページのスクロールバーを隠す（スクロール自体は可能）。macOSのオーバーレイ
// スクロールバーはレイアウト幅を取らないため、構図には影響しない。
const HIDE_SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
  html { scrollbar-width: none !important; -ms-overflow-style: none !important; }
`

// 機能1: URL正規化
function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return t
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t // 既にスキーム付き
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(t)) return 'http://' + t
  return 'https://' + t
}

// 機能6: CSSセレクタで非表示スタイルをWebページに注入
function applyHide(): void {
  const wc = view?.webContents
  if (!wc) return
  const sel = JSON.stringify(hideSelectors)
  wc.executeJavaScript(
    `(() => {
      let s = document.getElementById('__record_hide__');
      if (!s) { s = document.createElement('style'); s.id = '__record_hide__'; (document.head || document.documentElement).appendChild(s); }
      const sel = ${sel};
      s.textContent = sel ? sel + '{display:none !important}' : '';
    })()`,
  ).catch(() => {})
}

export function ensureArtworkView(win: BrowserWindow): WebContentsView {
  mainWin = win
  if (view) return view
  view = new WebContentsView({
    webPreferences: {
      // Renderモード時に仮想時計を注入する専用preload
      preload: join(__dirname, '../preload/artwork.js'),
    },
  })
  win.contentView.addChildView(view)
  const wc = view.webContents
  // ウィンドウ破棄後にイベントが発火しても安全に送るためのヘルパー。
  const safeSend = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
  wc.on('did-fail-load', (_e, code, desc, url) => {
    safeSend('artwork:loadError', { code, desc, url })
  })
  // 読み込み・遷移のたびにCSSが失われるので毎回注入する。
  wc.on('did-finish-load', () => {
    wc.insertCSS(HIDE_SCROLLBAR_CSS).catch(() => {})
    applyHide()
  })
  const sendUrl = (url: string): void => {
    setLastUrl(url)
    safeSend('artwork:urlChanged', url)
  }
  wc.on('did-navigate', (_e, url) => sendUrl(url))
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) sendUrl(url)
  })
  if (lastRect) view.setBounds(lastRect)
  return view
}

export function loadArtworkUrl(win: BrowserWindow, url: string): void {
  const v = ensureArtworkView(win)
  v.webContents.loadURL(normalizeUrl(url))
}

// ウィンドウを閉じると作品ビューのwebContentsも破棄される。古い参照を捨てて、
// 次にウィンドウを開いたとき ensureArtworkView が新しいビューを作り直せるようにする。
export function resetArtworkView(): void {
  view = null
  picking = false
}

export function setArtworkRect(rect: Rect): void {
  lastRect = rect
  view?.setBounds(rect)
}

// 機能2: ナビゲーション（Electron 39 の navigationHistory API）
export function goBack(): void {
  const nav = view?.webContents.navigationHistory
  if (nav?.canGoBack()) nav.goBack()
}

export function goForward(): void {
  const nav = view?.webContents.navigationHistory
  if (nav?.canGoForward()) nav.goForward()
}

export function reloadArtwork(): void {
  view?.webContents.reload()
}

// 機能6: CSSセレクタで非表示
export function setHideSelectors(sel: string): void {
  hideSelectors = sel
  applyHide()
}

function appendHideSelector(sel: string): void {
  const list = hideSelectors
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!list.includes(sel)) list.push(sel)
  hideSelectors = list.join(', ')
}

// クリックで要素を選んで消すピッカー。作品ページに注入し、クリックされた要素の
// 安定したCSSセレクタを解決して返す（Esc/ キャンセルで null）。
const PICKER_SCRIPT = `new Promise((resolve) => {
  const ID = '__record_picker__';
  const old = document.getElementById(ID); if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(59,130,246,.2);border:2px solid #3b82f6;border-radius:2px;display:none;left:0;top:0';
  document.documentElement.appendChild(overlay);
  let current = null;
  const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s;
  function cssPath(el) {
    if (el.id) return '#' + esc(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      if (node.id) { parts.unshift('#' + esc(node.id)); break; }
      let sel = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean);
      if (cls.length) {
        sel += '.' + cls.map(esc).join('.');
      } else {
        const parent = node.parentElement;
        if (parent) {
          const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
          if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  function move(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay) { current = null; overlay.style.display = 'none'; return; }
    current = el;
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }
  function cleanup() {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    overlay.remove();
    delete window.__recordPickerCancel;
  }
  function click(e) {
    e.preventDefault(); e.stopPropagation();
    const el = current || document.elementFromPoint(e.clientX, e.clientY);
    cleanup();
    resolve(el ? cssPath(el) : null);
  }
  function key(e) { if (e.key === 'Escape') { cleanup(); resolve(null); } }
  window.__recordPickerCancel = () => { cleanup(); resolve(null); };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
})`

function sendMain(channel: string, payload: unknown): void {
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
    mainWin.webContents.send(channel, payload)
  }
}

/** クリックで要素を選んで消すモードを開始（Esc/Stopで終了するまで連続でピック）。 */
export async function startPicking(): Promise<void> {
  if (picking) return
  const wc = view?.webContents
  if (!wc || !mainWin) return
  picking = true
  sendMain('artwork:pickState', true)
  try {
    while (picking) {
      const selector: string | null = await wc.executeJavaScript(PICKER_SCRIPT).catch(() => null)
      if (!picking || !selector) break
      appendHideSelector(selector)
      applyHide()
      sendMain('artwork:hideSelectorsChanged', hideSelectors)
    }
  } finally {
    picking = false
    sendMain('artwork:pickState', false)
  }
}

export function stopPicking(): void {
  picking = false
  view?.webContents
    .executeJavaScript('window.__recordPickerCancel && window.__recordPickerCancel()')
    .catch(() => {})
}

// 拡大撮影中、viewはウィンドウ左端にこの幅だけ残して画面外へ退避する。
// 完全に画面外へ出すとコンポジタが新しいサーフェスを描画しない(実測)ため、最小限を残す。
const CAPTURE_SLIVER_PX = 2
// プレビュー固定(フリーズ画像)の表示完了を待つ上限。レンダラーが応答しなくても撮影は続行する。
const FREEZE_READY_TIMEOUT_MS = 300

/** 直前の見た目をレンダラーに送り、フレーム位置へ固定表示されるのを待つ(撮影中の見た目の変化を隠す)。
 * 既に固定済みの場合はスナップショットを撮り直さない(リロード後のt=0ブランクで上書きを防ぐ)。 */
async function freezePreview(wc: Electron.WebContents): Promise<void> {
  if (frozen) return
  frozen = true
  if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isDestroyed()) return
  try {
    const snap = await wc.capturePage()
    await new Promise<void>((resolve) => {
      const onReady = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        ipcMain.removeListener('capture:freezeReady', onReady)
        resolve()
      }, FREEZE_READY_TIMEOUT_MS)
      ipcMain.once('capture:freezeReady', onReady)
      mainWin!.webContents.send('capture:freeze', snap.toDataURL())
    })
  } catch {
    // フリーズ表示に失敗しても撮影自体は続行する(見た目が一瞬変わるだけ)
  }
}

function unfreezePreview(): void {
  frozen = false
  sendMain('capture:unfreeze', null)
}

export type CaptureSurfaceHandle = {
  /** enlarge時: capturePageが返すはずの物理px。native時はnull(そのまま撮って縮小する) */
  expected: TargetSize | null
  release: () => Promise<void>
}

// 拡大サーフェスはviewのbounds/zoomを専有するため、同時に1つしか保持できない。
let surfaceHeld = false

/**
 * 撮影サーフェスを確保する。targetが表示以下ならnative(何もしない)。
 * 超えるなら、フリーズ画像を表示→viewを左端2pxスリバーを残して画面外で拡大
 * →zoomでレイアウト維持、まで済ませた状態で返す。releaseで完全に元へ戻す。
 *
 * targetが表示の物理px以下なら、viewをそのまま撮る(呼び出し側が高品質縮小で合わせる)。
 * 表示を超えるtargetでは、viewのboundsを目標物理pxぶんに拡大し、zoomFactorで
 * レイアウト幅を維持して撮り、終わったら戻す。enableDeviceEmulationのdeviceScaleFactorは
 * capturePageの解像度に反映されない(表示DPRのまま)ため、実際にレンダリング面を広げて撮る。
 * boundsがウィンドウより大きくてもcapturePageは全面を返し、zoomはdevicePixelRatioに
 * 反映されるのでcanvas作品も高解像度で再描画される。
 * 拡大中はプレビューが乱れるため、直前のスナップショットをレンダラーに固定表示させた上で
 * viewを左端2pxだけ残して画面外へ退避する(ユーザーには見た目の変化がほぼ無い)。
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

  if (surfaceHeld) throw new Error('capture surface already in use')
  surfaceHeld = true

  // 元へ戻す共通処理。ウィンドウを閉じて開き直した後でも安全なように、
  // 確保時のwebContentsが現在のviewのものか確認してから触る。
  const restore = async (): Promise<void> => {
    surfaceHeld = false
    if (!view || view.webContents !== wc || wc.isDestroyed()) return
    wc.setZoomFactor(prevZoom)
    view.setBounds(prevBounds)
    // 表示を元へ戻すため、作品にもう一度再レイアウトを促す。
    wc.executeJavaScript(`window.dispatchEvent(new Event('resize'))`).catch(() => {})
    // 元のサイズでの再描画が画面に乗るまで少し待ってからフリーズ画像を外す。
    await new Promise((r) => setTimeout(r, 120))
    unfreezePreview()
  }

  await freezePreview(wc)
  try {
    view.setBounds({
      x: CAPTURE_SLIVER_PX - plan.bounds.width,
      y: prevBounds.y,
      ...plan.bounds,
    })
    wc.setZoomFactor(plan.zoomFactor)
    // サイズ・DPRを変えただけでは多くの作品はcanvasを描き直さない。
    // resizeイベントを送って作品自身に高解像度バッファで再描画させ、数フレーム安定を待つ。
    await settleAfterDprChange(wc)
  } catch (err) {
    // 確保に失敗したら元へ戻す。restore自体の失敗で元のエラーを隠さない。
    await restore().catch(() => {})
    throw err
  }
  let released = false
  return {
    expected: plan.expected,
    release: async () => {
      if (released) return
      released = true
      await restore()
    }
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

/** 作品にresizeを通知し、再描画が落ち着くまで複数フレーム待つ。 */
async function settleAfterDprChange(wc: Electron.WebContents): Promise<void> {
  // 作品がrAFを乗っ取る等どんな状況でも確保処理がハングしないように、上限2秒で打ち切る。
  await Promise.race([
    wc
      .executeJavaScript(
        `new Promise((res) => {
          window.dispatchEvent(new Event('resize'));
          // Renderモード(仮想時計)ではrAFはstep()まで発火しないため即解決する
          // (高DPRでの再描画はレンダリングループのstepが駆動する)。
          if (window.__iocapRender) { res(true); return; }
          let n = 0;
          const tick = () => (++n < 6 ? requestAnimationFrame(tick) : res(true));
          requestAnimationFrame(tick);
        })`
      )
      .catch(() => {}),
    new Promise((r) => setTimeout(r, 2000))
  ])
  // 重い作品の描画完了を少し余分に待つ。
  await new Promise((r) => setTimeout(r, 120))
}

export function getArtworkView(): WebContentsView | null {
  return view
}

export function getMainWindow(): BrowserWindow | null {
  return mainWin
}

/** Renderモード用: 現在の見た目でプレビューを固定する(既に固定済みなら何もしない)。 */
export async function freezeArtworkPreview(): Promise<void> {
  if (view) await freezePreview(view.webContents)
}

export function unfreezeArtworkPreview(): void {
  unfreezePreview()
}
