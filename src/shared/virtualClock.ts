/**
 * 仮想時計: ページの時間進行(タイマー/rAF/now)を実時間から切り離し、step(ms)で進める。
 * Renderモード(オフラインレンダリング)で1フレームずつ確実に描画させるための心臓部。
 *
 * 注意: createVirtualClock は toString() でページのmain worldへ注入されるため、
 * 自己完結であること(モジュールスコープの変数・import・TSヘルパを参照しない)。
 */
export type VirtualClockDeps = {
  /** 実rAF: stepの最後に実フレームの描画完了を待つために使う */
  realRaf: (cb: (t: number) => void) => number
}

export function createVirtualClock(deps: VirtualClockDeps): {
  now: () => number
  step: (ms: number) => Promise<void>
  setTimeout: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearTimeout: (id: number) => void
  setInterval: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearInterval: (id: number) => void
  requestAnimationFrame: (cb: (t: number) => void) => number
  cancelAnimationFrame: (id: number) => void
} {
  let now = 0
  let nextId = 1
  type Timer = {
    id: number
    due: number
    every: number | null
    cb: (...a: unknown[]) => void
    args: unknown[]
  }
  const timers: Timer[] = []
  let rafQueue: { id: number; cb: (t: number) => number | void }[] = []

  const addTimer = (
    cb: (...a: unknown[]) => void,
    ms: number,
    every: number | null,
    args: unknown[]
  ): number => {
    const id = nextId++
    timers.push({ id, due: now + Math.max(0, ms), every, cb, args })
    return id
  }
  const removeTimer = (id: number): void => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }

  return {
    now: () => now,
    setTimeout: (cb, ms = 0, ...args) => addTimer(cb, ms, null, args),
    clearTimeout: removeTimer,
    setInterval: (cb, ms = 0, ...args) => addTimer(cb, ms, Math.max(1, ms), args),
    clearInterval: removeTimer,
    requestAnimationFrame: (cb) => {
      const id = nextId++
      rafQueue.push({ id, cb })
      return id
    },
    cancelAnimationFrame: (id) => {
      const i = rafQueue.findIndex((r) => r.id === id)
      if (i >= 0) rafQueue.splice(i, 1)
    },
    async step(ms) {
      const target = now + ms
      // 期限順にタイマーを実行。実行中に追加された期限内タイマーも拾う
      for (;;) {
        let earliest: Timer | null = null
        for (const t of timers) {
          if (t.due <= target && (!earliest || t.due < earliest.due)) earliest = t
        }
        if (!earliest) break
        now = Math.max(now, earliest.due)
        if (earliest.every != null) earliest.due += earliest.every
        else removeTimer(earliest.id)
        earliest.cb(...earliest.args)
      }
      now = target
      // rAFはフレームにつき1回。実行中のrequestAnimationFrameは次フレームへ
      const q = rafQueue
      rafQueue = []
      for (const r of q) r.cb(now)
      // 実フレームの描画完了を待つ(ダブルrAF)。capturePageが新しい絵を見られるように
      await new Promise<void>((res) => deps.realRaf(() => deps.realRaf(() => res())))
    }
  }
}

/**
 * ページのmain worldへ注入するブートストラップ。グローバルを仮想時計に差し替え、
 * window.__iocapRender = { step, ready } を公開する。
 * 注入はページスクリプトより先(artwork preloadのwebFrame.executeJavaScript)に行うこと。
 */
export const VIRTUAL_CLOCK_BOOTSTRAP = `(() => {
  const createVirtualClock = ${createVirtualClock.toString()};
  const clock = createVirtualClock({
    realRaf: window.requestAnimationFrame.bind(window),
  });
  const RealDate = Date;
  const t0 = RealDate.now();
  performance.now = () => clock.now();
  window.Date = new Proxy(RealDate, {
    construct(target, args) {
      return args.length ? new target(...args) : new target(t0 + clock.now());
    },
    apply() {
      return new RealDate(t0 + clock.now()).toString();
    },
  });
  window.Date.now = () => t0 + clock.now();
  window.requestAnimationFrame = (cb) => clock.requestAnimationFrame(cb);
  window.cancelAnimationFrame = (id) => clock.cancelAnimationFrame(id);
  window.setTimeout = (cb, ms, ...a) => clock.setTimeout(cb, ms, ...a);
  window.clearTimeout = (id) => clock.clearTimeout(id);
  window.setInterval = (cb, ms, ...a) => clock.setInterval(cb, ms, ...a);
  window.clearInterval = (id) => clock.clearInterval(id);
  window.__iocapRender = { step: (ms) => clock.step(ms), ready: true };
})()`
