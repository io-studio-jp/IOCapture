import type { TargetSize } from './resolution'

export type CaptureSurfacePlan =
  /** targetが現在の表示の物理px以下: viewをそのまま撮り、高品質縮小で合わせる(スーパーサンプリング)。
   *  低DPRで描き直すより高品質で、撮影時の表示変化も無い。 */
  | { kind: 'native' }
  /** targetが表示を超える: 撮影中だけviewを拡大しzoomで構図を維持する。 */
  | {
      kind: 'enlarge'
      /** 撮影中だけviewに設定するCSSサイズ。ウィンドウより大きくてもcapturePageは全面を返す。 */
      bounds: { width: number; height: number }
      /** レイアウト幅をview幅に保つズーム(bounds.width / viewCssWidth)。pageのDPRはdisplaySF×zoomになる。 */
      zoomFactor: number
      /** capturePageが返すはずの物理px(丸め誤差込み)。targetと違えば最後にresizeで厳密に合わせる。 */
      expected: TargetSize
    }

/**
 * 高解像度撮影のプランを計算する。enableDeviceEmulationのdeviceScaleFactorはcapturePageの
 * 解像度に反映されないため、表示を超えるtargetでは実際にレンダリング面を目標物理pxまで広げる
 * (zoomはdevicePixelRatioに反映されるのでcanvas作品も高解像度で再描画される)。
 */
export function planCaptureSurface(
  target: TargetSize,
  viewCssWidth: number,
  displayScaleFactor: number
): CaptureSurfacePlan {
  const sf = displayScaleFactor > 0 ? displayScaleFactor : 1
  const bounds = {
    width: Math.max(1, Math.round(target.width / sf)),
    height: Math.max(1, Math.round(target.height / sf))
  }
  if (viewCssWidth > 0 && bounds.width <= viewCssWidth) return { kind: 'native' }
  return {
    kind: 'enlarge',
    bounds,
    zoomFactor: viewCssWidth > 0 ? bounds.width / viewCssWidth : 1,
    expected: {
      width: Math.round(bounds.width * sf),
      height: Math.round(bounds.height * sf)
    }
  }
}
