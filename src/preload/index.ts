import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc-types'
import type {
  CaptureStillArgs, CaptureStillResult, CaptureStillToArgs,
  ConvertToMp4Args, ConvertToMp4Result,
  SaveBlobArgs, SaveBlobResult,
  StartFrameCaptureResult,
  StopFrameCaptureResult,
  Prefs,
} from '../shared/ipc-types'
import type { Rect } from '../shared/frameRect'
import type { TargetSize } from '../shared/resolution'

const api = {
  loadUrl: (url: string) => ipcRenderer.invoke(IPC.loadUrl, { url }),
  getLastUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.getLastUrl),
  setFrameRect: (rect: Rect) => ipcRenderer.send(IPC.setFrameRect, { rect }),
  captureStill: (args: CaptureStillArgs): Promise<CaptureStillResult> =>
    ipcRenderer.invoke(IPC.captureStill, args),
  captureStillTo: (args: CaptureStillToArgs): Promise<CaptureStillResult> =>
    ipcRenderer.invoke(IPC.captureStillTo, args),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseFolder),
  convertToMp4: (args: ConvertToMp4Args): Promise<ConvertToMp4Result> =>
    ipcRenderer.invoke(IPC.convertToMp4, args),
  saveBlob: (args: SaveBlobArgs): Promise<SaveBlobResult> =>
    ipcRenderer.invoke(IPC.saveBlob, args),
  onLoadError: (cb: (info: { code: number; desc: string; url: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { code: number; desc: string; url: string }): void => cb(info)
    ipcRenderer.on('artwork:loadError', handler)
    return (): void => { ipcRenderer.removeListener('artwork:loadError', handler) }
  },
  onUrlChanged: (cb: (url: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, url: string): void => cb(url)
    ipcRenderer.on('artwork:urlChanged', handler)
    return (): void => { ipcRenderer.removeListener('artwork:urlChanged', handler) }
  },
  // 機能2: ナビゲーション
  goBack: () => ipcRenderer.send(IPC.goBack),
  goForward: () => ipcRenderer.send(IPC.goForward),
  reload: () => ipcRenderer.send(IPC.reload),
  // 機能3: プリセット記憶
  getPrefs: (): Prefs => ipcRenderer.sendSync(IPC.getPrefs),
  setPrefs: (p: Partial<Prefs>) => ipcRenderer.send(IPC.setPrefs, p),
  // 機能6: CSS非表示
  setHideSelectors: (sel: string) => ipcRenderer.send(IPC.setHideSelectors, sel),
  startPick: () => ipcRenderer.send(IPC.startPick),
  stopPick: () => ipcRenderer.send(IPC.stopPick),
  getContentInset: (): Promise<{ x: number; y: number }> => ipcRenderer.invoke(IPC.getContentInset),
  revealFile: (path: string) => ipcRenderer.send(IPC.revealFile, path),
  startFrameCapture: (target: TargetSize, fps: number, includeCursor: boolean): Promise<StartFrameCaptureResult> =>
    ipcRenderer.invoke(IPC.startFrameCapture, { target, fps, includeCursor }),
  stopFrameCapture: (audio: ArrayBuffer | null): Promise<StopFrameCaptureResult> =>
    ipcRenderer.invoke(IPC.stopFrameCapture, { audio }),
  saveWebmAsMp4: (data: ArrayBuffer): Promise<StopFrameCaptureResult> =>
    ipcRenderer.invoke(IPC.saveWebmAsMp4, data),
  onPickState: (cb: (picking: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, picking: boolean): void => cb(picking)
    ipcRenderer.on('artwork:pickState', handler)
    return (): void => { ipcRenderer.removeListener('artwork:pickState', handler) }
  },
  onHideSelectorsChanged: (cb: (sel: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, sel: string): void => cb(sel)
    ipcRenderer.on('artwork:hideSelectorsChanged', handler)
    return (): void => { ipcRenderer.removeListener('artwork:hideSelectorsChanged', handler) }
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('capture', api)
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.capture = api
}

export type CaptureAPI = typeof api
