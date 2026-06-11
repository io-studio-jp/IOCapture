import { test, expect } from 'vitest'
import { createVirtualClock, type VirtualClockDeps } from './virtualClock'

// テスト用の実APIスタブ一式。
// - realRaf: 即時実行(stepの描画待ちを素通しにする)
// - realSetTimeout: 記録のみ(発火はテストが手動で行う。描画待ちのraceはrAF側で決まる)
function makeDeps(): {
  st: { cb: () => void; ms: number; id: number }[]
  cleared: string[]
  setPerfNow: (v: number) => void
  deps: VirtualClockDeps
} {
  const st: { cb: () => void; ms: number; id: number }[] = []
  const cleared: string[] = []
  let rid = 100
  let perfNow = 0
  return {
    st,
    cleared,
    setPerfNow: (v: number): void => {
      perfNow = v
    },
    deps: {
      realRaf: (cb: (t: number) => void): number => (cb(0), rid++),
      realCancelRaf: (id: number): void => {
        cleared.push('raf:' + id)
      },
      realSetTimeout: (cb: () => void, ms: number): number => {
        const id = rid++
        st.push({ cb, ms, id })
        return id
      },
      realClearTimeout: (id: number): void => {
        cleared.push('t:' + id)
      },
      realSetInterval: (): number => rid++,
      realClearInterval: (id: number): void => {
        cleared.push('i:' + id)
      },
      realPerfNow: (): number => perfNow,
      realDateNow: (): number => 1000000 + perfNow
    }
  }
}

// ---- 仮想モード(engage後)の基本動作 ----

test('now() is continuous at engage and advances by step', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  d.setPerfNow(5000)
  expect(c.now()).toBe(5000) // パススルー: 実perf.now
  c.engage()
  expect(c.now()).toBe(5000) // engage直後も連続
  await c.step(16)
  expect(c.now()).toBeCloseTo(5016, 10)
})

test('setTimeout fires in due order during step', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  const order: string[] = []
  c.setTimeout(() => order.push('b'), 20)
  c.setTimeout(() => order.push('a'), 10)
  await c.step(30)
  expect(order).toEqual(['a', 'b'])
})

test('timer scheduled by a timer within the same step still fires', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  const order: string[] = []
  c.setTimeout(() => {
    order.push('outer')
    c.setTimeout(() => order.push('inner'), 5)
  }, 5)
  await c.step(20)
  expect(order).toEqual(['outer', 'inner'])
})

test('zero-delay recursive setTimeout terminates (nesting clamp)', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  let n = 0
  const tick = (): void => {
    n++
    c.setTimeout(tick, 0)
  }
  c.setTimeout(tick, 0)
  await c.step(16)
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThan(50)
})

test('clearTimeout cancels a virtual timer', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  let fired = false
  const id = c.setTimeout(() => (fired = true), 10)
  c.clearTimeout(id)
  await c.step(20)
  expect(fired).toBe(false)
})

test('setInterval fires repeatedly and clearInterval stops it', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  let n = 0
  const id = c.setInterval(() => n++, 10)
  await c.step(35)
  expect(n).toBe(3)
  c.clearInterval(id)
  await c.step(30)
  expect(n).toBe(3)
})

test('rAF callbacks run once per step with continuous timestamps', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  d.setPerfNow(1000)
  c.engage()
  const stamps: number[] = []
  const loop = (t: number): void => {
    stamps.push(t)
    c.requestAnimationFrame(loop)
  }
  c.requestAnimationFrame(loop)
  await c.step(16)
  await c.step(16)
  expect(stamps).toEqual([1016, 1032])
})

test('cancelAnimationFrame cancels a virtual rAF', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  let fired = false
  const id = c.requestAnimationFrame(() => (fired = true))
  c.cancelAnimationFrame(id)
  await c.step(16)
  expect(fired).toBe(false)
})

test('a throwing timer does not break the step', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  d.setPerfNow(0)
  c.engage()
  const order: string[] = []
  c.setTimeout(() => {
    throw new Error('boom')
  }, 5)
  c.setTimeout(() => order.push('after'), 10)
  await c.step(16)
  expect(order).toEqual(['after'])
  expect(c.now()).toBe(16)
})

test('step rejects while another step is in progress', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  c.engage()
  const p1 = c.step(16)
  await expect(c.step(16)).rejects.toThrow('step already in progress')
  await p1
})

// ---- パススルーモード ----

test('passthrough setTimeout delegates to realSetTimeout and fires', () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  let fired = false
  c.setTimeout(() => (fired = true), 5)
  const entry = d.st.find((e) => e.ms === 5)!
  expect(entry).toBeTruthy()
  expect(fired).toBe(false)
  entry.cb()
  expect(fired).toBe(true)
})

test('passthrough clearTimeout clears the mapped real timer', () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  const id = c.setTimeout(() => {}, 7)
  const entry = d.st.find((e) => e.ms === 7)!
  c.clearTimeout(id)
  expect(d.cleared).toContain('t:' + entry.id)
})

test('passthrough cancelAnimationFrame cancels the real rAF', () => {
  const d = makeDeps()
  // realRafは即時実行だとキャンセルを試せないので、このテストだけ遅延型に差し替える
  let lastRafId = 0
  const deps = {
    ...d.deps,
    realRaf: (): number => (lastRafId = 500)
  }
  const c = createVirtualClock(deps)
  const id = c.requestAnimationFrame(() => {})
  c.cancelAnimationFrame(id)
  expect(d.cleared).toContain('raf:' + lastRafId)
})

test('step throws when not engaged', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  await expect(c.step(16)).rejects.toThrow('not engaged')
})

test('disengage returns now()/dateNow() to real time', async () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  d.setPerfNow(2000)
  c.engage()
  await c.step(16)
  expect(c.now()).toBe(2016)
  d.setPerfNow(9000) // 実時間は大きく経過
  c.disengage()
  expect(c.now()).toBe(9000)
  expect(c.dateNow()).toBe(1000000 + 9000)
})

test('engage/disengage are idempotent and engaged() reports state', () => {
  const d = makeDeps()
  const c = createVirtualClock(d.deps)
  expect(c.engaged()).toBe(false)
  c.engage()
  c.engage()
  expect(c.engaged()).toBe(true)
  c.disengage()
  c.disengage()
  expect(c.engaged()).toBe(false)
})

// ---- 注入用ブートストラップ ----

test('VIRTUAL_CLOCK_BOOTSTRAP is self-contained and engage/disengage work', async () => {
  const { VIRTUAL_CLOCK_BOOTSTRAP } = await import('./virtualClock')
  const realDateNow = Date.now
  const win = {
    setTimeout: (() => 0) as unknown,
    clearTimeout: (() => {}) as unknown,
    setInterval: (() => 0) as unknown,
    clearInterval: (() => {}) as unknown,
    requestAnimationFrame: (cb: (t: number) => void) => (cb(0), 0),
    cancelAnimationFrame: () => {},
    performance: { now: () => 1234 },
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
  expect(render.engaged()).toBe(false)

  // パススルー: 上書き後のperformance.nowは実時刻(スタブの1234)を返す
  const winTyped = win as unknown as {
    performance: { now: () => number }
    Date: DateConstructor
  }
  expect(winTyped.performance.now()).toBe(1234)

  render.engage()
  expect(render.engaged()).toBe(true)
  const dateAtEngage = winTyped.Date.now()
  await render.step(16)
  expect(winTyped.Date.now()).toBe(dateAtEngage + 16)
  // 本物のDate.nowは汚染されていない
  expect(Date.now).toBe(realDateNow)

  render.disengage()
  expect(render.engaged()).toBe(false)
})
