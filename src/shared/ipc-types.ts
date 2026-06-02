import type { Rect } from './frameRect'
import type { TargetSize } from './resolution'

export const IPC = {
  loadUrl: 'artwork:loadUrl',
  getLastUrl: 'artwork:getLastUrl',
  setFrameRect: 'artwork:setFrameRect',
  captureStill: 'capture:still',
  convertToMp4: 'video:convertToMp4',
  saveBlob: 'file:saveBlob',
} as const

export type LoadUrlArgs = { url: string }
export type SetFrameRectArgs = { rect: Rect }
export type CaptureStillArgs = { target: TargetSize; transparent: boolean }
export type CaptureStillResult =
  | { ok: true; savedPath: string; width: number; height: number }
  | { ok: false; error: string }
export type ConvertToMp4Args = { webmPath: string }
export type ConvertToMp4Result = { ok: true; mp4Path: string } | { ok: false; error: string }
export type SaveBlobArgs = { data: ArrayBuffer; defaultName: string }
export type SaveBlobResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }
