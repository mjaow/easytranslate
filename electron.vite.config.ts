import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve('src/shared'),
  '@core': resolve('src/core'),
  '@providers': resolve('src/providers')
}

export default defineConfig({
  main: {
    // Bundle the SDKs so a new video helper does not resolve/read hundreds of
    // provider modules before it can answer its first message.
    plugins: [externalizeDepsPlugin({ exclude: ['openai', '@anthropic-ai/sdk'] })],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'native-host': resolve('src/main/native-host.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        // CommonJS, not ESM. Sandboxed renderers refuse an ESM preload outright
        // ("Cannot use import statement outside a module"), which leaves the bridge
        // undefined and both windows dead — so this is what lets sandbox: true work.
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          popup: resolve('src/renderer/popup/index.html'),
          settings: resolve('src/renderer/settings/index.html')
        }
      }
    }
  }
})
