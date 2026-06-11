import { capToGpuLimit } from './dpr'
import type { TargetSize } from './resolution'

/**
 * SSAA(スーパーサンプリング)の描画サイズ計画: 有効時はターゲットの2倍で描画し、
 * 呼び出し側が高品質縮小でターゲットへ合わせる(ジャギー低減)。
 * 2倍がGPU上限(16384px)を超える場合は比率を保ってキャップする(部分的なSSAAになる)。
 */
export function planSupersample(target: TargetSize, enabled: boolean): TargetSize {
  if (!enabled) return target
  return capToGpuLimit({ width: target.width * 2, height: target.height * 2 }).size
}
