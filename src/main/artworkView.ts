import { WebContentsView, BrowserWindow } from 'electron'
import type { Rect } from '../shared/frameRect'

let view: WebContentsView | null = null
let lastRect: Rect | null = null

export function ensureArtworkView(win: BrowserWindow): WebContentsView {
  if (view) return view
  view = new WebContentsView()
  win.contentView.addChildView(view)
  view.webContents.on('did-fail-load', (_e, code, desc, url) => {
    win.webContents.send('artwork:loadError', { code, desc, url })
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
    await new Promise((r) => setTimeout(r, 120))
    return await fn(view!)
  } finally {
    wc.disableDeviceEmulation()
  }
}

export function getArtworkView(): WebContentsView | null {
  return view
}
