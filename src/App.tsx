import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import SceneCanvas, { type SceneCanvasApi } from './SceneCanvas'
import { freshScene, parseProject, storedScene } from './defaultScene'
import { roomExamples } from './examples'
import { modelLibrary } from './modelLibrary'
import type { BlenderBuild, CameraPose, LightingSettings, ModelLibraryItem, ProjectScene, ReferenceImage, SceneObject, SceneProposal, SceneTool } from './types'

type Proposal = SceneProposal & {
  lightingOptions?: Array<{ label: string; value: LightingSettings }>
}

interface TeriorFileHandle {
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: { types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<TeriorFileHandle[]>
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<TeriorFileHandle>
}

type BlenderClient = 'Codex' | 'Claude Code' | 'Other MCP client'
type BlenderMcpAction = 'install-uv' | 'setup' | 'update' | 'register-codex' | 'register-claude' | 'check-codex' | 'check-claude' | 'remove-codex' | 'remove-claude'

interface BlenderMcpEvent {
  operationId: string
  type: 'output' | 'exit'
  text?: string
  exitCode?: number
}

interface TeriorDesktopBridge {
  isElectron: boolean
  platform: string
  runBlenderMcpAction: (action: BlenderMcpAction) => Promise<{ operationId: string; title: string; command: string }>
  answerBlenderMcpPrompt: (operationId: string, answer: string) => Promise<void>
  stopBlenderMcpAction: (operationId: string) => Promise<boolean>
  onBlenderMcpEvent: (listener: (event: BlenderMcpEvent) => void) => () => void
}

declare global {
  interface Window { teriorDesktop?: TeriorDesktopBridge }
}

const materialOptions = ['Warm linen', 'Moss velvet', 'Oak and linen', 'Charcoal', 'Natural oak', 'Smoked oak', 'Brushed brass', 'Olive green']
const wallOptions = ['Limestone', 'Chalk', 'Soft sage', 'Blue grey']
const floorOptions = ['Smoked oak', 'Natural oak', 'Walnut', 'Concrete']

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const glyphs: Record<string, ReactNode> = {
    room: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5M9 21v-6h6v6"/></>,
    sofa: <><path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M4 11a2 2 0 0 0-2 2v4h20v-4a2 2 0 0 0-2-2M5 17v2m14-2v2M7.5 11h9"/></>,
    table: <><path d="M3 9h18v3H3zM5 12v8m14-8v8M7 9V6h10v3"/></>,
    lamp: <><path d="M8 3h8l2 7H6l2-7Zm4 7v10m-4 1h8"/><path d="M10 17h4"/></>,
    rug: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M7 6h10M7 10h10M7 14h10M7 18h10"/></>,
    plant: <><path d="M12 21v-8m0 2C7 15 5 12 5 8c4 0 7 2 7 7Zm0-3c0-4 2-7 7-8 0 4-1 8-7 10"/><path d="M9 21h6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    down: <><path d="m6 9 6 6 6-6"/></>,
    upRight: <><path d="M7 17 17 7M7 7h10v10"/></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
    folder: <><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M3 9h18"/></>,
    export: <><path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M5 13v7h14v-7"/></>,
    undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></>,
    redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
    unlock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.6-1.7m-3.6 8.7v3"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3 3.6M6.3 6.8C3.5 8.4 2 12 2 12s3.5 6 10 6c.8 0 1.6-.1 2.3-.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
    cursor: <><path d="m5 3 14 11-7 .7-3.7 6.3L5 3Z"/></>,
    move: <><path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m16-3-3-3m3 3-3 3"/></>,
    rotate: <><path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4m-4 5a8 8 0 0 0 14 5l2-2"/><path d="M20 20v-4h-4"/></>,
    measure: <><path d="m4 16 12-12 4 4L8 20H4z"/><path d="m13 7 4 4m-7-1 2 2m-5 1 2 2"/></>,
    cube: <><path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5m-9 5v8"/></>,
    light: <><path d="M9 18h6m-5 3h4m-2-19a7 7 0 0 0-4.3 12.5c.8.6 1.3 1.5 1.3 2.5h6c0-1 .5-1.9 1.3-2.5A7 7 0 0 0 12 2Z"/></>,
    camera: <><path d="M3 7h4l1.5-2h7L17 7h4v12H3z"/><circle cx="12" cy="13" r="3.5"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    warning: <><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>{glyphs[name] ?? glyphs.cube}</svg>
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1200)
}

function projectFilename(name: string, extension: string) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'terior-project'
  return `${safe}.${extension}`
}

function blenderMcpRegistration(client: BlenderClient) {
  const env = '--env DISABLE_TELEMETRY=true --env BLENDER_MCP_SAFE_MODE=1'
  if (client === 'Codex') return 'codex mcp add blender ' + env + ' -- uvx mcp-for-blender'
  if (client === 'Claude Code') return 'claude mcp add blender --scope user ' + env + ' -- uvx mcp-for-blender'
  return JSON.stringify({ mcpServers: { blender: { command: 'uvx', args: ['mcp-for-blender'], env: { DISABLE_TELEMETRY: 'true', BLENDER_MCP_SAFE_MODE: '1' } } } }, null, 2)
}

function stripTerminalControls(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f]/g, '')
}

function roomObject(project: ProjectScene): SceneObject {
  return { id: 'room', name: 'Room', kind: 'model', model: null, x: 0, z: 0, rotation: 0, width: project.room.width, depth: project.room.depth, height: project.room.height, material: project.room.wallMaterial, locked: false, visible: true }
}

function commandProposal(prompt: string, project: ProjectScene, selected: SceneObject | undefined): Proposal {
  const command = prompt.trim().toLowerCase()
  if (!command) throw new Error('Describe one change to preview.')
  if (command.includes('light') && (command.includes('option') || command.includes('show'))) {
    return {
      id: crypto.randomUUID(),
      baseRevision: project.revision,
      summary: 'Furniture and saved camera views stay fixed. Compare three lighting directions.',
      lightingOptions: [
        { label: 'Soft daylight', value: { daylight: 88, warmth: 5100, fill: 48 } },
        { label: 'Golden hour', value: { daylight: 63, warmth: 3300, fill: 36 } },
        { label: 'Evening glow', value: { daylight: 32, warmth: 2700, fill: 28 } },
      ],
    }
  }
  const cameraMatch = command.match(/(?:put|place|position|move|set)\s+(?:the\s+)?camera\s+(?:at|to)\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)?\s+(?:looking at|aim(?:ing)? at|target(?:ing)? at)\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:m|met(?:er|re)s?)/)
  if (cameraMatch) {
    const values = cameraMatch.slice(1).map(Number)
    if (values.some(value => Math.abs(value) > 100)) throw new Error('Camera coordinates must stay within 100 metres of the room origin.')
    const active = project.cameraViews.find(view => view.name === project.activeCamera) ?? project.cameraViews[0]
    const cameraPoseChange = { name: active.name, position: values.slice(0, 3) as [number, number, number], target: values.slice(3, 6) as [number, number, number] }
    return { id: crypto.randomUUID(), baseRevision: project.revision, summary: `Move ${active.name} to (${cameraPoseChange.position.map(value => value.toFixed(2)).join(', ')}) m and aim at (${cameraPoseChange.target.map(value => value.toFixed(2)).join(', ')}) m.`, cameraPoseChange }
  }
  const replaceMatch = command.match(/replace\s+(?:the\s+)?(.+?)\s+with\s+(.+?)(?:,|\s+preserving|\s+keeping|$)/)
  if (replaceMatch) {
    const targetName = replaceMatch[1].trim() === 'this table' || replaceMatch[1].trim() === 'this' ? selected?.name : replaceMatch[1].trim()
    const target = project.objects.find(object => object.name.toLowerCase().includes(targetName ?? ''))
    const replacement = modelLibrary.find(item => item.name.toLowerCase().includes(replaceMatch[2].trim()))
    if (!target) throw new Error('Select the object to replace, or name it in the instruction.')
    if (!replacement) throw new Error(`I could not find “${replaceMatch[2].trim()}” in the current object library.`)
    if (target.locked) throw new Error(`${target.name} is locked. Unlock it before proposing a replacement.`)
    const next = { ...target, name: replacement.name, model: replacement.model, kind: 'model' as const, width: replacement.width, depth: replacement.depth, height: replacement.height, material: replacement.material, estimated: replacement.estimated }
    return { id: crypto.randomUUID(), baseRevision: project.revision, summary: `Replace ${target.name} with ${replacement.name}. Its centre, position and rotation stay in place.`, objectChanges: [next] }
  }
  const moveMatch = command.match(/move\s+(?:the\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*(cm|centimet(?:er|re)s?|m|met(?:er|re)s?)\s+(away\s+from|toward|towards)\s+(?:the\s+)?(?:wall|centre|center)/)
  if (moveMatch) {
    const target = project.objects.find(object => object.name.toLowerCase().includes(moveMatch[1].trim()))
    if (!target) throw new Error(`I could not find “${moveMatch[1].trim()}” in this scene.`)
    if (target.locked) throw new Error(`${target.name} is locked. Unlock it before proposing a move.`)
    const amount = Number(moveMatch[2]) * (/^cm|centimet/.test(moveMatch[3]) ? .01 : 1)
    const direction = moveMatch[4].startsWith('away') ? 1 : -1
    const next = { ...target, z: target.z + amount * direction }
    return { id: crypto.randomUUID(), baseRevision: project.revision, summary: `Move ${target.name} ${Number((amount * 100).toFixed(1))} cm away from the back wall.`, objectChanges: [next] }
  }
  const rotateMatch = command.match(/rotate\s+(?:the\s+)?(.+?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:°|degrees?)/)
  if (rotateMatch) {
    const target = project.objects.find(object => object.name.toLowerCase().includes(rotateMatch[1].trim()))
    if (!target) throw new Error(`I could not find “${rotateMatch[1].trim()}” in this scene.`)
    if (target.locked) throw new Error(`${target.name} is locked. Unlock it before proposing a rotation.`)
    const next = { ...target, rotation: target.rotation + Number(rotateMatch[2]) }
    return { id: crypto.randomUUID(), baseRevision: project.revision, summary: `Rotate ${target.name} ${rotateMatch[2]}° around its centre.`, objectChanges: [next] }
  }
  throw new Error('Try “Move the sofa 30 cm away from the wall”, “Position the camera at 3, 2.5, 4 looking at 0, 1, 0”, or “Keep the furniture fixed and show three lighting options”.')
}

