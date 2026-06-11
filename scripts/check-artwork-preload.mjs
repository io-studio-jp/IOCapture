// artwork preloadの自己完結チェック。
// 作品viewはsandbox化されており、相対require(共有チャンク分割)があると
// preloadの読み込み自体が失敗してRenderモードが壊れる。__nameヘルパも
// 仮想時計のtoString()注入を壊すため禁止。ビルド後に必ず検査する。
import { readFileSync } from 'node:fs'

const path = 'out/preload/artwork.js'
let src
try {
  src = readFileSync(path, 'utf8')
} catch {
  console.error(`check:preload NG — ${path} が見つからない(先に electron-vite build を実行)`)
  process.exit(1)
}

const violations = ['require("./', "require('./", '__name('].filter((p) => src.includes(p))
if (violations.length > 0) {
  console.error(
    `check:preload NG — ${path} に禁止パターンが含まれる: ${violations.join(', ')}\n` +
      'artwork.tsが他のpreloadエントリとモジュールを共有してチャンク分割された可能性が高い。' +
      'artwork.tsを自己完結に保つこと(electron.vite.config.tsのコメント参照)。'
  )
  process.exit(1)
}
console.log('check:preload OK — artwork.js は自己完結')
