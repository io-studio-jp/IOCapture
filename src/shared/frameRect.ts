import type { Aspect } from './aspect'

export type Rect = { x: number; y: number; width: number; height: number }

/** ステージ領域(padding控除後)に aspect を最大内接させ、中央寄せした矩形を返す。 */
export function computeFrameRect(
  stage: { width: number; height: number },
  aspect: Aspect,
  padding = 16,
): Rect {
  const availW = Math.max(0, stage.width - padding * 2)
  const availH = Math.max(0, stage.height - padding * 2)
  const target = aspect.w / aspect.h
  let width = availW
  let height = width / target
  if (height > availH) {
    height = availH
    width = height * target
  }
  width = Math.round(width)
  height = Math.round(height)
  const x = padding + Math.round((availW - width) / 2)
  const y = padding + Math.round((availH - height) / 2)
  return { x, y, width, height }
}
