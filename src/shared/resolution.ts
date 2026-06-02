import type { Aspect } from './aspect'

export type TargetSize = { width: number; height: number }

export function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi)
}

/** 長辺ピクセルを固定し、比率からもう片方を導出。 */
export function targetFromLongEdge(aspect: Aspect, longEdgePx: number): TargetSize {
  const ratio = aspect.w / aspect.h
  if (ratio >= 1) {
    return { width: longEdgePx, height: Math.round(longEdgePx / ratio) }
  }
  return { width: Math.round(longEdgePx * ratio), height: longEdgePx }
}

/** 幅をcm+dpiで固定し、比率から高さを導出。 */
export function targetFromWidthCm(aspect: Aspect, widthCm: number, dpi: number): TargetSize {
  const width = cmToPx(widthCm, dpi)
  const ratio = aspect.w / aspect.h
  return { width, height: Math.round(width / ratio) }
}
