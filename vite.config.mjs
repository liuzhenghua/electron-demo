import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const desktopPackagingDir = path.join(rootDir, 'packaging', 'desktop')

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, rootDir, '')
  const packagingEnv = dotenv.config({
    path: path.join(desktopPackagingDir, `${mode}.env`),
    quiet: true
  }).parsed || {}
  const uiUrl = new URL(localEnv.ELECTRON_UI_URL || 'http://localhost:5173')
  const serverUrl = (
    process.env.VITE_SERVER_URL ||
    packagingEnv.VITE_SERVER_URL ||
    'http://127.0.0.1:4123'
  ).replace(/\/$/, '')

  // Electron 主进程不会经过 Vite 编译，因此将构建环境写入随包分发的运行时配置。
  const electronRuntimeConfig = {
    name: 'electron-runtime-config',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'runtime-config.json',
        source: `${JSON.stringify({ mode, serverUrl }, null, 2)}\n`
      })
    }
  }

  return {
    plugins: [react(), electronRuntimeConfig],
    base: './',
    server: {
      host: uiUrl.hostname,
      port: Number(uiUrl.port) || 5173,
      strictPort: true
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  }
})
