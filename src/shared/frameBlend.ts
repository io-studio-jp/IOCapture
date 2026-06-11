/**
 * モーションブラー用のフレーム加算平均。サブフレームのBGRAバッファをUint32Arrayへ
 * 加算し、最後にサンプル数で割って1フレームに合成する(1px=4要素、各バイト独立に平均)。
 */

/** frameの各バイトをaccへ加算する(accより短い分は無視) */
export function sumInto(acc: Uint32Array, frame: Buffer): void {
  const n = Math.min(acc.length, frame.length)
  for (let i = 0; i < n; i++) acc[i] += frame[i]
}

/** 加算済みaccをcountで割り、四捨五入してBufferにする */
export function averageToBuffer(acc: Uint32Array, count: number): Buffer {
  const out = Buffer.allocUnsafe(acc.length)
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(acc[i] / count)
  return out
}