function NumberField({ label, value, step = .01, min = -.5, max = 100, disabled = false, unit = 'm', onCommit, onFocus, onBlur }: {
  label: string; value: number; step?: number; min?: number; max?: number; disabled?: boolean; unit?: string; onCommit: (value: number) => void; onFocus?: () => void; onBlur?: () => void
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(step < 1 ? 2 : 0))))
  useEffect(() => setDraft(String(Number(value.toFixed(step < 1 ? 2 : 0)))), [value, step])
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(String(Number(value.toFixed(2)))); return }
    const bounded = Math.min(max, Math.max(min, parsed))
    onCommit(bounded)
    setDraft(String(Number(bounded.toFixed(step < 1 ? 2 : 0))))
  }
  return <label className={`number-field${disabled ? ' is-disabled' : ''}`}>
    <span>{label}</span>
    <div className="number-input-wrap"><input type="number" min={min} max={max} step={step} value={draft} disabled={disabled} onFocus={onFocus} onChange={event => setDraft(event.target.value)} onBlur={() => { commit(); onBlur?.() }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /><em>{unit}</em></div>
  </label>
}

function SelectField({ label, value, choices, disabled, onChange }: { label: string; value: string; choices: string[]; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="select-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{choices.map(choice => <option key={choice}>{choice}</option>)}</select></label>
}

async function encodeReference(file: File, room: ProjectScene['room']): Promise<ReferenceImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image reference.')
  if (file.size > 24 * 1024 * 1024) throw new Error('This image is larger than the 24 MB import limit.')
  const bitmap = await createImageBitmap(file)
  if (bitmap.width * bitmap.height > 80_000_000) { bitmap.close(); throw new Error('This image has too many pixels to import safely.') }
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('This image could not be decoded.') }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let mimeType: ReferenceImage['mimeType'] = file.type as ReferenceImage['mimeType']
  let dataUrl = canvas.toDataURL(mimeType, .84)
  if (dataUrl.length > 1_350_000) {
    mimeType = 'image/jpeg'
    dataUrl = canvas.toDataURL(mimeType, .74)
  }
  mimeType = dataUrl.slice(5, dataUrl.indexOf(';')) as ReferenceImage['mimeType']
  if (dataUrl.length > 1_350_000) throw new Error('The compressed reference is still too large. Resize it before adding it to this project.')
  const aspect = canvas.width / canvas.height
  let width = Math.min(1.5, room.width * .34, 1.55 * aspect)
  let height = width / aspect
  if (height > 1.55) { height = 1.55; width = height * aspect }
  return {
    id: `reference-${crypto.randomUUID().slice(0, 10)}`,
    name: file.name || 'IDE chat image',
    mimeType,
    dataUrl,
    placement: { x: 0, y: Math.min(room.height * .55, room.height - height / 2 - .08), z: -room.depth / 2 + .14, width, height, rotation: 0, visible: true },
    note: 'Photographic reference plane · 2D image only. It does not contain or imply an editable 3D model.',
  }
}

