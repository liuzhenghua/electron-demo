const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const dotenv = require('dotenv')

const envPath = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(app.getAppPath(), '.env')

dotenv.config({ path: envPath, quiet: true })

const uiUrl = process.env.ELECTRON_UI_URL?.trim() || null
const localIndex = path.join(app.getAppPath(), 'dist', 'index.html')

async function loadRenderer(window) {
  if (!uiUrl) {
    await window.loadFile(localIndex)
    return
  }

  // Vite 和 Electron 同时启动时，开发服务器可能稍晚就绪。
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await window.loadURL(uiUrl)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Vite UI is unavailable at ${uiUrl}`)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f5f7fb',
    title: 'Electron Demo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  loadRenderer(window).catch((error) => console.error(error))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const isAllowed = uiUrl
      ? new URL(url).origin === new URL(uiUrl).origin
      : url === pathToFileURL(localIndex).href

    if (!isAllowed) event.preventDefault()
  })
}

app.whenReady().then(() => {
  ipcMain.handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
