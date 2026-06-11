/**
 * PNGメタデータ埋め込み: Electronの toPNG() は色空間やDPIのチャンクを書かないため、
 * sRGB/gAMA(色の解釈を固定)と pHYs(印刷実寸のDPI)をIHDR直後に挿入する。
 * 依存なしの純バイト操作(チャンク = length(4BE) + type(4) + data + CRC32(type+data))。
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// CRC32(テーブル法)。PNGチャンクのCRCに使う
const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** チャンクtypeが既に存在するか(チャンク構造を歩いて判定) */
function hasChunk(png: Buffer, type: string): boolean {
  let p = 8
  while (p + 8 <= png.length) {
    const len = png.readUInt32BE(p)
    if (png.subarray(p + 4, p + 8).toString('latin1') === type) return true
    p += 12 + len
  }
  return false
}

export type AnnotatePngOptions = {
  /** 印刷向けDPI。指定時はpHYsチャンク(pixels per meter)を埋め込む */
  dpi?: number
}

/**
 * PNGに sRGB(+互換用gAMA) と、dpi指定時は pHYs を埋め込んだ新しいBufferを返す。
 * PNGでない/既に該当チャンクがある場合は安全側(そのまま/スキップ)に倒す。
 */
export function annotatePng(png: Buffer, opts: AnnotatePngOptions = {}): Buffer {
  if (png.length < 33 || !PNG_SIGNATURE.every((b, i) => png[i] === b)) return png

  const inserts: Buffer[] = []
  if (!hasChunk(png, 'sRGB')) {
    inserts.push(buildChunk('sRGB', Buffer.from([0]))) // rendering intent: perceptual
  }
  // sRGB非対応デコーダ向けの互換ガンマ(1/2.2 → 45455/100000)。gAMAは1つしか持てないため独立に確認
  if (!hasChunk(png, 'gAMA')) {
    const gama = Buffer.alloc(4)
    gama.writeUInt32BE(45455)
    inserts.push(buildChunk('gAMA', gama))
  }
  if (opts.dpi && opts.dpi > 0 && !hasChunk(png, 'pHYs')) {
    const ppm = Math.round(opts.dpi / 0.0254)
    const data = Buffer.alloc(9)
    data.writeUInt32BE(ppm, 0)
    data.writeUInt32BE(ppm, 4)
    data[8] = 1 // unit: meter
    inserts.push(buildChunk('pHYs', data))
  }
  if (inserts.length === 0) return png

  // IHDR(シグネチャ8 + 長さ4 + type4 + data13 + CRC4 = 先頭33バイト)の直後に挿入
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8)
  return Buffer.concat([png.subarray(0, ihdrEnd), ...inserts, png.subarray(ihdrEnd)])
}
