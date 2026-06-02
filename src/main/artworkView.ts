import { WebContentsView, BrowserWindow } from 'electron'
import type { Rect } from '../shared/frameRect'
import { setLastUrl } from './state'

let view: WebContentsView | null = null
let lastRect: Rect | null = null

// 機能6: CSS非表示セレクタ
let hideSelectors = ''

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
