/**
 * 時計シム: ページの時間API(タイマー/rAF/now)を包み、普段は実時間へ完全委譲(パススルー)し、
 * engage()でその場から仮想モードへ切り替えてstep(ms)で1フレームずつ進められるようにする。
 * Renderモード(オフラインレンダリング)の心臓部。リロード無しで作品の状態を保ったまま録るため、
 * シムはページ読み込み時に常時注入し、engage時の時刻は実時刻と連続にする。
 *
 * 注意: createVirtualClock は toString() でページのmain worldへ注入されるため、
 * 自己完結であること(モジュールスコープの変数・import・TSヘルパを参照しない)。
 *
 * 仮想化されないもの(既知の制限): CSSアニメーション/WAAPI、<video>等のメディア再生、
 * Worker内のタイマー、requestIdleCallback。またengage前に登録済みの実タイマー
 * (長周期のsetInterval等)は実時間のまま走り続ける(rAFループは次の再登録から仮想側に乗る)。
 */
export type VirtualClockDeps = {
  /** 実rAF: パススルー委譲と、stepの描画完了待ちに使う */
  realRaf: (cb: (t: number) => void) => number
  realCancelRaf: (id: number) => void
  /** 実setTimeout: パススルー委譲と、コンポジタ停止時もstepが有限で終わるための保険 */
  realSetTimeout: (cb: () => void, ms: number) => number
  realClearTimeout: (id: number) => void
  realSetInterval: (cb: () => void, ms: number) => number
  realClearInterval: (id: number) => void
  realPerfNow: () => number
  realDateNow: () => number
}

