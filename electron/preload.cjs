'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getModels: () => ipcRenderer.invoke('models:list'),
  respondPermission: (permissionId, allowed) => ipcRenderer.send('chat:permission', { permissionId, allowed }),
  streamChat: (payload, onEvent) => {
    const requestId = crypto.randomUUID()
    const channel = `chat:event:${requestId}`
    const listener = (_event, data) => onEvent(data)
    ipcRenderer.on(channel, listener)
    ipcRenderer.send('chat:start', { ...payload, requestId })
    return () => {
      ipcRenderer.removeListener(channel, listener)
      ipcRenderer.send('chat:cancel', requestId)
    }
  }
})
