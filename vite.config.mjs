import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const env = dotenv.config({ path: path.join(rootDir, '.env'), quiet: true }).parsed || {}
const uiUrl = new URL(env.ELECTRON_UI_URL || 'http://localhost:5173')

export default defineConfig({
  plugins: [react()],
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
})
