// Renderモード(仮想時計)のフラグ。artwork preloadがsendSyncで読む。
let virtual = false

export function setVirtualRenderMode(on: boolean): void {
  virtual = on
}

export function isVirtualRenderMode(): boolean {
  return virtual
}
