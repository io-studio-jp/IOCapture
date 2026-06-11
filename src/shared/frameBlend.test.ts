import { test, expect } from 'vitest'
import { sumInto, averageToBuffer } from './frameBlend'

test('average of two frames is per-byte mean', () => {
  const acc = new Uint32Array(4)
  sumInto(acc, Buffer.from([0, 100, 200, 255]))
  sumInto(acc, Buffer.from([100, 100, 0, 255]))
  expect(averageToBuffer(acc, 2)).toEqual(Buffer.from([50, 100, 100, 255]))
})

test('single frame passes through unchanged', () => {
  const acc = new Uint32Array(3)
  sumInto(acc, Buffer.from([7, 8, 9]))
  expect(averageToBuffer(acc, 1)).toEqual(Buffer.from([7, 8, 9]))
})

test('average rounds to nearest integer', () => {
  const acc = new Uint32Array(1)
  sumInto(acc, Buffer.from([1]))
  sumInto(acc, Buffer.from([2]))
  // (1+2)/2 = 1.5 → 2(四捨五入)
  expect(averageToBuffer(acc, 2)).toEqual(Buffer.from([2]))
})

test('sumInto tolerates frame shorter than accumulator (ignores tail)', () => {
  const acc = new Uint32Array(4)
  sumInto(acc, Buffer.from([1, 1]))
  expect(averageToBuffer(acc, 1)).toEqual(Buffer.from([1, 1, 0, 0]))
})