export function createVirtualClock(deps: VirtualClockDeps): {
  engaged: () => boolean
  engage: () => void
  disengage: () => void
  now: () => number
  dateNow: () => number
  step: (ms: number) => Promise<void>
  setTimeout: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearTimeout: (id: number) => void
  setInterval: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number
  clearInterval: (id: number) => void
  requestAnimationFrame: (cb: (t: number) => void) => number
  cancelAnimationFrame: (id: number) => void
} {
  /** 仮想モード中か(falseなら全APIを実時間へ委譲するパススルー) */
  let isEngaged = false
  /** 仮想モードで進めた累計時間(engageを跨いで保持し、仮想タイマーの期限座標にもなる) */
  let elapsed = 0
  /** engage時点のperformance.now/Date.now起点(now()の連続性を保証する) */
  let base = 0
  let dateBase = 0
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
  /** パススルー時に実APIへ委譲した登録の対応表(own id → 実id)。両モードでclearを機能させる。
   *  rAFはengage時に仮想キューへ移譲するためcbも保持する */
  const realMap = new Map<
    number,
    { type: 't' | 'i' | 'raf'; realId: number; cb?: (t: number) => void }
  >()

  // ブラウザ同様、NaN/非有限の遅延は0msとして扱う
  const coerceDelay = (ms: unknown): number =>
    Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0

  const addVirtualTimer = (
    cb: (...a: unknown[]) => void,
    ms: unknown,
    repeat: boolean,
    args: unknown[]
  ): number => {
    const id = nextId++
    let delay = coerceDelay(ms)
    const depth = nesting + 1
    // HTML仕様のネストクランプ: 深度5以上は最低4ms。ゼロ遅延の再帰setTimeoutでもstepが必ず終わる
    if (depth >= 5) delay = Math.max(delay, 4)
    timers.push({
      id,
      due: elapsed + delay,
      every: repeat ? Math.max(1, delay) : null,
      depth,
      cb,
      args
    })
    return id
  }
  const removeVirtualTimer = (id: number): void => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }
  /** clearTimeout/clearIntervalの実体(ブラウザ同様、相互に使える) */
  const clearTimer = (id: number): void => {
    const real = realMap.get(id)
    if (real) {
      // type 'raf' はタイマーのclearでは消さない(ブラウザ挙動に合わせる)。対応表も保持する
      if (real.type === 'raf') return
      realMap.delete(id)
      if (real.type === 't') deps.realClearTimeout(real.realId)
      else deps.realClearInterval(real.realId)
      return
    }
    removeVirtualTimer(id)
  }

  return {
    engaged: () => isEngaged,
    engage: () => {
      if (isEngaged) return
      isEngaged = true
      // 仮想時刻が実時刻と連続になるように起点を合わせる(elapsedはengageを跨いで累積)
      base = deps.realPerfNow() - elapsed
      dateBase = deps.realDateNow() - elapsed
      // パススルーで実rAFへ委譲済みの登録は、engage後に実時刻のタイムスタンプで発火して
      // 単調性が崩れるため、実側をキャンセルして仮想キューへ移す(フレーム0から決定的になる)
      for (const [id, real] of Array.from(realMap)) {
        if (real.type !== 'raf' || !real.cb) continue
        deps.realCancelRaf(real.realId)
        realMap.delete(id)
        rafQueue.push({ id, cb: real.cb })
      }
    },
    disengage: () => {
      if (!isEngaged) return
      isEngaged = false
      // 仮想キューに残った登録を実APIへ移譲する。これが無いと、録画の最終フレームで
      // 再登録されたrAFループが二度と発火せず、録画後に作品のアニメーションが止まる
      const q = rafQueue
      rafQueue = []
      for (const r of q) {
        const realId = deps.realRaf(r.cb)
        realMap.set(r.id, { type: 'raf', realId, cb: r.cb })
      }
      const pendingTimers = timers.splice(0)
      for (const t of pendingTimers) {
        if (t.every != null) {
          // インターバルは周期を保って実側へ(初回発火までの端数は周期で近似)
          const realId = deps.realSetInterval(() => t.cb(...t.args), t.every)
          realMap.set(t.id, { type: 'i', realId })
        } else {
          const remaining = Math.max(0, t.due - elapsed)
          const realId = deps.realSetTimeout(() => {
            realMap.delete(t.id)
            t.cb(...t.args)
          }, remaining)
          realMap.set(t.id, { type: 't', realId })
        }
      }
    },
    now: () => (isEngaged ? base + elapsed : deps.realPerfNow()),
    dateNow: () => (isEngaged ? dateBase + elapsed : deps.realDateNow()),
    setTimeout: (cb, ms = 0, ...args) => {
      if (!isEngaged) {
        const id = nextId++
        const realId = deps.realSetTimeout(() => {
          realMap.delete(id)
          cb(...args)
        }, coerceDelay(ms))
        realMap.set(id, { type: 't', realId })
        return id
      }
      return addVirtualTimer(cb, ms, false, args)
    },
    clearTimeout: clearTimer,
    setInterval: (cb, ms = 0, ...args) => {
      if (!isEngaged) {
        const id = nextId++
        const realId = deps.realSetInterval(() => cb(...args), coerceDelay(ms))
        realMap.set(id, { type: 'i', realId })
        return id
      }
      return addVirtualTimer(cb, ms, true, args)
    },
    clearInterval: clearTimer,
    requestAnimationFrame: (cb) => {
      if (!isEngaged) {
        const id = nextId++
        const realId = deps.realRaf((t) => {
          realMap.delete(id)
          cb(t)
        })
        realMap.set(id, { type: 'raf', realId, cb })
        return id
      }
      const id = nextId++
      rafQueue.push({ id, cb })
      return id
    },
    cancelAnimationFrame: (id) => {
      const real = realMap.get(id)
      if (real) {
        realMap.delete(id)
        if (real.type === 'raf') deps.realCancelRaf(real.realId)
        return
      }
      const i = rafQueue.findIndex((r) => r.id === id)
      if (i >= 0) rafQueue.splice(i, 1)
    },
    async step(ms) {
      if (!isEngaged) throw new Error('not engaged')
      if (stepping) throw new Error('step already in progress')
      stepping = true
      try {
        const target = elapsed + ms
        // 期限順にタイマーを実行。実行中に追加された期限内タイマーも拾う
        for (;;) {
          let earliest: Timer | null = null
          for (const t of timers) {
            if (t.due <= target && (!earliest || t.due < earliest.due)) earliest = t
          }
          if (!earliest) break
          elapsed = Math.max(elapsed, earliest.due)
          if (earliest.every != null) earliest.due += earliest.every
          else removeVirtualTimer(earliest.id)
          nesting = earliest.depth
          try {
            earliest.cb(...earliest.args)
          } catch (e) {
            // コールバックの例外でstepを壊さない(報告して続行)
            console.error(e)
          }
          nesting = 0
        }
        elapsed = target
        // rAFはフレームにつき1回。実行中のrequestAnimationFrameは次フレームへ。
        // タイムスタンプはperformance.now同等の連続値(base+elapsed)
        const q = rafQueue
        rafQueue = []
        for (const r of q) {
          try {
            r.cb(base + elapsed)
          } catch (e) {
            console.error(e)
          }
        }
        // 実フレームの描画完了を待つ(ダブルrAF)。コンポジタが止まっている場合に備えて
        // 上限100msで打ち切る(capturePage自体がフレームを強制するため安全)。
        await new Promise((res) => {
          let done = false
          const finish = (): void => {
            if (!done) {
              done = true
              res(undefined)
            }
          }
          deps.realRaf(() => deps.realRaf(finish))
          deps.realSetTimeout(finish, 100)
        })
      } finally {
        stepping = false
      }
    }
  }
}

