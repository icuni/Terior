export type SceneTool = 'select' | 'move' | 'rotate' | 'measure' | 'view'

export interface SceneObject {
  id: string
  name: string
  model: string | null
  kind: 'model' | 'rug'
  x: number
  z: number
  rotation: number
  width: number
  depth: number
  height: number
  material: string
  locked: boolean
  dimensionsLocked?: boolean
  visible: boolean
  estimated?: string
}

export interface CameraPose {
  name: string
  position: [number, number, number]
  target: [number, number, number]
}

export interface ReferenceImage {
  id: string
  name: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  dataUrl: string
  placement: {
    x: number
    y: number
    z: number
    width: number
    height: number
    rotation: number
    visible: boolean
  }
  note: string
}

export interface RoomSettings {
  width: number
  depth: number
  height: number
  wallMaterial: string
  floorMaterial: string
  showCeiling: boolean
}

export interface LightingSettings {
  daylight: number
  warmth: number
  fill: number
}

export interface SceneProposal {
  id: string
  baseRevision: number
  summary: string
  objectChanges?: SceneObject[]
  lightingChange?: LightingSettings
  cameraPoseChange?: CameraPose
  referenceAddition?: ReferenceImage
}

export interface BlenderBuild {
  id: string
  name: string
  sourceRevision: number
  createdAt: string
  status: 'prepared' | 'in-progress' | 'ready' | 'approved'
  glbFilename: string
  blendFile?: string
}

export interface ProjectScene {
  format: 'terior-project'
  schemaVersion: 2
  projectName: string
  revision: number
  room: RoomSettings
  lighting: LightingSettings
  objects: SceneObject[]
  cameraViews: CameraPose[]
  activeCamera: string
  references: ReferenceImage[]
  blenderBuilds: BlenderBuild[]
  pendingProposal?: SceneProposal
}

export interface ModelLibraryItem {
  model: string
  name: string
  category: string
  width: number
  depth: number
  height: number
  material: string
  preview?: string
  estimated?: string
}

