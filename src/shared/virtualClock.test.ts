import { test, expect, vi } from 'vitest'
import { createVirtualClock } from './virtualClock'

// テスト用: 実rAFは即時実行で代用(stepの描画待ちを素通しにする)
const deps = { realRaf: (cb: (t: number) => void): number => (cb(0), 0) }

test('now() starts at 0 and advances by step', async () => {
  const c = createVirtualClock(deps)
  expect(c.now()).toBe(0)
  await c.step(16.5)
  expect(c.now()).toBeCloseTo(16.5, 10)
})

test('setTimeout fires in due order during step', async () => {
  const c = createVirtualClock(deps)
  const order: string[] = []
  c.setTimeout(() => order.push('b'), 20)
  c.setTimeout(() => order.push('a'), 10)
  await c.step(30)
  expect(order).toEqual(['a', 'b'])
})

test('timer scheduled by a timer within the same step still fires', async () => {
  const c = createVirtualClock(deps)
  const order: string[] = []
  c.setTimeout(() => {
    order.push('outer')
    c.setTimeout(() => order.push('inner'), 5)
  }, 5)
  await c.step(20)
  expect(order).toEqual(['outer', 'inner'])
})

test('clearTimeout cancels', async () => {
  const c = createVirtualClock(deps)
  let fired = false
  const id = c.setTimeout(() => (fired = true), 10)
  c.clearTimeout(id)
  await c.step(20)
  expect(fired).toBe(false)
})

test('setInterval fires repeatedly and clearInterval stops it', async () => {
  const c = createVirtualClock(deps)
  let n = 0
  const id = c.setInterval(() => n++, 10)
  await c.step(35) // 10,20,30
  expect(n).toBe(3)
  c.clearInterval(id)
  await c.step(30)
  expect(n).toBe(3)
})

test('rAF callbacks run once per step with virtual timestamp', async () => {
  const c = createVirtualClock(deps)
  const stamps: number[] = []
  const loop = (t: number): void => {
    stamps.push(t)
    c.requestAnimationFrame(loop)
  }
  c.requestAnimationFrame(loop)
  await c.step(16)
  await c.step(16)
  expect(stamps).toEqual([16, 32])
})

test('cancelAnimationFrame cancels', async () => {
  const c = createVirtualClock(deps)
  let fired = false
  const id = c.requestAnimationFrame(() => (fired = true))
  c.cancelAnimationFrame(id)
  await c.step(16)
  expect(fired).toBe(false)
})

test('zero-delay recursive setTimeout terminates within a step (nesting clamp)', async () => {
  const c = createVirtualClock(deps)
  let n = 0
  const tick = (): void => {
    n++
    c.setTimeout(tick, 0)
  }
  c.setTimeout(tick, 0)
  await c.step(16)
  // HTML仕様のネストクランプ(深度5以上は最低4ms)により有限回で止まる
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThan(20)
})

test('a throwing timer does not break later timers and step completes', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const c = createVirtualClock(deps)
    const order: string[] = []
    c.setTimeout(() => {
      throw new Error('boom')
    }, 5)
    c.setTimeout(() => order.push('later'), 10)
    await c.step(16)
    expect(order).toEqual(['later'])
    expect(c.now()).toBe(16)
  } finally {
    errorSpy.mockRestore()
  }
})

test('a throwing rAF callback does not break other rAF callbacks', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const c = createVirtualClock(deps)
    let fired = false
    c.requestAnimationFrame(() => {
      throw new Error('boom')
    })
    c.requestAnimationFrame(() => (fired = true))
    await c.step(16)
    expect(fired).toBe(true)
    expect(c.now()).toBe(16)
  } finally {
    errorSpy.mockRestore()
  }
})

test('step rejects while another step is in progress', async () => {
  const c = createVirtualClock(deps)
  const p = c.step(16)
  await expect(c.step(16)).rejects.toThrow('step already in progress')
  await p
  // ガード解除後は再びstepできる
  await c.step(16)
  expect(c.now()).toBe(32)
})

test('NaN/undefined delay fires as zero-delay timer (browser behavior)', async () => {
  const c = createVirtualClock(deps)
  let fired = 0
  c.setTimeout(() => fired++, NaN)
  c.setTimeout(() => fired++, undefined)
  await c.step(1)
  expect(fired).toBe(2)
})

test('VIRTUAL_CLOCK_BOOTSTRAP is self-contained injectable source', async () => {
  const { VIRTUAL_CLOCK_BOOTSTRAP } = await import('./virtualClock')
  const realDateNow = Date.now
  // window相当のグローバルを持つ関数として評価できること(構文チェック+依存チェック)
  const win = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    requestAnimationFrame: (cb: (t: number) => void) => (cb(0), 0),
    performance: { now: () => 0 },
    Date
  }
  const fn = new Function(
    'window',
    'performance',
    'Date',
    VIRTUAL_CLOCK_BOOTSTRAP + '; return window.__iocapRender'
  )
  const render = fn(win, win.performance, win.Date)
  expect(render.ready).toBe(true)
  // 仮想now=0なのでwin.Date.now()は注入時点の実時刻t0そのもの
  const t0 = win.Date.now()
  await render.step(16)
  // 仮想時刻はt0+16で固定される(now/コンストラクタとも)
  expect(win.Date.now()).toBe(t0 + 16)
  expect(new (win.Date as DateConstructor)().getTime()).toBe(t0 + 16)
  // 本物のDateを汚染しないこと(Proxy経由の代入が実Date.nowを書き換えない)
  expect(Date.now).toBe(realDateNow)
})
