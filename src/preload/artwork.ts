// 作品view専用preload。ページの全スクリプトより先に、常時パススルー型の時計シムを
// main worldへ注入する(preloadはドキュメント解析前に実行される)。普段は実時間へ完全委譲
// するためページ動作に影響せず、Renderモードはengage()でその場から仮想化する
// (リロード不要=作品の状態・パラメータを保持したまま録画できる)。
// ※ preloadはメインフレームのみに適用されるため、iframe内の作品には注入されない。
//
// 注意: このファイルは自己完結が必須。他のpreloadエントリ(index.ts)と共有する
// モジュールをimportすると共有チャンクに分割され、sandbox化preloadはrequireできず
// 読み込みに失敗する(ビルド後はnpm run check:preloadで検証される)。
import { webFrame } from 'electron'
import { VIRTUAL_CLOCK_BOOTSTRAP } from '../shared/virtualClock'

webFrame
  .executeJavaScript(VIRTUAL_CLOCK_BOOTSTRAP)
  .catch((e) => console.error('[artwork preload] clock shim injection failed', e))