function App() {
  const [project, setProject] = useState<ProjectScene>(() => storedScene())
  const projectRef = useRef(project)
  projectRef.current = project
  const [selectedId, setSelectedId] = useState('sofa-main')
  const [tool, setTool] = useState<SceneTool>('select')
  const [panel, setPanel] = useState<'object' | 'lighting' | 'camera' | 'references' | 'blender'>('object')
  const [saveState, setSaveState] = useState('Saved')
  const [showAdd, setShowAdd] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState('')
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportState, setExportState] = useState('')
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [lightingChoice, setLightingChoice] = useState(0)
  const [promptError, setPromptError] = useState('')
  const [openError, setOpenError] = useState('')
  const [canvasApi, setCanvasApi] = useState<SceneCanvasApi | null>(null)
  const cameraPoseRef = useRef<CameraPose | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const projectFileHandleRef = useRef<TeriorFileHandle | null>(null)
  const fileModifiedRef = useRef(0)
  const fileRevisionRef = useRef<number | null>(null)
  const fileTextRef = useRef('')
  const fileWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [liveCamera, setLiveCamera] = useState<CameraPose | null>(null)
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null)
  const undoStack = useRef<ProjectScene[]>([])
  const redoStack = useRef<ProjectScene[]>([])
  const gestureSnapshot = useRef<ProjectScene | null>(null)
  const numericSnapshot = useRef<ProjectScene | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [blenderClient, setBlenderClient] = useState<BlenderClient>('Codex')
  const [blenderTerminal, setBlenderTerminal] = useState('Terior Blender MCP console\r\nSelect an action to install, register, update, or inspect Blender MCP.\r\n')
  const [blenderTerminalStatus, setBlenderTerminalStatus] = useState('Ready')
  const [blenderTerminalInput, setBlenderTerminalInput] = useState('')
  const [blenderOperation, setBlenderOperation] = useState<{ operationId: string; title: string } | null>(null)
  const blenderTerminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bridge = window.teriorDesktop
    if (!bridge?.isElectron) return
    return bridge.onBlenderMcpEvent(event => {
      if (event.type === 'output') {
        const clean = stripTerminalControls(event.text ?? '')
        setBlenderTerminal(current => (current + clean).slice(-24000))
      } else {
        setBlenderOperation(current => current?.operationId === event.operationId ? null : current)
        setBlenderTerminalStatus(event.exitCode === 0 ? 'Completed' : 'Exited with an error')
        setBlenderTerminal(current => current + '\r\nProcess finished with exit code ' + String(event.exitCode ?? 1) + '.\r\n')
      }
    })
  }, [])

  useEffect(() => {
    const terminal = blenderTerminalRef.current
    if (terminal) terminal.scrollTop = terminal.scrollHeight
  }, [blenderTerminal])

  const selected = useMemo(() => selectedId === 'room' ? roomObject(project) : project.objects.find(object => object.id === selectedId), [project, selectedId])

  const transact = useCallback((update: (current: ProjectScene) => ProjectScene, history = true) => {
    const current = projectRef.current
    const next = update(current)
    if (next === current) return
    if (history) {
      undoStack.current = [...undoStack.current.slice(-39), structuredClone(current)]
      redoStack.current = []
      setCanUndo(true); setCanRedo(false)
    }
    const revised = { ...next, revision: current.revision + 1 }
    projectRef.current = revised
    setProject(revised)
    setProposal(old => old ? { ...old } : old)
  }, [])

  const updateProjectMetadata = (update: (current: ProjectScene) => ProjectScene) => {
    const current = projectRef.current
    const next = update(current)
    if (next === current) return
    projectRef.current = next
    setProject(next)
  }

  const updateObject = useCallback((id: string, patch: Partial<SceneObject>, history = true) => {
    transact(current => ({ ...current, objects: current.objects.map(object => object.id === id ? { ...object, ...patch } : object) }), history)
  }, [transact])

  useEffect(() => {
    setSaveState('Saving')
    const timeout = window.setTimeout(() => {
      const serialized = JSON.stringify(project, null, 2)
      try { localStorage.setItem('terior-project-v1', serialized) }
      catch { if (!projectFileHandleRef.current) { setSaveState('Local save unavailable'); return } }
      const handle = projectFileHandleRef.current
      if (!handle) { setSaveState('Saved on this device'); return }
      fileWriteQueueRef.current = fileWriteQueueRef.current.then(async () => {
        try {
          const file = await handle.getFile()
          const diskText = await file.text()
          const disk = parseProject(JSON.parse(diskText))
          if (fileRevisionRef.current !== null && disk.revision !== fileRevisionRef.current) {
            setSaveState('File changed in IDE')
            return
          }
          const writable = await handle.createWritable()
          await writable.write(serialized)
          await writable.close()
          fileRevisionRef.current = project.revision
          fileTextRef.current = serialized
          fileModifiedRef.current = (await handle.getFile()).lastModified
          setSaveState('Saved to project file')
        } catch {
          setSaveState('Project file unavailable')
        }
      })
    }, 320)
    return () => window.clearTimeout(timeout)
  }, [project])

  useEffect(() => {
    const handle = projectFileHandleRef.current
    if (!handle) return
    let stopped = false
    const checkForExternalEdit = async () => {
      try {
        const file = await handle.getFile()
        if (file.lastModified <= fileModifiedRef.current) return
        const text = await file.text()
        if (text === fileTextRef.current) { fileModifiedRef.current = file.lastModified; return }
        const incoming = parseProject(JSON.parse(text))
        if (projectRef.current.revision !== fileRevisionRef.current) {
          setSaveState('Scene changed in two places')
          fileModifiedRef.current = file.lastModified
          setOpenError('The IDE and Terior both changed this project. Your current editor scene is preserved; save a copy or reopen the latest project to resolve the revision conflict.')
          return
        }
        if (incoming.revision < projectRef.current.revision) {
          setSaveState('Older project file ignored')
          fileModifiedRef.current = file.lastModified
          return
        }
        if (incoming.revision > projectRef.current.revision) {
          undoStack.current = [...undoStack.current.slice(-39), structuredClone(projectRef.current)]
          redoStack.current = []
          setCanUndo(true); setCanRedo(false)
        }
        projectRef.current = incoming
        setProject(incoming)
        setProposal(incoming.pendingProposal ? { ...incoming.pendingProposal } : null)
        if (!incoming.objects.some(object => object.id === selectedId)) setSelectedId(incoming.objects[0]?.id ?? 'room')
        fileRevisionRef.current = incoming.revision
        fileTextRef.current = text
        fileModifiedRef.current = file.lastModified
        setSaveState(incoming.pendingProposal ? 'IDE proposal ready' : 'Updated from IDE')
      } catch {
        if (!stopped) setSaveState('Could not read IDE update')
      }
    }
    const interval = window.setInterval(() => { if (!stopped) void checkForExternalEdit() }, 800)
    return () => { stopped = true; window.clearInterval(interval) }
  }, [projectFileHandleRef.current, selectedId])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void saveProject()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo()
      }
      if (event.key === 'Escape') { setShowAdd(false); setShowFileMenu(false); setShowExportMenu(false); dismissProposal(); setShowExamples(false) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const restore = (snapshot: ProjectScene) => {
    const next = {
      ...structuredClone(snapshot),
      blenderBuilds: structuredClone(projectRef.current.blenderBuilds),
      revision: projectRef.current.revision + 1,
    }
    projectRef.current = next; setProject(next)
  }

  function undo() {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(structuredClone(projectRef.current))
    setCanUndo(undoStack.current.length > 0); setCanRedo(true)
    restore(previous)
  }

  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(structuredClone(projectRef.current))
    setCanUndo(true); setCanRedo(redoStack.current.length > 0)
    restore(next)
  }

  const saveProject = async () => {
    let handle = projectFileHandleRef.current
    const picker = window as FilePickerWindow
    if (!handle && picker.showSaveFilePicker) {
      try {
        handle = await picker.showSaveFilePicker({ suggestedName: projectFilename(projectRef.current.projectName, 'terior'), types: [{ description: 'Terior project', accept: { 'application/json': ['.terior'] } }] })
        projectFileHandleRef.current = handle
      } catch { return }
    }
    const serialized = JSON.stringify(projectRef.current, null, 2)
    if (handle) {
      try {
        if (fileRevisionRef.current !== null) {
          const disk = parseProject(JSON.parse(await (await handle.getFile()).text()))
          if (disk.revision !== fileRevisionRef.current) {
            setSaveState('File changed in IDE')
            setOpenError('The project file changed outside Terior. Reopen the latest file before saving so newer edits are not overwritten.')
            return
          }
        }
        const writable = await handle.createWritable()
        await writable.write(serialized)
        await writable.close()
        fileRevisionRef.current = projectRef.current.revision
        fileTextRef.current = serialized
        fileModifiedRef.current = (await handle.getFile()).lastModified
        setSaveState('Saved to project file')
      } catch {
        setSaveState('Project file unavailable')
      }
    } else {
      download(new Blob([serialized], { type: 'application/json' }), projectFilename(projectRef.current.projectName, 'terior'))
      setSaveState('Project downloaded')
    }
    setShowFileMenu(false)
  }

  const openProject = async (file?: File, handle?: TeriorFileHandle) => {
    if (!file) return
    try {
      const serialized = await file.text()
      const next = parseProject(JSON.parse(serialized))
      undoStack.current = []; redoStack.current = []; setCanUndo(false); setCanRedo(false)
      const restored = { ...next }
      projectFileHandleRef.current = handle ?? null
      fileRevisionRef.current = next.revision
      fileTextRef.current = serialized
      fileModifiedRef.current = file.lastModified
      projectRef.current = restored; setProject(restored); setSelectedId('sofa-main'); setOpenError('')
      setProposal(next.pendingProposal ? { ...next.pendingProposal } : null)
      setShowFileMenu(false)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'This project could not be opened.')
    }
  }

  const runBlenderMcpAction = async (action: BlenderMcpAction, title: string) => {
    const bridge = window.teriorDesktop
    if (!bridge?.isElectron || bridge.platform !== 'win32') {
      setBlenderTerminalStatus('Desktop required')
      setBlenderTerminal(current => current + '\r\nThe local command manager is available in the Windows Electron app.\r\n')
      return
    }
    if (blenderOperation) return
    setBlenderTerminal(current => current + '\r\n> ' + title + '\r\n')
    setBlenderTerminalStatus('Starting')
    try {
      const result = await bridge.runBlenderMcpAction(action)
      setBlenderOperation({ operationId: result.operationId, title: result.title })
      setBlenderTerminal(current => current + 'PS Terior> ' + result.command + '\r\n')
      setBlenderTerminalStatus('Running')
    } catch (error) {
      setBlenderTerminalStatus('Could not start')
      setBlenderTerminal(current => current + String(error instanceof Error ? error.message : error) + '\r\n')
    }
  }

  const sendBlenderPromptAnswer = async () => {
    const bridge = window.teriorDesktop
    const operation = blenderOperation
    const answer = blenderTerminalInput.trim()
    if (!bridge || !operation || !answer) return
    try {
      await bridge.answerBlenderMcpPrompt(operation.operationId, answer)
      setBlenderTerminal(current => current + '> ' + answer + '\r\n')
      setBlenderTerminalInput('')
    } catch (error) {
      setBlenderTerminal(current => current + String(error instanceof Error ? error.message : error) + '\r\n')
    }
  }

  const stopBlenderMcpAction = async () => {
    const bridge = window.teriorDesktop
    if (!bridge || !blenderOperation) return
    await bridge.stopBlenderMcpAction(blenderOperation.operationId)
    setBlenderTerminalStatus('Stopping')
  }

  const copyBlenderText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setBlenderTerminalStatus(label + ' copied')
    } catch {
      setBlenderTerminalStatus('Clipboard unavailable')
      setBlenderTerminal(current => current + '\r\nCould not access the clipboard. Select and copy the command manually.\r\n')
    }
  }

  const requestOpenProject = async () => {
    const picker = window as FilePickerWindow
    if (picker.showOpenFilePicker) {
      try {
        const [handle] = await picker.showOpenFilePicker({ types: [{ description: 'Terior project', accept: { 'application/json': ['.terior', '.json'] } }] })
        if (handle) await openProject(await handle.getFile(), handle)
        return
      } catch { return }
    }
    fileInputRef.current?.click()
  }

  const exportPng = async () => {
    if (!canvasApi) return
    setExportState('Preparing PNG…')
    try { download(await canvasApi.exportPng(), projectFilename(project.projectName, 'png')); setExportState('PNG ready') }
    catch (error) { setExportState(error instanceof Error ? error.message : 'PNG export failed') }
  }

  const exportGlb = async () => {
    if (!canvasApi) return false
    setExportState('Preparing GLB…')
    try { download(await canvasApi.exportGlb(), projectFilename(project.projectName, 'glb')); setExportState('GLB ready'); return true }
    catch (error) { setExportState(error instanceof Error ? error.message : 'GLB export failed'); return false }
  }

  const prepareBlenderBuild = async () => {
    const scene = projectRef.current
    const ready = await exportGlb()
    if (!ready) return
    const ordinal = scene.blenderBuilds.length + 1
    const build: BlenderBuild = {
      id: crypto.randomUUID(),
      name: scene.projectName + ' · Blender build ' + ordinal,
      sourceRevision: scene.revision,
      createdAt: new Date().toISOString(),
      status: 'prepared',
      glbFilename: projectFilename(scene.projectName, 'glb'),
    }
    updateProjectMetadata(current => ({ ...current, blenderBuilds: [build, ...current.blenderBuilds].slice(0, 30) }))
    setExportState('Blender handoff r' + scene.revision + ' prepared')
  }

  const updateBlenderBuild = (id: string, patch: Partial<BlenderBuild>) => {
    updateProjectMetadata(current => ({ ...current, blenderBuilds: current.blenderBuilds.map(build => build.id === id ? { ...build, ...patch } : build) }))
  }

  const removeBlenderBuild = (id: string) => {
    updateProjectMetadata(current => ({ ...current, blenderBuilds: current.blenderBuilds.filter(build => build.id !== id) }))
  }

  const addItem = (item: ModelLibraryItem) => {
    const sameName = projectRef.current.objects.filter(object => object.model === item.model).length
    const id = `${item.model}-${crypto.randomUUID().slice(0, 8)}`
    const next: SceneObject = { id, name: sameName ? `${item.name} ${sameName + 1}` : item.name, model: item.model, kind: 'model', x: 0, z: .2 + sameName * .12, rotation: 0, width: item.width, depth: item.depth, height: item.height, material: item.material, locked: false, dimensionsLocked: false, visible: true, estimated: item.estimated }
    transact(current => ({ ...current, objects: [...current.objects, next] }))
    setSelectedId(id); setPanel('object'); setShowAdd(false); setLibraryFilter('')
  }

  const addReferenceFile = async (file?: File) => {
    if (!file) return
    try {
      const current = projectRef.current
      if (current.references.length >= 5) throw new Error('A project can hold up to five image references.')
      const reference = await encodeReference(file, current.room)
      const totalBytes = current.references.reduce((sum, item) => sum + item.dataUrl.length, 0) + reference.dataUrl.length
      if (totalBytes > 3_800_000) throw new Error('This project has reached its 3.8 MB image-reference limit. Remove a reference or use smaller images.')
      transact(scene => ({ ...scene, references: [...scene.references, reference] }))
      setSelectedReferenceId(reference.id)
      setPanel('references')
      setOpenError('')
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'This image could not be added.')
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const pasted = [...event.clipboardData.items].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (!pasted) return
    event.preventDefault()
    void addReferenceFile(new File([pasted], 'IDE-chat-reference.png', { type: pasted.type || 'image/png' }))
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    for (const file of [...event.dataTransfer.files]) void addReferenceFile(file)
  }

  const previewInstruction = () => {
    try {
      const next = commandProposal(prompt, projectRef.current, selected)
      setProposal(next); setLightingChoice(0); setPromptError(''); setPreviewMode(true)
    } catch (error) {
      setProposal(null); setPromptError(error instanceof Error ? error.message : 'That change could not be previewed.')
    }
  }

  const applyProposal = () => {
    if (!proposal) return
    if (proposal.baseRevision !== projectRef.current.revision) {
      setPromptError('The scene changed while this preview was open. Preview the instruction again to keep your newer edits.');
      setProposal(null); return
    }
    const selectedLighting = proposal.lightingOptions?.[lightingChoice]?.value
    const lightingChange = selectedLighting ?? proposal.lightingChange
    transact(current => ({
      ...current,
      objects: proposal.objectChanges ? current.objects.map(object => proposal.objectChanges!.find(change => change.id === object.id) ?? object) : current.objects,
      lighting: lightingChange ?? current.lighting,
      cameraViews: proposal.cameraPoseChange ? current.cameraViews.map(view => view.name === current.activeCamera ? { ...proposal.cameraPoseChange!, name: view.name } : view) : current.cameraViews,
      references: proposal.referenceAddition ? [...current.references, proposal.referenceAddition] : current.references,
      pendingProposal: undefined,
    }))
    if (proposal.cameraPoseChange) {
      const cameraPose = { ...proposal.cameraPoseChange, name: projectRef.current.activeCamera }
      cameraPoseRef.current = cameraPose
      setLiveCamera(cameraPose)
      canvasApi?.setCameraPose(cameraPose)
    }
    if (proposal.referenceAddition) setSelectedReferenceId(proposal.referenceAddition.id)
    setPrompt(''); setProposal(null); setPromptError(''); setPreviewMode(false)
  }

  const dismissProposal = () => {
    if (projectRef.current.pendingProposal) {
      const next = { ...projectRef.current, pendingProposal: undefined }
      projectRef.current = next
      setProject(next)
    }
    setProposal(null); setPreviewMode(false)
  }

  const saveCamera = () => {
    const pose = cameraPoseRef.current ?? canvasApi?.getCameraPose()
    if (!pose) return
    const named = { ...pose, name: projectRef.current.activeCamera }
    transact(current => ({ ...current, cameraViews: current.cameraViews.map(view => view.name === current.activeCamera ? named : view) }))
  }

  const saveCameraAs = () => {
    const pose = cameraPoseRef.current ?? canvasApi?.getCameraPose()
    if (!pose) return
    const base = `Camera ${projectRef.current.cameraViews.length + 1}`
    const name = projectRef.current.cameraViews.some(view => view.name === base) ? `Camera ${projectRef.current.cameraViews.length + 2}` : base
    const next = { ...pose, name }
    transact(current => ({ ...current, cameraViews: [...current.cameraViews, next], activeCamera: name }))
    setLiveCamera(next); cameraPoseRef.current = next; canvasApi?.setCameraPose(next); setPanel('camera')
  }

  const activeCamera = project.cameraViews.find(view => view.name === project.activeCamera) ?? project.cameraViews[0]
  const currentCamera = liveCamera?.name === project.activeCamera ? liveCamera : activeCamera
  const editCamera = (patch: Partial<Omit<CameraPose, 'name'>>) => {
    if (!currentCamera) return
    const next: CameraPose = { ...currentCamera, ...patch, name: projectRef.current.activeCamera }
    cameraPoseRef.current = next
    setLiveCamera(next)
    canvasApi?.setCameraPose(next)
    transact(current => ({ ...current, cameraViews: current.cameraViews.map(view => view.name === current.activeCamera ? next : view) }))
  }

  const renameActiveCamera = (name: string) => {
    const clean = name.trim()
    if (!clean) { setOpenError('A camera view needs a name.'); return }
    if (clean === projectRef.current.activeCamera) return
    if (projectRef.current.cameraViews.some(view => view.name === clean)) { setOpenError('Each saved camera needs a unique name.'); return }
    const prior = projectRef.current.activeCamera
    transact(current => ({ ...current, activeCamera: clean, cameraViews: current.cameraViews.map(view => view.name === prior ? { ...view, name: clean } : view) }))
    setLiveCamera(pose => pose ? { ...pose, name: clean } : pose)
  }

  const activateCamera = (name: string) => {
    const camera = projectRef.current.cameraViews.find(view => view.name === name)
    if (!camera) return
    cameraPoseRef.current = { ...camera }
    setLiveCamera({ ...camera })
    transact(current => ({ ...current, activeCamera: name }))
    setTool('select')
  }

  const removeCamera = (name: string) => {
    if (projectRef.current.cameraViews.length < 2) return
    const views = projectRef.current.cameraViews.filter(view => view.name !== name)
    const next = name === projectRef.current.activeCamera ? views[0] : projectRef.current.cameraViews.find(view => view.name === projectRef.current.activeCamera)!
    transact(current => ({ ...current, cameraViews: views, activeCamera: next.name }))
    if (name === project.activeCamera) { cameraPoseRef.current = { ...next }; setLiveCamera({ ...next }); canvasApi?.setCameraPose(next) }
  }

  const updateReference = (id: string, patch: Partial<ReferenceImage['placement']>) => transact(current => ({ ...current, references: current.references.map(reference => reference.id === id ? { ...reference, placement: { ...reference.placement, ...patch } } : reference) }))
  const removeReference = (id: string) => {
    transact(current => ({ ...current, references: current.references.filter(reference => reference.id !== id) }))
    if (selectedReferenceId === id) setSelectedReferenceId(project.references.find(reference => reference.id !== id)?.id ?? null)
  }

  const openExample = (exampleId: string) => {
    const example = roomExamples.find(item => item.id === exampleId)
    if (!example) return
    const next = example.create()
    transact(() => next)
    setSelectedId(next.objects[0]?.id ?? 'room')
    setSelectedReferenceId(null)
    setPanel('object')
    setProposal(null); setPromptError(''); setShowExamples(false)
  }

  const updateCameraCoordinate = (key: 'position' | 'target', index: number, value: number) => {
    if (!currentCamera) return
    const vector = [...currentCamera[key]] as [number, number, number]
    vector[index] = value
    editCamera({ [key]: vector })
  }

  const updateRoom = (patch: Partial<ProjectScene['room']>) => transact(current => ({ ...current, room: { ...current.room, ...patch } }))
  const updateLighting = (patch: Partial<LightingSettings>) => transact(current => ({ ...current, lighting: { ...current.lighting, ...patch } }))
  const materialName = (id: string) => project.objects.find(object => object.id === id)?.material ?? ''
  const filteredLibrary = modelLibrary.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(libraryFilter.toLowerCase()))

  const selectedObject = selectedId === 'room' ? undefined : project.objects.find(object => object.id === selectedId)
  const selectedReference = project.references.find(reference => reference.id === selectedReferenceId) ?? project.references[0]
  const isWindowsElectron = Boolean(window.teriorDesktop?.isElectron && window.teriorDesktop.platform === 'win32')
  const extentWarning = selectedObject && (Math.abs(selectedObject.x) + selectedObject.width / 2 > project.room.width / 2 || Math.abs(selectedObject.z) + selectedObject.depth / 2 > project.room.depth / 2)
  const collisions = selectedObject && selectedObject.kind !== 'rug' ? project.objects.filter(other => other.id !== selectedObject.id && other.kind !== 'rug' && other.visible && Math.abs(other.x - selectedObject.x) < (other.width + selectedObject.width) * .47 && Math.abs(other.z - selectedObject.z) < (other.depth + selectedObject.depth) * .47) : []

  const beginNumericEdit = () => { numericSnapshot.current = structuredClone(projectRef.current) }
  const endNumericEdit = () => {
    const start = numericSnapshot.current
    numericSnapshot.current = null
    if (start && JSON.stringify(start) !== JSON.stringify(projectRef.current)) {
      undoStack.current = [...undoStack.current.slice(-39), start]
      redoStack.current = []; setCanUndo(true); setCanRedo(false)
    }
  }

  const tools: Array<{ id: SceneTool; label: string; icon: string }> = [
    { id: 'select', label: 'Select', icon: 'cursor' },
    { id: 'move', label: 'Move', icon: 'move' },
    { id: 'rotate', label: 'Rotate', icon: 'rotate' },
    { id: 'measure', label: 'Measure', icon: 'measure' },
    { id: 'view', label: 'View', icon: 'cube' },
  ]

  const selectTool = (id: SceneTool) => {
    if (id === 'view') { setShowFileMenu(false); setTool('view'); setPanel('lighting'); return }
    setTool(id)
  }

  return <main className="terior-app" onPaste={onPaste} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }} onDrop={onDrop}>
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true"><span/><span/><span/></div>
      <span className="brand-name">Terior</span>
      <span className="top-divider"/>
      <div className="project-menu-wrap">
        <button className="project-name" onClick={() => { setShowFileMenu(value => !value); setShowExportMenu(false) }} aria-expanded={showFileMenu}>{project.projectName}<Icon name="down" size={16}/></button>
        {showFileMenu && <div className="menu-dropdown file-dropdown">
          <button onClick={() => { void saveProject() }}><Icon name="save"/>Save project <kbd>Ctrl S</kbd></button>
          <button onClick={() => { void requestOpenProject(); setShowFileMenu(false) }}><Icon name="folder"/>Open project</button>
          <button onClick={() => { setShowExamples(true); setShowFileMenu(false) }}><Icon name="room"/>Open an example</button>
          <span className="menu-rule"/>
          <button onClick={() => { transact(() => freshScene()); setSelectedId('sofa-main'); setSelectedReferenceId(null); setProposal(null); setShowFileMenu(false) }}><Icon name="plus"/>New room</button>
        </div>}
      </div>
      <input ref={fileInputRef} className="hidden-input" type="file" accept=".terior,.json,application/json" onChange={event => { void openProject(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <input ref={referenceInputRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void addReferenceFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <div className="topbar-spacer"/>
      <div className="save-status"><span className={`save-dot ${saveState === 'Saving' ? 'saving' : ''}`}/>{saveState}</div>
      <div className="top-divider small-divider"/>
      <button className="icon-button dark" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo"/></button>
      <button className="icon-button dark" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo"/></button>
      <div className="top-divider small-divider"/>
      <div className="export-menu-wrap">
        <button className="export-button" onClick={() => { setShowExportMenu(value => !value); setShowFileMenu(false) }}><Icon name="export" size={17}/>Export<Icon name="down" size={14}/></button>
        {showExportMenu && <div className="menu-dropdown export-dropdown">
          <button onClick={() => { void exportPng(); setShowExportMenu(false) }}>PNG render<span>Current camera view</span></button>
          <button onClick={() => { void exportGlb(); setShowExportMenu(false) }}>GLB scene<span>Room and visible objects</span></button>
          <button onClick={() => { void saveProject(); setShowExportMenu(false) }}>Native project<span>Editable .terior file</span></button>
        </div>}
      </div>
    </header>

    <div className="workspace">
      <aside className="scene-panel">
        <div className="panel-heading scene-heading"><h1>Scene</h1><div className="scene-heading-actions"><button className="panel-add" onClick={() => referenceInputRef.current?.click()} aria-label="Add photo reference" title="Add a reference photo"><Icon name="image" size={17}/></button><button className="panel-add" onClick={() => { setShowAdd(value => !value); setShowFileMenu(false) }} aria-label="Add object" title="Add object"><Icon name="plus" size={18}/></button></div></div>
        {showAdd && <div className="library-popover">
          <div className="library-title"><strong>Add to scene</strong><button className="plain-icon" aria-label="Close object library" onClick={() => setShowAdd(false)}><Icon name="close" size={16}/></button></div>
          <input autoFocus className="library-search" placeholder="Find an object" value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)} />
          <div className="library-list">{filteredLibrary.map(item => <button className="library-item" key={item.model} onClick={() => addItem(item)}>
            {item.preview && <img src={item.preview} alt="" loading="lazy"/>}<span><strong>{item.name}</strong><small>{item.category}</small></span><Icon name="plus" size={15}/>
          </button>)}</div>
        </div>}
        <div className="scene-tree">
          <button className={`scene-row room-row${selectedId === 'room' ? ' selected' : ''}`} onClick={() => { setSelectedId('room'); setPanel('object') }}>
            <span className="tree-icon"><Icon name="room"/></span><span className="scene-label">Room</span><span className="scene-subline">{project.room.width.toFixed(1)} × {project.room.depth.toFixed(1)} m</span>
          </button>
          <div className="tree-rule"/>
          {project.objects.map(object => <div className={`scene-row-wrap${selectedId === object.id ? ' selected' : ''}`} key={object.id}>
            <button className="scene-row" onClick={() => { setSelectedId(object.id); setPanel('object') }}>
              <span className="tree-icon"><Icon name={object.kind === 'rug' ? 'rug' : object.name.toLowerCase().includes('sofa') || object.name.toLowerCase().includes('chair') ? 'sofa' : object.name.toLowerCase().includes('table') || object.name.toLowerCase().includes('desk') ? 'table' : object.name.toLowerCase().includes('lamp') ? 'lamp' : object.name.toLowerCase().includes('plant') || object.name.toLowerCase().includes('tree') ? 'plant' : 'cube'}/></span>
              <span className="scene-label">{object.name}</span>
            </button>
            <button className="row-visibility" aria-label={`${object.visible ? 'Hide' : 'Show'} ${object.name}`} title={object.visible ? 'Hide object' : 'Show object'} onClick={() => updateObject(object.id, { visible: !object.visible })}><Icon name={object.visible ? 'eye' : 'eyeOff'} size={15}/></button>
          </div>)}
          {project.references.length > 0 && <>
            <div className="tree-rule"/><div className="scene-section-label">Photo references</div>
            {project.references.map(reference => <div className={`scene-row-wrap reference-row${selectedReference?.id === reference.id && panel === 'references' ? ' selected' : ''}`} key={reference.id}>
              <button className="scene-row" onClick={() => { setSelectedReferenceId(reference.id); setPanel('references') }}><img src={reference.dataUrl} alt=""/><span className="scene-label">{reference.name}</span></button>
              <button className="row-visibility" aria-label={`${reference.placement.visible ? 'Hide' : 'Show'} reference plane`} title={reference.placement.visible ? 'Hide reference plane' : 'Show reference plane'} onClick={() => updateReference(reference.id, { visible: !reference.placement.visible })}><Icon name={reference.placement.visible ? 'eye' : 'eyeOff'} size={15}/></button>
            </div>)}
          </>}
        </div>
        <div className="scene-panel-bottom"><div className="asset-source"><span className="source-mark">T</span><span><strong>Terior</strong><small>scene editor</small></span><span className="local-pill">Local</span></div></div>
      </aside>

      <section className="studio-center">
        <div className="canvas-topline">
          <div className="canvas-breadcrumb"><span>Living room</span><Icon name="chevron" size={14}/><strong>{selected?.name ?? 'Scene'}</strong></div>
          <div className="canvas-top-actions"><span className="unit-label">METRES</span><button className="view-save" onClick={saveCamera} title="Save this camera view"><Icon name="camera" size={15}/>Save view</button></div>
        </div>
        <div className="canvas-shell">
          <SceneCanvas
            project={project}
            selectedId={selectedId}
            tool={tool}
            onSelect={id => { setSelectedId(id); setPanel('object') }}
            onTransformStart={() => { gestureSnapshot.current = structuredClone(projectRef.current) }}
            onTransform={(id, value) => updateObject(id, value, false)}
            onTransformEnd={() => { const start = gestureSnapshot.current; gestureSnapshot.current = null; if (start && JSON.stringify(start) !== JSON.stringify(projectRef.current)) { undoStack.current = [...undoStack.current.slice(-39), start]; redoStack.current = []; setCanUndo(true); setCanRedo(false) } }}
            onCameraMove={pose => { cameraPoseRef.current = pose; setLiveCamera(pose) }}
            onReady={setCanvasApi}
          />
          <div className="canvas-toolbar" role="toolbar" aria-label="Scene tools">
            {tools.map(item => <button key={item.id} className={`tool-button${tool === item.id ? ' active' : ''}`} aria-pressed={tool === item.id} onClick={() => selectTool(item.id)}><Icon name={item.icon} size={20}/><span>{item.label}</span></button>)}
          </div>
          {tool === 'measure' && <div className="measure-hint"><Icon name="measure" size={16}/><span>Dimensions are shown in the selected object's inspector.</span><button onClick={() => setTool('select')} aria-label="Close measurement tip"><Icon name="close" size={14}/></button></div>}
          {tool === 'view' && <div className="view-hint"><Icon name="cube" size={16}/><span>Drag to orbit · scroll to zoom · right-drag to pan</span><button onClick={() => setTool('select')} aria-label="Close view help"><Icon name="close" size={14}/></button></div>}
          <div className="scale-indicator"><span className="scale-line"/><span>1 m</span></div>
          <div className="canvas-room-label"><span className="live-dot"/>Editable scene</div>
        </div>
      </section>

      <aside className="inspector-panel">
        <div className="inspector-titlebar"><div><h2>{panel === 'camera' ? 'Camera' : panel === 'references' ? selectedReference?.name ?? 'Photo references' : panel === 'blender' ? 'Blender MCP' : selected?.name ?? 'Scene'}</h2>{panel === 'references' && selectedReference && <small>2D photographic reference</small>}{panel === 'object' && selectedObject?.estimated && <small>Approximate model</small>}</div>{panel === 'object' && selectedObject && <button className={`lock-toggle${selectedObject.locked ? ' locked' : ''}`} aria-label={selectedObject.locked ? 'Unlock object' : 'Lock object'} title={selectedObject.locked ? 'Unlock object' : 'Lock object'} onClick={() => updateObject(selectedObject.id, { locked: !selectedObject.locked })}><Icon name={selectedObject.locked ? 'lock' : 'unlock'} size={17}/></button>}</div>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
          <button role="tab" aria-selected={panel === 'object'} className={panel === 'object' ? 'active' : ''} onClick={() => setPanel('object')}><Icon name="cube" size={15}/>Object</button>
          <button role="tab" aria-selected={panel === 'lighting'} className={panel === 'lighting' ? 'active' : ''} onClick={() => setPanel('lighting')}><Icon name="light" size={15}/>Lighting</button>
          <button role="tab" aria-selected={panel === 'camera'} className={panel === 'camera' ? 'active' : ''} onClick={() => setPanel('camera')}><Icon name="camera" size={15}/>Camera</button>
          <button role="tab" aria-selected={panel === 'references'} className={panel === 'references' ? 'active' : ''} onClick={() => setPanel('references')}><Icon name="image" size={15}/>Refs</button>
          <button role="tab" aria-selected={panel === 'blender'} className={panel === 'blender' ? 'active' : ''} onClick={() => setPanel('blender')}><Icon name="cube" size={15}/>Blender</button>
        </div>
        <div className="inspector-scroll">
          {panel === 'camera' ? currentCamera ? <>
            <div className="section-heading"><h3>Active view</h3><span>editable</span></div>
            <label className="camera-name-field"><span>View name</span><input key={currentCamera.name} defaultValue={currentCamera.name} maxLength={32} onBlur={event => renameActiveCamera(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label>
            <div className="section-heading camera-fields-heading"><h3>Camera position</h3><span>m</span></div>
            <div className="camera-vector-grid">{currentCamera.position.map((value, index) => <NumberField key={`camera-position-${index}`} label={['X', 'Y', 'Z'][index]} value={value} min={-100} max={100} onCommit={next => updateCameraCoordinate('position', index, next)}/>)}</div>
            <div className="section-heading camera-fields-heading"><h3>Looking at</h3><span>m</span></div>
            <div className="camera-vector-grid">{currentCamera.target.map((value, index) => <NumberField key={`camera-target-${index}`} label={['X', 'Y', 'Z'][index]} value={value} min={-100} max={100} onCommit={next => updateCameraCoordinate('target', index, next)}/>)}</div>
            <div className="camera-actions"><button onClick={saveCamera}>Save current orbit</button><button onClick={() => removeCamera(currentCamera.name)} disabled={project.cameraViews.length < 2}>Delete view</button></div>
            <p className="panel-note">Orbit in the viewport to adjust by hand, then save it. Position and aim values are stored with the project.</p>
          </> : <div className="empty-inspector">Save a camera view to edit its position.</div> : panel === 'references' ? selectedReference ? <>
            <div className="reference-preview"><img src={selectedReference.dataUrl} alt={`Photo reference: ${selectedReference.name}`}/><span>2D reference plane</span></div>
            <p className="reference-note">{selectedReference.note}</p>
            <button className={`ceiling-toggle${selectedReference.placement.visible ? ' enabled' : ''}`} onClick={() => updateReference(selectedReference.id, { visible: !selectedReference.placement.visible })}><span className={`toggle-switch${selectedReference.placement.visible ? ' on' : ''}`}><i/></span><span>Show in scene</span></button>
            <div className="section-heading camera-fields-heading"><h3>Plane position</h3><span>m · °</span></div>
            <div className="reference-field-grid">
              <NumberField label="X" value={selectedReference.placement.x} min={-30} max={30} onCommit={value => updateReference(selectedReference.id, { x: value })}/>
              <NumberField label="Y" value={selectedReference.placement.y} min={0} max={10} onCommit={value => updateReference(selectedReference.id, { y: value })}/>
              <NumberField label="Z" value={selectedReference.placement.z} min={-30} max={30} onCommit={value => updateReference(selectedReference.id, { z: value })}/>
              <NumberField label="Width" value={selectedReference.placement.width} min={.1} max={8} onCommit={value => updateReference(selectedReference.id, { width: value })}/>
              <NumberField label="Height" value={selectedReference.placement.height} min={.1} max={8} onCommit={value => updateReference(selectedReference.id, { height: value })}/>
              <NumberField label="Rotation" value={selectedReference.placement.rotation} step={1} unit="°" min={-360} max={360} onCommit={value => updateReference(selectedReference.id, { rotation: value })}/>
            </div>
            <button className="remove-reference" onClick={() => removeReference(selectedReference.id)}>Remove reference</button>
          </> : <div className="reference-empty"><Icon name="image" size={26}/><strong>No references yet</strong><span>Paste an image from Claude or Codex, drag it here, or choose a file.</span><button onClick={() => referenceInputRef.current?.click()}>Add image reference</button></div> : panel === 'blender' ? <>
            <div className="section-heading"><h3>Blender MCP manager</h3><span>{isWindowsElectron ? 'Desktop controls' : 'Setup guide'}</span></div>
            <div className="blender-connection-card"><span className={`blender-connection-dot${blenderOperation ? ' running' : ''}`}/><div><strong>{blenderOperation ? blenderOperation.title : 'Local setup manager ready'}</strong><small>{isWindowsElectron ? 'No Blender or IDE connection is claimed until you check it.' : 'Run local install commands from the Windows Electron app.'}</small></div></div>
            <p className="blender-third-party">MCP for Blender is a community integration. It can run Python code in Blender. Terior uses safe mode and disables its telemetry in the generated Codex and Claude Code commands.</p>
            <div className="section-heading blender-section-heading"><h3>Install and connect</h3></div>
            <label className="blender-client-field"><span>IDE / CLI</span><select value={blenderClient} onChange={event => setBlenderClient(event.target.value as BlenderClient)}><option>Codex</option><option>Claude Code</option><option>Other MCP client</option></select></label>
            {!isWindowsElectron && <div className="blender-web-note">The web app can show and copy setup commands. Local PowerShell installation and status checks run inside Terior for Windows.</div>}
            <div className="blender-actions-grid">
              <button className="blender-action-button" disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction('install-uv', 'Install uv')}>Install uv with winget<span>Required command runner</span></button>
              <button className="blender-action-button primary" disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction('setup', 'Run Blender MCP setup wizard')}>Run setup wizard<span>Install server, add-on and client entries</span></button>
              {blenderClient === 'Other MCP client' ? <button className="blender-action-button" onClick={() => void copyBlenderText(blenderMcpRegistration(blenderClient), 'MCP configuration')}>Copy standard MCP config<span>Use in a compatible stdio client</span></button> : <button className="blender-action-button" disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction(blenderClient === 'Codex' ? 'register-codex' : 'register-claude', 'Register with ' + blenderClient)}>Register {blenderClient}<span>Safe mode on · telemetry off</span></button>}
              <button className="blender-action-button" disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction('update', 'Update Blender MCP and add-on')}>Update MCP + add-on<span>Uses the upstream update command</span></button>
            </div>
            <div className="blender-command-card"><div><strong>{blenderClient === 'Other MCP client' ? 'Standard MCP configuration' : 'Registration command'}</strong><button className="text-button" onClick={() => void copyBlenderText(blenderMcpRegistration(blenderClient), 'Command')}>Copy</button></div><code>{blenderMcpRegistration(blenderClient)}</code></div>
            {blenderClient === 'Other MCP client' ? <div className="blender-web-note">The setup wizard can also detect supported clients. Use each client’s own MCP settings to verify or remove a generic entry.</div> : <div className="blender-secondary-actions"><button disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction(blenderClient === 'Codex' ? 'check-codex' : 'check-claude', 'Check registration in ' + blenderClient)}>Check registration</button><button disabled={!isWindowsElectron || Boolean(blenderOperation)} onClick={() => void runBlenderMcpAction(blenderClient === 'Codex' ? 'remove-codex' : 'remove-claude', 'Remove registration from ' + blenderClient)}>Remove IDE entry</button></div>}
            <div className="blender-guide-links"><a href="https://github.com/ahujasid/mcp-for-blender" target="_blank" rel="noreferrer">Upstream setup and security notes <Icon name="upRight" size={12}/></a><a href="https://www.blender.org/download/" target="_blank" rel="noreferrer">Download Blender <Icon name="upRight" size={12}/></a></div>
            <div className="blender-terminal-card">
              <div className="blender-terminal-head"><span><i/>{blenderTerminalStatus}</span><button className="text-button" onClick={() => setBlenderTerminal('Terior Blender MCP console\r\n')}>Clear</button></div>
              <div className="blender-terminal-screen" ref={blenderTerminalRef} role="log" aria-live="polite"><pre>{blenderTerminal}</pre></div>
              <form className="blender-terminal-input" onSubmit={event => { event.preventDefault(); void sendBlenderPromptAnswer() }}><span>›</span><input value={blenderTerminalInput} disabled={!blenderOperation} onChange={event => setBlenderTerminalInput(event.target.value)} placeholder={blenderOperation ? 'Answer a setup prompt (1, 2, y, n)' : 'Setup prompts appear here'} aria-label="Answer a Blender MCP setup prompt"/><button type="submit" disabled={!blenderOperation || !blenderTerminalInput.trim()}>Send</button></form>
              {blenderOperation && <button className="blender-stop-button" onClick={() => void stopBlenderMcpAction()}>Stop current process</button>}
            </div>
            <p className="panel-note">The setup command may update selected IDE MCP config files and Blender add-on files. Review its prompts in this console. The generated CLI entries keep the Blender socket on localhost.</p>
            <div className="section-heading blender-section-heading"><h3>Blender builds</h3><span>{project.blenderBuilds.length} saved</span></div>
            <p className="blender-build-explainer">Prepare a revisioned GLB handoff, then import it in Blender and save a .blend file. The build log stays with this Terior project.</p>
            <button className="blender-build-create" disabled={!canvasApi} onClick={() => void prepareBlenderBuild()}><Icon name="export" size={15}/>Prepare scene for Blender</button>
            {project.blenderBuilds.length === 0 ? <div className="blender-empty-build">No Blender builds yet. Each handoff records the Terior scene revision.</div> : project.blenderBuilds.map(build => <article className="blender-build-card" key={build.id}>
              <div className="blender-build-title"><strong>{build.name}</strong><button className="plain-icon" aria-label={'Remove ' + build.name} onClick={() => removeBlenderBuild(build.id)}><Icon name="close" size={14}/></button></div>
              <small>Terior r{build.sourceRevision} · {new Date(build.createdAt).toLocaleDateString()} · {build.glbFilename}</small>
              {project.revision > build.sourceRevision && <span className="blender-build-stale">Scene has changed since this handoff.</span>}
              <label className="blender-build-file"><span>.blend file path</span><input key={build.id + (build.blendFile ?? '')} defaultValue={build.blendFile ?? ''} placeholder="Optional local path" onBlur={event => updateBlenderBuild(build.id, { blendFile: event.currentTarget.value.trim() || undefined })}/></label>
              <label className="blender-build-status"><span>Build status</span><select value={build.status} onChange={event => updateBlenderBuild(build.id, { status: event.target.value as BlenderBuild['status'] })}><option value="prepared">Handoff prepared</option><option value="in-progress">In Blender</option><option value="ready">Ready for review</option><option value="approved">Approved</option></select></label>
            </article>)}
            <p className="panel-note">GLB transfers the supported room, visible objects, materials and cameras. Blender-only features may be lost; a perfect .blend round trip is not promised.</p>
          </> : panel === 'lighting' ? <>
            <div className="section-heading"><h3>Light settings</h3><span>Shared scene</span></div>
            <div className="range-control"><div><label htmlFor="daylight">Daylight</label><output>{project.lighting.daylight}%</output></div><input id="daylight" type="range" min="0" max="100" value={project.lighting.daylight} onChange={event => updateLighting({ daylight: Number(event.target.value) })}/></div>
            <div className="range-control"><div><label htmlFor="fill">Light fill</label><output>{project.lighting.fill}%</output></div><input id="fill" type="range" min="0" max="100" value={project.lighting.fill} onChange={event => updateLighting({ fill: Number(event.target.value) })}/></div>
            <div className="range-control"><div><label htmlFor="warmth">Colour temperature</label><output>{project.lighting.warmth.toLocaleString()} K</output></div><input id="warmth" type="range" min="2200" max="6500" step="100" value={project.lighting.warmth} onChange={event => updateLighting({ warmth: Number(event.target.value) })}/></div>
            <div className="section-heading light-presets-heading"><h3>Lighting options</h3></div>
            <div className="light-presets">
              {[{ name: 'Daylight', value: { daylight: 88, warmth: 5100, fill: 48 } }, { name: 'Golden hour', value: { daylight: 63, warmth: 3300, fill: 36 } }, { name: 'Evening', value: { daylight: 32, warmth: 2700, fill: 28 } }].map(preset => <button key={preset.name} className={`light-preset${JSON.stringify(project.lighting) === JSON.stringify(preset.value) ? ' selected' : ''}`} onClick={() => updateLighting(preset.value)}><span className={`light-swatch ${preset.name.toLowerCase().replace(' ', '-')}`}><Icon name="light" size={18}/></span><span>{preset.name}</span></button>)}
            </div>
            <p className="panel-note">Lighting changes keep furniture, dimensions and saved camera views in place.</p>
          </> : selectedId === 'room' ? <>
            <div className="section-heading"><h3>Room dimensions</h3><span>m</span></div>
            <div className="dimension-grid room-dimensions">
              <NumberField label="Width" value={project.room.width} step={.1} min={1} max={30} onCommit={value => updateRoom({ width: value })}/>
              <NumberField label="Depth" value={project.room.depth} step={.1} min={1} max={30} onCommit={value => updateRoom({ depth: value })}/>
              <NumberField label="Height" value={project.room.height} step={.1} min={1} max={10} onCommit={value => updateRoom({ height: value })}/>
            </div>
            <div className="section-heading material-heading"><h3>Room surfaces</h3></div>
            <SelectField label="Walls" value={project.room.wallMaterial} choices={wallOptions} onChange={wallMaterial => updateRoom({ wallMaterial })}/>
            <SelectField label="Floor" value={project.room.floorMaterial} choices={floorOptions} onChange={floorMaterial => updateRoom({ floorMaterial })}/>
            <button className={`ceiling-toggle${project.room.showCeiling ? ' enabled' : ''}`} onClick={() => updateRoom({ showCeiling: !project.room.showCeiling })}><span className={`toggle-switch${project.room.showCeiling ? ' on' : ''}`}><i/></span><span>Show ceiling</span></button>
            <p className="panel-note">The room includes editable floor and wall surfaces, a window opening and an optional ceiling.</p>
          </> : selectedObject ? <>
            <div className="section-heading"><h3>Transform</h3><span>m · °</span></div>
            <div className="transform-grid">
              <NumberField label="X" value={selectedObject.x} onFocus={beginNumericEdit} onBlur={endNumericEdit} min={-15} max={15} onCommit={value => updateObject(selectedObject.id, { x: value }, false)}/>
              <NumberField label="Y" value={selectedObject.z} onFocus={beginNumericEdit} onBlur={endNumericEdit} min={-15} max={15} onCommit={value => updateObject(selectedObject.id, { z: value }, false)}/>
              <NumberField label="Rotation" value={selectedObject.rotation} step={1} unit="°" min={-360} max={360} onCommit={value => updateObject(selectedObject.id, { rotation: value })}/>
            </div>
            <div className="section-heading dimensions-heading"><h3>Dimensions</h3><button className={`dimension-lock${selectedObject.dimensionsLocked ? ' locked' : ''}`} title={selectedObject.dimensionsLocked ? 'Unlock dimensions' : 'Lock dimensions'} aria-label={selectedObject.dimensionsLocked ? 'Unlock dimensions' : 'Lock dimensions'} onClick={() => updateObject(selectedObject.id, { dimensionsLocked: !selectedObject.dimensionsLocked })}><Icon name={selectedObject.dimensionsLocked ? 'lock' : 'unlock'} size={15}/></button></div>
            <div className="dimension-grid">
              <NumberField label="W" value={selectedObject.width} min={.05} max={20} disabled={selectedObject.locked || selectedObject.dimensionsLocked} onFocus={beginNumericEdit} onBlur={endNumericEdit} onCommit={value => updateObject(selectedObject.id, { width: value }, false)}/>
              <NumberField label="D" value={selectedObject.depth} min={.05} max={20} disabled={selectedObject.locked || selectedObject.dimensionsLocked} onFocus={beginNumericEdit} onBlur={endNumericEdit} onCommit={value => updateObject(selectedObject.id, { depth: value }, false)}/>
              <NumberField label="H" value={selectedObject.height} min={.05} max={20} disabled={selectedObject.locked || selectedObject.dimensionsLocked} onFocus={beginNumericEdit} onBlur={endNumericEdit} onCommit={value => updateObject(selectedObject.id, { height: value }, false)}/>
            </div>
            {selectedObject.kind !== 'rug' && <>
              <div className="section-heading material-heading"><h3>Material</h3></div>
              <div className="material-select-row"><span className={`material-swatch swatch-${materialName(selectedObject.id).toLowerCase().replace(/[^a-z]+/g, '-')}`}/><SelectField label="" value={selectedObject.material} choices={materialOptions} disabled={selectedObject.locked} onChange={material => updateObject(selectedObject.id, { material })}/></div>
            </>}
            {selectedObject.estimated && <div className="uncertainty-note"><Icon name="warning" size={17}/><span>{selectedObject.estimated}</span></div>}
            {extentWarning && <div className="clearance-warning"><Icon name="warning" size={16}/><span>Object extends beyond the room boundary.</span></div>}
            {collisions && collisions.length > 0 && <div className="clearance-warning"><Icon name="warning" size={16}/><span>May overlap {collisions.map(item => item.name).join(', ')}. Check the clearance in your layout.</span></div>}
            <p className="panel-note disclaimer-note">Clearance checks support design decisions and do not certify building or architectural compliance.</p>
          </> : <div className="empty-inspector">Select an object in the scene or scene list.</div>}
        </div>
        <div className="inspector-footer"><span className="revision-mark">r{project.revision}</span><span>Scene revision</span><span className="footer-spacer"/><button className="footer-save" onClick={saveCamera}><Icon name="camera" size={14}/>Save camera</button></div>
      </aside>
    </div>

    <footer className="bottom-dock">
      <section className={`prompt-area${previewMode ? ' with-preview' : ''}`} aria-label="Describe a scene change">
        {proposal && <div className="proposal-card">
          <div className="proposal-head"><span className="proposal-icon"><Icon name="spark" size={15}/></span><strong>{project.pendingProposal?.id === proposal.id ? 'IDE proposal' : 'Proposed change'}</strong><button className="plain-icon" onClick={dismissProposal} aria-label="Dismiss preview"><Icon name="close" size={15}/></button></div>
          <p>{proposal.summary}</p>
          {proposal.referenceAddition && <div className="proposal-reference"><img src={proposal.referenceAddition.dataUrl} alt=""/><span>Photographic reference plane · 2D image</span></div>}
          {proposal.cameraPoseChange && <div className="proposal-camera">Position: {proposal.cameraPoseChange.position.map(value => value.toFixed(2)).join(', ')} m · Aim: {proposal.cameraPoseChange.target.map(value => value.toFixed(2)).join(', ')} m</div>}
          {proposal.lightingOptions && <div className="proposal-options">{proposal.lightingOptions.map((option, index) => <button key={option.label} className={lightingChoice === index ? 'selected' : ''} onClick={() => setLightingChoice(index)}><span className={`option-light option-${index}`}/>{option.label}</button>)}</div>}
          <div className="proposal-actions"><span>Preview based on revision r{proposal.baseRevision}</span><button className="apply-button" onClick={applyProposal}><Icon name="check" size={15}/>{proposal.referenceAddition ? 'Add reference' : 'Apply change'}</button></div>
        </div>}
        {promptError && <div className="prompt-error"><Icon name="warning" size={15}/><span>{promptError}</span><button className="plain-icon" onClick={() => setPromptError('')} aria-label="Dismiss message"><Icon name="close" size={14}/></button></div>}
        <div className="prompt-bar"><Icon name="spark" size={19}/><input value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') previewInstruction() }} placeholder="Describe a change or camera position…" aria-label="Describe a change"/><button className="attach-reference" onClick={() => referenceInputRef.current?.click()} title="Attach an image reference"><Icon name="image" size={16}/><span>Image</span></button><button className="preview-button" onClick={previewInstruction}>Preview change</button></div>
        <div className="prompt-examples"><button onClick={() => { setPrompt('Move the sofa 30 cm away from the wall'); setPromptError('') }}>Move the sofa 30 cm</button><span>·</span><button onClick={() => { setPrompt('Position the camera at 3, 2.5, 4 looking at 0, 1, 0'); setPromptError('') }}>Set camera position</button><span>·</span><button onClick={() => { setPrompt('Keep the furniture fixed and show three lighting options'); setPromptError('') }}>Compare lighting</button><span className="paste-hint">· Paste image from IDE chat</span></div>
      </section>
      <section className="camera-strip" aria-label="Saved camera views">
        <div className="camera-strip-title"><span>Camera views</span><button onClick={saveCameraAs}><Icon name="plus" size={14}/>Save as new view</button></div>
        <div className="camera-cards">{project.cameraViews.map((view, index) => <button key={view.name} className={`camera-card${project.activeCamera === view.name ? ' active' : ''}`} onClick={() => activateCamera(view.name)}>
          <span className={`camera-thumbnail thumb-${index}`}>
            <span className="thumb-window"/><span className="thumb-wall"/><span className="thumb-floor"/><span className="thumb-rug"/><span className="thumb-sofa"/><span className="thumb-table"/><span className="thumb-plant"/>
            <Icon name="camera" size={13}/>
          </span>
          <span className="camera-name">{view.name}</span>
        </button>)}</div>
        {exportState && <div className="export-status" role="status">{exportState}</div>}
      </section>
    </footer>
    {showExamples && <div className="example-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowExamples(false) }}>
      <section className="example-dialog" role="dialog" aria-modal="true" aria-labelledby="example-title">
        <div className="example-dialog-head"><div><h2 id="example-title">Room examples</h2><p>Open an editable scene with saved views and measured scale.</p></div><button className="plain-icon" onClick={() => setShowExamples(false)} aria-label="Close examples"><Icon name="close" size={18}/></button></div>
        <div className="example-list">{roomExamples.map(example => <button key={example.id} className="example-option" onClick={() => openExample(example.id)}><span className={`example-preview example-${example.id}`}><i/><b/><em/></span><span><strong>{example.name}</strong><small>{example.description}</small></span><Icon name="chevron" size={16}/></button>)}</div>
      </section>
    </div>}
    {openError && <div className="toast-error" role="alert"><Icon name="warning" size={16}/>{openError}<button className="plain-icon" onClick={() => setOpenError('')} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}
  </main>
}

export default App
