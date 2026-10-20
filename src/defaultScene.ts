import type { CameraPose, ProjectScene, SceneObject } from './types'

const defaultViews: CameraPose[] = [
  { name: 'Overview', position: [3.5, 6.2, 8.4], target: [0, 0.75, 0] },
  { name: 'Sofa detail', position: [2.8, 3.0, 5.2], target: [0, 0.72, -0.75] },
  { name: 'Window side', position: [2.15, 3.65, -0.7], target: [0.1, 1.15, -0.1] },
  { name: 'Materials', position: [-3.4, 2.25, 4.5], target: [0, 0.6, 0.15] },
]

const initialObjects: SceneObject[] = [
  { id: 'sofa-main', name: 'Sofa', model: 'terior:sofa-editorial', kind: 'model', x: -0.15, z: -1.05, rotation: 0, width: 2.1, depth: 1.0, height: 0.86, material: 'Warm linen', locked: false, visible: true, estimated: 'Depth estimated · review model proportions' },
  { id: 'table-coffee', name: 'Coffee table', model: 'terior:coffee-table', kind: 'model', x: 0.1, z: 0.32, rotation: 0, width: 1.18, depth: 0.68, height: 0.42, material: 'Smoked oak', locked: false, visible: true },
  { id: 'floor-lamp', name: 'Floor lamp', model: 'terior:floor-lamp', kind: 'model', x: 1.82, z: -0.83, rotation: -12, width: 0.42, depth: 0.42, height: 1.62, material: 'Brushed brass', locked: false, visible: true },
  { id: 'room-rug', name: 'Rug', model: null, kind: 'rug', x: 0.02, z: 0.28, rotation: 0, width: 2.85, depth: 2.05, height: 0.025, material: 'Natural wool', locked: false, visible: true },
  { id: 'plant-tree', name: 'Plant', model: 'terior:olive-tree', kind: 'model', x: -2.1, z: -1.45, rotation: 18, width: 0.7, depth: 0.7, height: 1.7, material: 'Olive green', locked: false, visible: true },
]

export const defaultScene: ProjectScene = {
  format: 'terior-project',
  schemaVersion: 2,
  projectName: "Cal's living room",
  revision: 1,
  room: { width: 5.8, depth: 4.8, height: 2.9, wallMaterial: 'Limestone', floorMaterial: 'Smoked oak', showCeiling: false },
  lighting: { daylight: 74, warmth: 4200, fill: 42 },
  objects: initialObjects,
  cameraViews: defaultViews,
  activeCamera: 'Overview',
  references: [],
  blenderBuilds: [],
}

export function freshScene(): ProjectScene {
  return structuredClone(defaultScene)
}

export function parseProject(value: unknown): ProjectScene {
  if (!value || typeof value !== 'object') throw new Error('This file is not a Terior project.')
  const project = value as Partial<ProjectScene>
  if (project.format !== 'terior-project' || ![1, 2].includes(project.schemaVersion ?? 0)) throw new Error('This Terior project version is not supported.')
  if (typeof project.projectName !== 'string' || !project.room || !Array.isArray(project.objects) || !Array.isArray(project.cameraViews) || project.cameraViews.length === 0 || !project.lighting) throw new Error('The project is missing scene data.')
  const objects = project.objects as SceneObject[]
  const ids = new Set<string>()
  for (const object of objects) {
    if (!object.id || ids.has(object.id) || !Number.isFinite(object.x) || !Number.isFinite(object.z) || !Number.isFinite(object.rotation)) throw new Error('The project contains an invalid or duplicated object.')
    if (![object.width, object.depth, object.height].every(n => Number.isFinite(n) && n > 0 && n <= 100)) throw new Error(`The dimensions for ${object.name || 'an object'} are invalid.`)
    ids.add(object.id)
  }
  for (const value of [project.room.width, project.room.depth, project.room.height]) {
    if (!Number.isFinite(value) || value! < 1 || value! > 100) throw new Error('Room dimensions must be between 1 and 100 metres.')
  }
  const cameraViews = project.cameraViews as CameraPose[]
  const cameraNames = new Set<string>()
  for (const camera of cameraViews) {
    if (!camera.name || cameraNames.has(camera.name) || !Array.isArray(camera.position) || !Array.isArray(camera.target) || camera.position.length !== 3 || camera.target.length !== 3 || [...camera.position, ...camera.target].some(n => !Number.isFinite(n) || Math.abs(n) > 100)) throw new Error('The project contains an invalid camera view.')
    if (Math.hypot(...camera.position.map((value, index) => value - camera.target[index])) < .05) throw new Error('A camera needs a distinct aim point.')
    cameraNames.add(camera.name)
  }
  const references = Array.isArray(project.references) ? project.references : []
  const referenceBytes = references.reduce((sum, reference) => sum + (reference.dataUrl?.length ?? 0), 0)
  if (references.length > 5 || referenceBytes > 3_800_000 || references.some(reference => !reference.id || !/^image\/(jpeg|png|webp)$/.test(reference.mimeType) || !reference.dataUrl?.startsWith(`data:${reference.mimeType};base64,`) || !reference.placement || ![reference.placement.x, reference.placement.y, reference.placement.z, reference.placement.width, reference.placement.height, reference.placement.rotation].every(Number.isFinite) || reference.placement.width <= 0 || reference.placement.height <= 0)) throw new Error('The project contains an invalid reference image.')
  const pendingProposal = project.pendingProposal
  if (pendingProposal && (!pendingProposal.id || !Number.isInteger(pendingProposal.baseRevision) || typeof pendingProposal.summary !== 'string')) throw new Error('The project contains an invalid pending proposal.')
  const blenderBuilds = Array.isArray(project.blenderBuilds) ? project.blenderBuilds : []
  if (blenderBuilds.length > 30 || blenderBuilds.some(build => !build.id || !build.name || !Number.isInteger(build.sourceRevision) || typeof build.createdAt !== 'string' || !['prepared', 'in-progress', 'ready', 'approved'].includes(build.status) || typeof build.glbFilename !== 'string' || (build.blendFile !== undefined && typeof build.blendFile !== 'string'))) throw new Error('The project contains an invalid Blender build record.')
  const activeCamera = cameraViews.some(camera => camera.name === project.activeCamera) ? project.activeCamera! : cameraViews[0].name
  return { ...project, schemaVersion: 2, references, blenderBuilds, activeCamera, revision: Math.max(1, Number(project.revision) || 1) } as unknown as ProjectScene
}

export function storedScene(): ProjectScene {
  try {
    const stored = localStorage.getItem('terior-project-v1')
    return stored ? parseProject(JSON.parse(stored)) : freshScene()
  } catch {
    return freshScene()
  }
}
