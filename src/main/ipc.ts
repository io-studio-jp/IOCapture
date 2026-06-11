import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { IPC } from '../shared/ipc-types'
import type { LoadUrlArgs, SetFrameRectArgs, CaptureStillArgs, CaptureStillToArgs, ConvertToMp4Args, SaveBlobArgs, StartRenderArgs } from '../shared/ipc-types'
import type { Prefs } from '../shared/ipc-types'
import {
  loadArtworkUrl,
  setArtworkRect,
  goBack,
  goForward,
  reloadArtwork,
  setHideSelectors,
  startPicking,
  stopPicking,
} from './artworkView'
import { captureStill, captureStillTo } from './capture'
import { convertToMp4, saveWebmAs } from './ffmpeg'
import { startFrameCapture, stopFrameCapture, isFrameRecording } from './frameRecorder'
import { startRender, cancelRender, isRendering } from './renderRecorder'
import { getLastUrl, getPrefs, setPrefs } from './state'
import { isVirtualRenderMode } from './renderState'
import { checkForUpdate } from './updater'
import type { StartFrameCaptureArgs, StopFrameCaptureArgs } from '../shared/ipc-types'

export function registerIpc(getWindow: () => BrowserWindow): void {
  ipcMain.handle(IPC.loadUrl, (_e, args: LoadUrlArgs) => {
    loadArtworkUrl(getWindow(), args.url)
    return { ok: true }
  })

  ipcMain.handle(IPC.getLastUrl, () => getLastUrl())

  ipcMain.on(IPC.setFrameRect, (_e, args: SetFrameRectArgs) => {
    setArtworkRect(args.rect)
  })

  // レンダリング中はviewのbounds/zoomを専有しているため、静止画撮影は受け付けない。
  ipcMain.handle(IPC.captureStill, (_e, args: CaptureStillArgs) =>
    isRendering() ? { ok: false, error: 'rendering in progress' } : captureStill(args)
  )
  ipcMain.handle(IPC.captureStillTo, (_e, args: CaptureStillToArgs) =>
    isRendering() ? { ok: false, error: 'rendering in progress' } : captureStillTo(args)
  )
  ipcMain.handle(IPC.chooseFolder, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return canceled || !filePaths[0] ? null : filePaths[0]
  })

  // Renderモードと録画は同時に使えない(viewの専有が衝突する)。
  ipcMain.handle(IPC.startFrameCapture, (_e, args: StartFrameCaptureArgs) =>
    isRendering()
      ? { ok: false, error: 'rendering in progress' }
      : startFrameCapture(args.target, args.fps, args.includeCursor, args.format)
  )
  ipcMain.handle(IPC.stopFrameCapture, (_e, args: StopFrameCaptureArgs) =>
    stopFrameCapture(args.audio),
  )
  ipcMain.handle(IPC.saveWebmAsMp4, (_e, args: { data: ArrayBuffer; format: 'mp4' | 'webp' }) =>
    saveWebmAs(args.data, args.format),
  )

  ipcMain.handle(IPC.convertToMp4, (_e, args: ConvertToMp4Args) => convertToMp4(args))

  ipcMain.handle(IPC.saveBlob, async (_e, args: SaveBlobArgs) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: args.defaultName,
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    await writeFile(filePath, Buffer.from(args.data))
    return { ok: true, path: filePath }
  })

  // 機能2: ナビゲーション
  ipcMain.on(IPC.goBack, () => goBack())
  ipcMain.on(IPC.goForward, () => goForward())
  ipcMain.on(IPC.reload, () => reloadArtwork())

  // 機能3: プリセット記憶（getPrefsは同期: sendSyncで返す）
  ipcMain.on(IPC.getPrefs, (e) => { e.returnValue = getPrefs() })
  ipcMain.on(IPC.setPrefs, (_e, p: Partial<Prefs>) => setPrefs(p))

  // 機能6: CSS非表示
  ipcMain.on(IPC.setHideSelectors, (_e, sel: string) => setHideSelectors(sel))
  ipcMain.on(IPC.startPick, () => startPicking())
  ipcMain.on(IPC.stopPick, () => stopPicking())
  ipcMain.on(IPC.revealFile, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.on(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdate())

  // 作品preloadがRenderモード(仮想時計)かを同期で問い合わせる
  ipcMain.on(IPC.renderIsVirtual, (e) => {
    e.returnValue = isVirtualRenderMode()
  })

  // 録画中はRenderモードを開始できない(viewの専有が衝突する)。
  ipcMain.handle(IPC.startRender, (_e, args: StartRenderArgs) =>
    isFrameRecording() ? { ok: false, error: 'recording in progress' } : startRender(args)
  )
  ipcMain.on(IPC.cancelRender, () => cancelRender())

  // 動画クロップ用: ウィンドウ外枠とコンテンツ領域の差（≒タイトルバー高さ）。
  // desktopCapturerはタイトルバー込みでウィンドウを撮るため、この分だけ原点をずらす。
  ipcMain.handle(IPC.getContentInset, () => {
    const win = getWindow()
    const b = win.getBounds()
    const c = win.getContentBounds()
    return { x: c.x - b.x, y: c.y - b.y }
  })
}
