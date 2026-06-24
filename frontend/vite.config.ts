import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** tauri:dev 内嵌后端写 data/backend.port；Web dev 无此文件则回退 8000 */
function readEmbeddedBackendOrigin(): string {
  try {
    const portFile = path.join(repoRoot, 'data', 'backend.port')
    if (fs.existsSync(portFile)) {
      const port = Number.parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10)
      if (port > 0) {
        return `http://127.0.0.1:${port}`
      }
    }
  } catch {
    // ignore
  }
  return 'http://127.0.0.1:8000'
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  
  return {
    plugins: [react()],
    base: isProduction ? './' : '/', // 生产环境使用相对路径
    optimizeDeps: {
      include: ['@tauri-apps/api', '@tauri-apps/api/dialog']
    },
    build: {
      sourcemap: false,
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 1600,
      assetsInclude: ['**/*.wasm'],
      rollupOptions: {
        external: [],
        // NOTE: do NOT hand-split React and antd into separate vendor chunks.
        // antd's top-level code calls React.createContext at module-eval time;
        // when React and antd are in different chunks, the chunk load order is
        // not guaranteed and antd can evaluate before React's CJS-interop is
        // initialized, leaving `React` undefined → "Cannot read properties of
        // undefined (reading 'createContext')" → blank/black screen. Letting
        // Rollup decide chunking keeps React's evaluation ordered correctly.
      },
      // 生产环境禁用 Service Worker
      serviceWorker: false
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true, // 如果端口被占用则报错，而不是自动切换
      hmr: {
        overlay: true
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          router: () => readEmbeddedBackendOrigin(),
        },
        '/health': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          router: () => readEmbeddedBackendOrigin(),
        },
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      setupFiles: ['./vitest.setup.ts'],
    },
  }
})