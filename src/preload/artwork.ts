// 作品view専用preload。Renderモードのときだけ、ページの全スクリプトより先に
// 仮想時計をmain worldへ注入する(preloadはドキュメント解析前に実行される)。
// ※ preloadはメインフレームのみに適用されるため、iframe内の作品には注入されない。
import { ipcRenderer, webFrame } from 'electron'
import { VIRTUAL_CLOCK_BOOTSTRAP } from '../shared/virtualClock'

// チャンネル名はIPC.renderIsVirtual(shared/ipc-types.ts)と一致させること。
// ここでimportすると他のpreloadエントリと共有チャンクに分割され、
// sandbox化preloadはrequireできず読み込みに失敗する(自己完結が必須)。
if (ipcRenderer.sendSync('render:isVirtual') === true) {
  webFrame
    .executeJavaScript(VIRTUAL_CLOCK_BOOTSTRAP)
    .catch((e) => console.error('[artwork preload] virtual clock injection failed', e))
}
