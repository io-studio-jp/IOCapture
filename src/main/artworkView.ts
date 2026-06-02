import { WebContentsView, BrowserWindow } from 'electron'
import type { Rect } from '../shared/frameRect'
import { setLastUrl } from './state'

let view: WebContentsView | null = null
let lastRect: Rect | null = null
let mainWin: BrowserWindow | null = null

// 機能6: CSS非表示セレクタ
let hideSelectors = ''
let picking = false
let hideCursor = false

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

// 作品ページのカーソルを隠す（動画録画への写り込み対策。トグル）。
function applyCursor(): void {
  const wc = view?.webContents
  if (!wc) return
  const css = hideCursor ? '*, *::before, *::after { cursor: none !important }' : ''
  wc.executeJavaScript(
    `(() => {
      let s = document.getElementById('__record_cursor__');
      if (!s) { s = document.createElement('style'); s.id = '__record_cursor__'; (document.head || document.documentElement).appendChild(s); }
      s.textContent = ${JSON.stringify(css)};
    })()`,
  ).catch(() => {})
}

export function setHideCursor(v: boolean): void {
  hideCursor = v
  applyCursor()
}

export function ensureArtworkView(win: BrowserWindow): WebContentsView {
  mainWin = win
  if (view) return view
  view = new WebContentsView()
  win.contentView.addChildView(view)
  const wc = view.webContents
  wc.on('did-fail-load', (_e, code, desc, url) => {
    win.webContents.send('artwork:loadError', { code, desc, url })
  })
  // 読み込み・遷移のたびにCSSが失われるので毎回注入する。
  wc.on('did-finish-load', () => {
    wc.insertCSS(HIDE_SCROLLBAR_CSS).catch(() => {})
    applyHide()
    applyCursor()
  })
  const sendUrl = (url: string): void => {
    setLastUrl(url)
    win.webContents.send('artwork:urlChanged', url)
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

/** クリックで要素を選んで消すモードを開始（Esc/Stopで終了するまで連続でピック）。 */
export async function startPicking(): Promise<void> {
  if (picking) return
  const wc = view?.webContents
  if (!wc || !mainWin) return
  picking = true
  mainWin.webContents.send('artwork:pickState', true)
  try {
    while (picking) {
      const selector: string | null = await wc.executeJavaScript(PICKER_SCRIPT).catch(() => null)
      if (!picking || !selector) break
      appendHideSelector(selector)
      applyHide()
      mainWin.webContents.send('artwork:hideSelectorsChanged', hideSelectors)
    }
  } finally {
    picking = false
    mainWin?.webContents.send('artwork:pickState', false)
  }
}

export function stopPicking(): void {
  picking = false
  view?.webContents
    .executeJavaScript('window.__recordPickerCancel && window.__recordPickerCancel()')
    .catch(() => {})
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
  })
  try {
    // DPRを上げただけでは多くの作品はcanvasを描き直さない。
    // resizeイベントを送って作品自身に高解像度バッファで再描画させ、数フレーム安定を待つ。
    await settleAfterDprChange(wc)
    return await fn(view!)
  } finally {
    wc.disableDeviceEmulation()
    // 表示を元のDPRへ戻すため、作品にもう一度再レイアウトを促す。
    wc.executeJavaScript(`window.dispatchEvent(new Event('resize'))`).catch(() => {})
  }
}

/** 作品にresizeを通知し、再描画が落ち着くまで複数フレーム待つ。 */
async function settleAfterDprChange(wc: Electron.WebContents): Promise<void> {
  await wc
    .executeJavaScript(
      `new Promise((res) => {
        window.dispatchEvent(new Event('resize'));
        let n = 0;
        const tick = () => (++n < 6 ? requestAnimationFrame(tick) : res(true));
        requestAnimationFrame(tick);
      })`,
    )
    .catch(() => {})
  // 重い作品の描画完了を少し余分に待つ。
  await new Promise((r) => setTimeout(r, 120))
}

export function getArtworkView(): WebContentsView | null {
  return view
}
