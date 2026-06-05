/**
 * AnalyserNodeのtime domainデータ(Uint8Array、無音=128)からRMSレベルを計算する。
 * 戻り値は0(無音)〜1(フルスケール)。対数変換などの表示調整は呼び出し側で行う。
 */
export function rmsLevel(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (const v of data) {
    const n = (v - 128) / 128
    sum += n * n
  }
  return Math.sqrt(sum / data.length)
}
