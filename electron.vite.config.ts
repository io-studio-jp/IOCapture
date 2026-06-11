import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['ffmpeg-static'],
      },
    },
  },
  // 注意: preloadビルドはvirtualClock.tsのVIRTUAL_CLOCK_BOOTSTRAP(関数のtoString()注入)を含む。
  // esbuildのkeepNames等、関数本体に__nameヘルパを差し込む変換を有効にすると
  // ページ注入時にReferenceErrorで壊れる。変換設定を変える際はvirtualClockのE2E確認をすること。
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          artwork: resolve('src/preload/artwork.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
