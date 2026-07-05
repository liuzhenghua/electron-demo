const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const dotenv = require('dotenv')
const { runAgent, clearConversation, clearAllConversations } = require('./agent-client.cjs')
const { ChatStore } = require('./chat-store.cjs')

const envPath = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(app.getAppPath(), '.env')

dotenv.config({ path: envPath, quiet: true })

const uiUrl = process.env.ELECTRON_UI_URL?.trim() || null
const localIndex = path.join(app.getAppPath(), 'dist', 'index.html')
const serverUrl = (process.env.SERVER_URL || process.env.VITE_SERVER_URL || 'http://127.0.0.1:4123').replace(/\/$/, '')
const chatRequests = new Map()
const permissionRequests = new Map()
let chatStore

async function loadModels() {
  const response = await fetch(`${serverUrl}/api/models`)
  if (!response.ok) throw new Error(`模型配置服务不可用（${response.status}）`)
  const result = await response.json()
  return result.data || []
}

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
  chatStore = new ChatStore(app.getPath('userData'))
  return chatStore.initialize()
}).then(() => {
  ipcMain.handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))
  ipcMain.handle('models:list', async () => (await loadModels()).map(({ api_key, endpoint, ...model }) => model))
  ipcMain.handle('conversations:list', () => chatStore.listConversations())
  ipcMain.handle('conversations:get', (_event, id) => chatStore.getConversation(id))
  ipcMain.handle('conversations:save', (_event, conversation) => chatStore.saveConversation(conversation))
  ipcMain.handle('conversations:delete', async (_event, id) => {
    clearConversation(id)
    await chatStore.deleteConversation(id)
  })
  ipcMain.handle('conversations:deleteAll', async () => {
    clearAllConversations()
    await chatStore.deleteAllConversations()
  })
  ipcMain.handle('conversations:openDirectory', async () => {
    const error = await shell.openPath(chatStore.root)
    if (error) throw new Error(`无法打开会话目录：${error}`)
  })
  ipcMain.handle('settings:get', () => chatStore.getSettings())
  ipcMain.handle('settings:update', (_event, patch) => chatStore.updateSettings(patch))
  ipcMain.on('chat:start', async (event, { requestId, conversationId, runtime, modelId, prompt, accessMode }) => {
    const controller = new AbortController()
    chatRequests.set(requestId, controller)
    const sessionKey = `${runtime}:${modelId}:${accessMode === 'full' ? 'full' : 'approval'}`
    const send = (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(`chat:event:${requestId}`, payload)
      const sessionId = payload.sessionId || payload.threadId
      if (payload.type === 'done' && sessionId) chatStore.saveSdkSession(conversationId, sessionKey, sessionId).catch(console.error)
    }
    const requestPermission = ({ toolName, input, suggestions, signal, ...details }) => new Promise((resolve) => {
      const permissionId = crypto.randomUUID()
      const finish = (result) => {
        permissionRequests.delete(permissionId)
        resolve(result)
      }
      permissionRequests.set(permissionId, { finish, input, suggestions, send, toolName, toolUseID: details.toolUseID })
      signal.addEventListener('abort', () => finish({ behavior: 'deny', message: '请求已取消' }), { once: true })
      send({ type: 'permission', permissionId, toolName, input, title: details.title, displayName: details.displayName, description: details.description, decisionReason: details.decisionReason })
    })
    try {
      const models = await loadModels()
      const provider = runtime === 'codex' ? 'openai' : 'anthropic'
      const model = models.find((item) => item.id === modelId && item.model_provider === provider)
      if (!model) throw new Error('未找到所选模型配置')
      const conversation = await chatStore.getConversation(conversationId)
      await runAgent({ conversationId, runtime, model, prompt, accessMode: accessMode === 'full' ? 'full' : 'approval', resumeId: conversation?.sdkSessions?.[sessionKey], cwd: process.cwd(), signal: controller.signal, controller, onEvent: send, requestPermission })
    } catch (error) {
      if (error.name !== 'AbortError') send({ type: 'error', message: error.message || '模型请求失败' })
    } finally {
      chatRequests.delete(requestId)
    }
  })
  ipcMain.on('chat:cancel', (_event, requestId) => chatRequests.get(requestId)?.abort())
  ipcMain.on('chat:permission', (_event, { permissionId, allowed }) => {
    const request = permissionRequests.get(permissionId)
    if (!request) return
    request.send({ type: 'activity', id: request.toolUseID || permissionId, label: `调用工具：${request.toolName}`, status: allowed ? 'in_progress' : 'failed', input: request.input, ...(allowed ? {} : { result: '用户拒绝了该工具调用' }) })
    request.finish(allowed
      ? { behavior: 'allow', updatedInput: request.input, updatedPermissions: request.suggestions, toolUseID: request.toolUseID }
      : { behavior: 'deny', message: '用户拒绝了该工具调用', toolUseID: request.toolUseID })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
