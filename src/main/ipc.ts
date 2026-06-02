import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-types'
import type { LoadUrlArgs, SetFrameRectArgs, CaptureStillArgs } from '../shared/ipc-types'
import { loadArtworkUrl, setArtworkRect } from './artworkView'
import { captureStill } from './capture'

export function registerIpc(getWindow: () => BrowserWindow): void {
  ipcMain.handle(IPC.loadUrl, (_e, args: LoadUrlArgs) => {
    loadArtworkUrl(getWindow(), args.url)
    return { ok: true }
  })

  ipcMain.on(IPC.setFrameRect, (_e, args: SetFrameRectArgs) => {
    setArtworkRect(args.rect)
  })

  ipcMain.handle(IPC.captureStill, (_e, args: CaptureStillArgs) => captureStill(args))
}
