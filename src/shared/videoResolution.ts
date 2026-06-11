import type { Aspect } from './aspect'
import type { TargetSize } from './resolution'

/** 短辺(高さ基準)の値からW×Hを作る。比率を保つ。 */
function sizeForShortEdge(aspect: Aspect, height: number): TargetSize {
  const ratio = aspect.w / aspect.h
  // 偶数に丸める（動画コーデックは偶数寸法を好む）
  const width = Math.round((height * ratio) / 2) * 2
  return { width, height }
}

/**
 * ソースの実解像度(幅)を超えるターゲットを、アスペクトを保ってソース幅まで縮める。
 * 引き伸ばし＋ロス圧縮による画質劣化(ガビガビ)を防ぐ。動画コーデック向けに偶数丸め。
 */
export function capToSourceWidth(target: TargetSize, sourceWidth: number): TargetSize {
  const round2 = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  const fit = Math.min(1, sourceWidth / target.width)
  return { width: round2(target.width * fit), height: round2(target.height * fit) }
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
