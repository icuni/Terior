const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('teriorDesktop', Object.freeze({
  isElectron: true,
  platform: process.platform,
  runBlenderMcpAction: action => ipcRenderer.invoke('terior:blender-mcp-run', action),
  answerBlenderMcpPrompt: (operationId, answer) => ipcRenderer.invoke('terior:blender-mcp-input', operationId, answer),
  stopBlenderMcpAction: operationId => ipcRenderer.invoke('terior:blender-mcp-stop', operationId),
  onBlenderMcpEvent: listener => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('terior:blender-mcp-event', wrapped)
    return () => ipcRenderer.removeListener('terior:blender-mcp-event', wrapped)
  },
}))
