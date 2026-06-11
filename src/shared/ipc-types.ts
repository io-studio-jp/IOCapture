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
  startRender: 'video:startRender',
  cancelRender: 'video:cancelRender',
} as const

export type UpdateInfo = { update: boolean; version?: string; url?: string }

export type LoadUrlArgs = { url: string }
export type SetFrameRectArgs = { rect: Rect }
export type CaptureStillArgs = {
  target: TargetSize
  transparent: boolean
  /** SSAA: 2倍で描画して縮小(ジャギー低減) */
  supersample?: boolean
  /** 印刷向けDPI(cm/dpi指定時)。PNGのpHYsチャンクに埋め込む */
  dpi?: number
}
export type CaptureStillResult =
  | { ok: true; savedPath: string; width: number; height: number }
  | { ok: false; error: string }
export type CaptureStillToArgs = {
  target: TargetSize
  dir: string
  name: string
  supersample?: boolean
  dpi?: number
}
export type ConvertToMp4Args = { webmPath: string }
export type ConvertToMp4Result = { ok: true; mp4Path: string } | { ok: false; error: string }
export type SaveBlobArgs = { data: ArrayBuffer; defaultName: string }
export type SaveBlobResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }
export type VideoFormat = 'mp4' | 'webp'
export type RenderResult =
  | { ok: true; mp4Path: string }
  | { ok: false; canceled?: boolean; error?: string }

export type StartRenderArgs = {
  target: TargetSize
  fps: number
  durationSec: number
  format: VideoFormat
  /** モーションブラーのサブフレーム数(1=Off, 2/4/8) */
  blurSamples: number
  /** SSAA: 2倍で描画して縮小(ジャギー低減) */
  supersample: boolean
}
export type RenderProgress = { frame: number; total: number }

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
  // 旧: カーソル合成設定(Cleanエンジン削除済み。読み取りのみ)
  includeCursor?: boolean
  // 旧: 録画エンジン(captureModeへ移行済み。読み取りのみ)
  captureEngine?: 'frame' | 'screen'
  // 録画モード: live=画面録画(音声/カーソル) / render=オフラインレンダリング(4K60保証)
  captureMode?: 'live' | 'render'
  // Renderモードの録画秒数
  renderLengthSec?: number
  // Renderのモーションブラーサブフレーム数(1=Off, 2/4/8)
  renderBlurSamples?: number
  // SSAA(2倍描画→縮小)の有効/無効
  renderSupersample?: boolean
  stillSupersample?: boolean
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
