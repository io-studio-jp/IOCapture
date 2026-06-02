import type { Aspect } from './aspect'
import type { TargetSize } from './resolution'

/** 短辺(高さ基準)の値からW×Hを作る。比率を保つ。 */
function sizeForShortEdge(aspect: Aspect, height: number): TargetSize {
  const ratio = aspect.w / aspect.h
  // 偶数に丸める（動画コーデックは偶数寸法を好む）
  const width = Math.round((height * ratio) / 2) * 2
  return { width, height }
}

export function videoPresetsFor(
  aspect: Aspect,
): { label: string; size: TargetSize | null }[] {
  return [
    { label: '1080', size: sizeForShortEdge(aspect, 1080) },
    { label: '1440', size: sizeForShortEdge(aspect, 1440) },
    { label: '2160', size: sizeForShortEdge(aspect, 2160) },
    { label: 'Match frame', size: null },
  ]
}
