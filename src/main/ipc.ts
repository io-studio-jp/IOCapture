import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { IPC } from '../shared/ipc-types'
import type { LoadUrlArgs, SetFrameRectArgs, CaptureStillArgs, ConvertToMp4Args, SaveBlobArgs } from '../shared/ipc-types'
import { loadArtworkUrl, setArtworkRect } from './artworkView'
import { captureStill } from './capture'
import { convertToMp4 } from './ffmpeg'
import { getLastUrl } from './state'

export function registerIpc(getWindow: () => BrowserWindow): void {
  ipcMain.handle(IPC.loadUrl, (_e, args: LoadUrlArgs) => {
    loadArtworkUrl(getWindow(), args.url)
    return { ok: true }
  })

  ipcMain.handle(IPC.getLastUrl, () => getLastUrl())

  ipcMain.on(IPC.setFrameRect, (_e, args: SetFrameRectArgs) => {
    setArtworkRect(args.rect)
  })

  ipcMain.handle(IPC.captureStill, (_e, args: CaptureStillArgs) => captureStill(args))

  ipcMain.handle(IPC.convertToMp4, (_e, args: ConvertToMp4Args) => convertToMp4(args))

  ipcMain.handle(IPC.saveBlob, async (_e, args: SaveBlobArgs) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: args.defaultName,
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    await writeFile(filePath, Buffer.from(args.data))
    return { ok: true, path: filePath }
  })
}
