/**
 * 仮想時計: ページの時間進行(タイマー/rAF/now)を実時間から切り離し、step(ms)で進める。
 * Renderモード(オフラインレンダリング)で1フレームずつ確実に描画させるための心臓部。
 *
 * 注意: createVirtualClock は toString() でページのmain worldへ注入されるため、
 * 自己完結であること(モジュールスコープの変数・import・TSヘルパを参照しない)。
 *
 * 仮想化されないもの(既知の制限): CSSアニメーション/WAAPI、<video>等のメディア再生、
 * Worker内のタイマー、requestIdleCallback。これらに依存する作品は実時間で進んでしまう。
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
  /** 実行中タイマーのネスト深度(HTML仕様のネストクランプ用) */
  let nesting = 0
  /** step多重実行ガード(描画待ちの交錯による状態破壊を防ぐ) */
  let stepping = false
  type Timer = {
    id: number
    due: number
    every: number | null
    depth: number
    cb: (...a: unknown[]) => void
    args: unknown[]
  }
  const timers: Timer[] = []
  let rafQueue: { id: number; cb: (t: number) => number | void }[] = []

  const addTimer = (
    cb: (...a: unknown[]) => void,
    ms: number,
    repeat: boolean,
    args: unknown[]
  ): number => {
    const id = nextId++
    // ブラウザ同様、NaN/非有限の遅延は0msとして扱う
    let delay = Number.isFinite(+ms) ? Math.max(0, +ms) : 0
    const depth = nesting + 1
    // HTML仕様のネストクランプ: 深度5以上は最低4ms。ゼロ遅延の再帰setTimeoutでもstepが必ず終わる
    if (depth >= 5) delay = Math.max(delay, 4)
    timers.push({
      id,
      due: now + delay,
      every: repeat ? Math.max(1, delay) : null,
      depth,
      cb,
      args
    })
    return id
  }
  const removeTimer = (id: number): void => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }

  return {
    now: () => now,
    setTimeout: (cb, ms = 0, ...args) => addTimer(cb, ms, false, args),
    clearTimeout: removeTimer,
    setInterval: (cb, ms = 0, ...args) => addTimer(cb, ms, true, args),
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
      if (stepping) throw new Error('step already in progress')
      stepping = true
      try {
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
          nesting = earliest.depth
          try {
            earliest.cb(...earliest.args)
          } catch (e) {
            // コールバックの例外でstepを壊さない(報告して続行)
            console.error(e)
          }
          nesting = 0
        }
        now = target
        // rAFはフレームにつき1回。実行中のrequestAnimationFrameは次フレームへ
        const q = rafQueue
        rafQueue = []
        for (const r of q) {
          try {
            r.cb(now)
          } catch (e) {
            console.error(e)
          }
        }
        // 実フレームの描画完了を待つ(ダブルrAF)。capturePageが新しい絵を見られるように
        await new Promise<void>((res) => deps.realRaf(() => deps.realRaf(() => res())))
      } finally {
        stepping = false
      }
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
    construct(target, args, newTarget) {
      // サブクラス(new.target)を保ったまま、引数なしは仮想時刻で生成する
      return Reflect.construct(target, args.length ? args : [t0 + clock.now()], newTarget);
    },
    apply() {
      return new RealDate(t0 + clock.now()).toString();
    },
    get(target, prop, receiver) {
      // Date.nowだけ仮想時刻を返す。本物のRealDate.nowは書き換えない(汚染防止)
      if (prop === 'now') return () => t0 + clock.now();
      return Reflect.get(target, prop, receiver);
    },
  });
  window.requestAnimationFrame = (cb) => clock.requestAnimationFrame(cb);
  window.cancelAnimationFrame = (id) => clock.cancelAnimationFrame(id);
  window.setTimeout = (cb, ms, ...a) => clock.setTimeout(cb, ms, ...a);
  window.clearTimeout = (id) => clock.clearTimeout(id);
  window.setInterval = (cb, ms, ...a) => clock.setInterval(cb, ms, ...a);
  window.clearInterval = (id) => clock.clearInterval(id);
  window.__iocapRender = { step: (ms) => clock.step(ms), ready: true };
})()`
