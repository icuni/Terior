const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { app, BrowserWindow, ipcMain, session, shell } = require('electron')

let mainWindow
const developmentUrl = process.env.TERIOR_DEV_SERVER_URL
let activeBlenderProcess = null

const blenderMcpActions = Object.freeze({
  'install-uv': { title: 'Install uv', command: 'winget install --id=astral-sh.uv -e' },
  setup: { title: 'Install Blender MCP and add-on', command: 'uvx mcp-for-blender setup' },
  update: { title: 'Update Blender MCP and add-on', command: 'uvx mcp-for-blender@latest update' },
  'register-codex': { title: 'Register with Codex', command: 'codex mcp add blender --env DISABLE_TELEMETRY=true --env BLENDER_MCP_SAFE_MODE=1 -- uvx mcp-for-blender' },
  'register-claude': { title: 'Register with Claude Code', command: 'claude mcp add blender --scope user --env DISABLE_TELEMETRY=true --env BLENDER_MCP_SAFE_MODE=1 -- uvx mcp-for-blender' },
  'check-codex': { title: 'Check Codex MCP registration', command: 'codex mcp list' },
  'check-claude': { title: 'Check Claude Code MCP registration', command: 'claude mcp list' },
  'remove-codex': { title: 'Remove Blender MCP from Codex', command: 'codex mcp remove blender' },
  'remove-claude': { title: 'Remove Blender MCP from Claude Code', command: 'claude mcp remove blender --scope user' },
})

function safeProcessEnvironment() {
  const env = {}
  const allowed = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PSModulePath', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PUBLIC', 'TEMP', 'TMP']
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key]
  return env
}

function sendBlenderEvent(sender, payload) {
  if (!sender.isDestroyed()) sender.send('terior:blender-mcp-event', payload)
}

ipcMain.handle('terior:blender-mcp-run', (event, action) => {
  if (process.platform !== 'win32') throw new Error('The embedded PowerShell manager is available in the Windows Electron app.')
  const spec = blenderMcpActions[action]
  if (!spec) throw new Error('Choose a supported Blender MCP action.')
  if (activeBlenderProcess) throw new Error('A Blender MCP command is already running. Stop it before starting another.')

  const operationId = require('node:crypto').randomUUID()
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', spec.command], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: safeProcessEnvironment(),
  })
  activeBlenderProcess = { child, operationId, sender }
  const emitOutput = stream => stream.on('data', data => sendBlenderEvent(sender, { operationId, type: 'output', text: String(data).slice(-12000) }))
  emitOutput(child.stdout)
  emitOutput(child.stderr)
  child.on('error', error => {
    sendBlenderEvent(sender, { operationId, type: 'output', text: '\r\n' + error.message + '\r\n' })
    sendBlenderEvent(sender, { operationId, type: 'exit', exitCode: 1 })
    activeBlenderProcess = null
  })
  child.on('close', code => {
    sendBlenderEvent(sender, { operationId, type: 'exit', exitCode: code ?? 1 })
    if (activeBlenderProcess?.operationId === operationId) activeBlenderProcess = null
  })
  return { operationId, title: spec.title, command: spec.command }
})

ipcMain.handle('terior:blender-mcp-input', (event, operationId, answer) => {
  const active = activeBlenderProcess
  if (!active || active.operationId !== operationId || active.sender.id !== event.sender.id) throw new Error('There is no active Blender MCP setup prompt.')
  if (typeof answer !== 'string' || answer.length > 100 || !/^[0-9, yYnNoO]+$/.test(answer)) throw new Error('Use a number, a client selection list, or a yes/no answer for setup prompts.')
  active.child.stdin.write(answer + '\r\n')
})

ipcMain.handle('terior:blender-mcp-stop', (event, operationId) => {
  const active = activeBlenderProcess
  if (!active || active.operationId !== operationId || active.sender.id !== event.sender.id) return false
  active.child.kill()
  return true
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1620,
    height: 1020,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#dfe4e9',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  const initialUrl = developmentUrl || path.join(app.getAppPath(), 'dist', 'index.html')
  const packagedUrl = pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      const allowedHosts = new Set(['github.com', 'www.mcp-for-blender.com', 'www.blender.org'])
      if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) void shell.openExternal(url)
    } catch { /* Invalid external URL */ }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (developmentUrl) {
      try { if (new URL(destination).origin !== new URL(developmentUrl).origin) event.preventDefault() }
      catch { event.preventDefault() }
    } else if (destination !== packagedUrl) {
      event.preventDefault()
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (developmentUrl) void mainWindow.loadURL(initialUrl)
  else void mainWindow.loadFile(initialUrl)
  mainWindow.on('closed', () => {
    mainWindow = null
    if (activeBlenderProcess) activeBlenderProcess.child.kill()
    activeBlenderProcess = null
  })
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
