import type { Rect } from './frameRect'
import type { TargetSize } from './resolution'

export const IPC = {
  loadUrl: 'artwork:loadUrl',
  getLastUrl: 'artwork:getLastUrl',
  setFrameRect: 'artwork:setFrameRect',
  captureStill: 'capture:still',
  captureStillTo: 'capture:stillTo',
  chooseFolder: 'file:chooseFolder',
  convertToMp4: 'video:convertToMp4',
  saveBlob: 'file:saveBlob',
  startFrameCapture: 'video:startFrameCapture',
  stopFrameCapture: 'video:stopFrameCapture',
  saveWebmAsMp4: 'video:saveWebmAsMp4',
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
  revealFile: 'file:reveal',
  openExternal: 'shell:openExternal',
  checkUpdate: 'app:checkUpdate',
} as const

export type UpdateInfo = { update: boolean; version?: string; url?: string }

export type LoadUrlArgs = { url: string }
export type SetFrameRectArgs = { rect: Rect }
export type CaptureStillArgs = { target: TargetSize; transparent: boolean }
export type CaptureStillResult =
  | { ok: true; savedPath: string; width: number; height: number }
  | { ok: false; error: string }
export type CaptureStillToArgs = { target: TargetSize; dir: string; name: string }
export type ConvertToMp4Args = { webmPath: string }
export type ConvertToMp4Result = { ok: true; mp4Path: string } | { ok: false; error: string }
export type SaveBlobArgs = { data: ArrayBuffer; defaultName: string }
export type SaveBlobResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }
export type VideoFormat = 'mp4' | 'webp'
export type StartFrameCaptureArgs = {
  target: TargetSize
  fps: number
  includeCursor: boolean
  format: VideoFormat
}
// width/height: 実際に録画される解像度。表示中のビューの物理解像度が上限のため、
// 要求targetより小さくキャップされることがある(UIで知らせる)。
export type StartFrameCaptureResult = {
  ok: boolean
  error?: string
  width?: number
  height?: number
}
export type StopFrameCaptureArgs = { audio: ArrayBuffer | null }
export type StopFrameCaptureResult =
  | { ok: true; mp4Path: string }
  | { ok: false; canceled?: boolean; error?: string }

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
  videoTimer?: number
  includeCursor?: boolean
  captureEngine?: 'frame' | 'screen'
  outputDir?: string
  intervalCount?: number
  intervalSec?: number
  videoFormat?: VideoFormat
  // VIDEO録画でシステム音声を録音するか(旧設定。audioSourceへ移行済み、読み取りのみ)
  recordAudio?: boolean
  // VIDEO録画の音声ソース('off' | 'system' | 音声入力デバイスのdeviceId)
  audioSource?: string
  // audioSourceがデバイスのときの表示名(未接続時のSelect表示に使う)
  audioSourceLabel?: string
}
