import { test, expect } from 'vitest'
import { annotatePng } from './png'

// ---- テスト用の最小PNG構築/解析ヘルパ ----

function crc32(buf: Uint8Array): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function makePng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(2, 0) // width
  ihdrData.writeUInt32BE(2, 4) // height
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', Buffer.from([0, 1, 2, 3])),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PNGのチャンク一覧を {type, data, crcOk} で返す */
function parseChunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out: { type: string; data: Buffer; crcOk: boolean }[] = []
  let p = 8
  while (p < png.length) {
    const len = png.readUInt32BE(p)
    const type = png.subarray(p + 4, p + 8).toString('latin1')
    const data = png.subarray(p + 8, p + 8 + len)
    const crc = png.readUInt32BE(p + 8 + len)
    const crcOk = crc === crc32(png.subarray(p + 4, p + 8 + len))
    out.push({ type, data: Buffer.from(data), crcOk })
    p += 12 + len
  }
  return out
}

// ---- テスト ----

test('inserts sRGB and gAMA right after IHDR with valid CRCs', () => {
  const out = annotatePng(makePng())
  const chunks = parseChunks(out)
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'sRGB', 'gAMA', 'IDAT', 'IEND'])
  const srgb = chunks.find((c) => c.type === 'sRGB')!
  expect(srgb.data).toEqual(Buffer.from([0])) // perceptual
  expect(srgb.crcOk).toBe(true)
  const gama = chunks.find((c) => c.type === 'gAMA')!
  expect(gama.data.readUInt32BE(0)).toBe(45455)
  expect(gama.crcOk).toBe(true)
})

test('inserts pHYs with pixels-per-meter when dpi is given', () => {
  const out = annotatePng(makePng(), { dpi: 300 })
  const chunks = parseChunks(out)
  const phys = chunks.find((c) => c.type === 'pHYs')!
  expect(phys).toBeTruthy()
  expect(phys.crcOk).toBe(true)
  expect(phys.data.readUInt32BE(0)).toBe(11811) // round(300 / 0.0254)
  expect(phys.data.readUInt32BE(4)).toBe(11811)
  expect(phys.data[8]).toBe(1) // unit: meter
})

test('omits pHYs when dpi is not given', () => {
  const chunks = parseChunks(annotatePng(makePng()))
  expect(chunks.some((c) => c.type === 'pHYs')).toBe(false)
})

test('is idempotent (re-annotation does not duplicate chunks)', () => {
  const once = annotatePng(makePng(), { dpi: 300 })
  const twice = annotatePng(once, { dpi: 300 })
  const chunks = parseChunks(twice)
  expect(chunks.filter((c) => c.type === 'sRGB')).toHaveLength(1)
  expect(chunks.filter((c) => c.type === 'pHYs')).toHaveLength(1)
  expect(twice.length).toBe(once.length)
})

test('returns input unchanged when not a PNG', () => {
  const notPng = Buffer.from('hello')
  expect(annotatePng(notPng)).toEqual(notPng)
})
