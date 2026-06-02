import { WebContentsView, BrowserWindow } from 'electron'
import type { Rect } from '../shared/frameRect'

let view: WebContentsView | null = null
let lastRect: Rect | null = null

// 作品ページのスクロールバーを隠す（スクロール自体は可能）。macOSのオーバーレイ
// スクロールバーはレイアウト幅を取らないため、構図には影響しない。
const HIDE_SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
  html { scrollbar-width: none !important; -ms-overflow-style: none !important; }
`

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
  })
  const sendUrl = (url: string): void => win.webContents.send('artwork:urlChanged', url)
  wc.on('did-navigate', (_e, url) => sendUrl(url))
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) sendUrl(url)
  })
  if (lastRect) view.setBounds(lastRect)
  return view
}

export function loadArtworkUrl(win: BrowserWindow, url: string): void {
  const v = ensureArtworkView(win)
  v.webContents.loadURL(url)
}

export function setArtworkRect(rect: Rect): void {
  lastRect = rect
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