/**
 * ページのmain worldへ注入するブートストラップ。実APIを捕まえてからグローバルをシムに差し替え、
 * window.__iocapRender = { step, engage, disengage, engaged, ready } を公開する。
 * 注入はページスクリプトより先(artwork preloadのwebFrame.executeJavaScript)に行うこと。
 * 普段はパススルーなのでページ動作に影響しない。
 */
export const VIRTUAL_CLOCK_BOOTSTRAP = `(() => {
  const createVirtualClock = ${createVirtualClock.toString()};
  // 注意: 下のwindow.*上書きより前に本物を全てbindして捕まえること
  const clock = createVirtualClock({
    realRaf: window.requestAnimationFrame.bind(window),
    realCancelRaf: window.cancelAnimationFrame.bind(window),
    realSetTimeout: window.setTimeout.bind(window),
    realClearTimeout: window.clearTimeout.bind(window),
    realSetInterval: window.setInterval.bind(window),
    realClearInterval: window.clearInterval.bind(window),
    realPerfNow: performance.now.bind(performance),
    realDateNow: Date.now.bind(Date),
  });
  const RealDate = Date;
  performance.now = () => clock.now();
  window.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      // サブクラス(new.target)を保ったまま、引数なしはシム時刻で生成する
      return Reflect.construct(target, args.length ? args : [clock.dateNow()], newTarget);
    },
    apply() {
      return new RealDate(clock.dateNow()).toString();
    },
    get(target, prop, receiver) {
      // Date.nowだけシム時刻を返す。本物のRealDate.nowは書き換えない(汚染防止)
      if (prop === 'now') return () => clock.dateNow();
      return Reflect.get(target, prop, receiver);
    },
  });
  window.requestAnimationFrame = (cb) => clock.requestAnimationFrame(cb);
  window.cancelAnimationFrame = (id) => clock.cancelAnimationFrame(id);
  window.setTimeout = (cb, ms, ...a) => clock.setTimeout(cb, ms, ...a);
  window.clearTimeout = (id) => clock.clearTimeout(id);
  window.setInterval = (cb, ms, ...a) => clock.setInterval(cb, ms, ...a);
  window.clearInterval = (id) => clock.clearInterval(id);
  window.__iocapRender = {
    step: (ms) => clock.step(ms),
    engage: () => clock.engage(),
    disengage: () => clock.disengage(),
    engaged: () => clock.engaged(),
    ready: true,
  };
})()`
