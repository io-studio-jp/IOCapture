import type { Rect } from './frameRect'
import type { TargetSize } from './resolution'

export const IPC = {
  loadUrl: 'artwork:loadUrl',
  getLastUrl: 'artwork:getLastUrl',
  setFrameRect: 'artwork:setFrameRect',
  captureStill: 'capture:still',
  convertToMp4: 'video:convertToMp4',
  saveBlob: 'file:saveBlob',
  // 機能2: ナビゲーション
  goBack: 'artwork:goBack',
  goForward: 'artwork:goForward',
  reload: 'artwork:reload',
  // 機能3: プリセット記憶
  getPrefs: 'state:getPrefs',
  setPrefs: 'state:setPrefs',
  // 機能6: CSS非表示
  setHideSelectors: 'artwork:setHideSelectors',
  startPick: 'artwork:startPick',
  stopPick: 'artwork:stopPick',
  getContentInset: 'window:getContentInset',
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

// 機能3: プリセット記憶の型
export type Prefs = {
  aspect?: { w: number; h: number }
  stillMode?: 'px' | 'cm'
  longEdge?: number
  widthCm?: number
  dpi?: number
  videoPreset?: string
  hideSelectors?: string
  hideCursor?: boolean
  stillTimer?: number
}
