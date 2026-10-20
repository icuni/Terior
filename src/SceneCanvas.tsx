import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { modelUrl } from './modelLibrary'
import type { CameraPose, ProjectScene, ReferenceImage, RoomSettings, SceneObject, SceneTool } from './types'

export interface SceneCanvasApi {
  exportPng: () => Promise<Blob>
  exportGlb: () => Promise<Blob>
  getCameraPose: () => CameraPose
  setCameraPose: (pose: CameraPose) => void
}

interface Props {
  project: ProjectScene
  selectedId: string
  tool: SceneTool
  onSelect: (id: string) => void
  onTransformStart: () => void
  onTransform: (id: string, value: Pick<SceneObject, 'x' | 'z' | 'rotation'>) => void
  onTransformEnd: () => void
  onCameraMove: (pose: CameraPose) => void
  onReady: (api: SceneCanvasApi) => void
}

const materialColors: Record<string, string> = {
  'Warm linen': '#c4a47f',
  'Moss velvet': '#68735c',
  'Oak and linen': '#ad8962',
  Charcoal: '#4b5358',
  'Natural oak': '#a67b4f',
  'Smoked oak': '#78583b',
  'Brushed brass': '#b08b55',
  'Olive green': '#788a66',
  'Clear glass': '#b6d5df',
  'White oak': '#c8b392',
  'Natural wool': '#d3c7b5',
}

const wallColors: Record<string, string> = {
  Limestone: '#e4dfd5',
  Chalk: '#f0eee9',
  'Soft sage': '#cbd2c4',
  'Blue grey': '#c2cdd7',
}

const floorColors: Record<string, string> = {
  'Smoked oak': '#806348',
  'Natural oak': '#ae8a5e',
  Walnut: '#5e4736',
  Concrete: '#9b9d99',
}

const makeWoodTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8a6b4d'
  ctx.fillRect(0, 0, 512, 512)
  for (let row = 0; row < 12; row++) {
    const y = row * 43
    ctx.fillStyle = row % 2 ? '#917250' : '#806246'
    ctx.fillRect(0, y + 1, 512, 40)
    ctx.strokeStyle = 'rgba(42, 30, 20, .22)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, y + 41); ctx.lineTo(512, y + 41); ctx.stroke()
    const seam = row % 2 ? 210 : 335
    ctx.beginPath(); ctx.moveTo(seam, y); ctx.lineTo(seam, y + 40); ctx.stroke()
    for (let grain = 0; grain < 18; grain++) {
      const gx = (grain * 83 + row * 27) % 512
      ctx.strokeStyle = grain % 3 ? 'rgba(226, 194, 151, .13)' : 'rgba(50, 35, 23, .1)'
      ctx.lineWidth = grain % 4 === 0 ? 2 : 1
      ctx.beginPath(); ctx.moveTo(gx, y + 5 + (grain % 5) * 6); ctx.bezierCurveTo(gx + 18, y + 4, gx + 34, y + 33, gx + 61, y + 31); ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.25, 1)
  return texture
}

const makeWoolTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d4c9b8'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 900; i++) {
    const x = (i * 47) % 256
    const y = (i * 83) % 256
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.2)' : 'rgba(101,82,60,.16)'
    ctx.lineWidth = i % 5 === 0 ? 2 : 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + (i % 4)); ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 2)
  return texture
}

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: string, material?: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material ?? new THREE.MeshStandardMaterial({ color, roughness: .86 }))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function disposeObject(object: THREE.Object3D) {
  object.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      const materials = new Set<THREE.Material>([
        ...(Array.isArray(node.material) ? node.material : [node.material]),
        ...((node.userData.teriorBaseMaterials as THREE.Material[] | undefined) ?? []),
        ...((node.userData.teriorAssignedMaterials as THREE.Material[] | undefined) ?? []),
      ])
      materials.forEach(material => {
        const candidate = material as THREE.MeshStandardMaterial
        candidate.map?.dispose()
        candidate.bumpMap?.dispose()
        candidate.normalMap?.dispose()
        material.dispose()
      })
    }
  })
}

function buildRoom(room: RoomSettings): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Editable room'
  const w = room.width, d = room.depth, h = room.height
  const wall = wallColors[room.wallMaterial] ?? wallColors.Limestone
  const floorMap = makeWoodTexture()
  const floorBump = floorMap.clone()
  floorBump.colorSpace = THREE.NoColorSpace
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: floorMap, color: floorColors[room.floorMaterial] ?? floorColors['Smoked oak'], roughness: .78, bumpMap: floorBump, bumpScale: .018 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -.035
  floor.receiveShadow = true
  group.add(floor)

  box(group, [w, h, .12], [0, h / 2, -d / 2], wall)
  const windowWidth = Math.min(1.65, w * .32)
  const windowHeight = Math.min(1.28, h * .48)
  const windowSill = Math.min(1.12, h * .42)
  const windowCenterZ = -d * .17
  const minZ = windowCenterZ - windowWidth / 2
  const maxZ = windowCenterZ + windowWidth / 2
  const rightX = w / 2
  const wallThickness = .14
  const wallMaterial = new THREE.MeshStandardMaterial({ color: wall, roughness: .9 })
  const wallSegments: Array<[number, number]> = [[-d / 2, minZ], [maxZ, d / 2]]
  wallSegments.forEach(([start, end]) => {
    if (end <= start) return
    box(group, [wallThickness, h, end - start], [rightX, h / 2, (start + end) / 2], wall, wallMaterial)
  })
  box(group, [wallThickness, windowSill, windowWidth], [rightX, windowSill / 2, windowCenterZ], wall, wallMaterial)
  const windowTop = Math.min(h - .14, windowSill + windowHeight)
  box(group, [wallThickness, h - windowTop, windowWidth], [rightX, (h + windowTop) / 2, windowCenterZ], wall, wallMaterial)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(windowWidth - .14, windowTop - windowSill - .12), new THREE.MeshPhysicalMaterial({ color: '#b7d4dc', transparent: true, opacity: .54, roughness: .2, metalness: .08, side: THREE.DoubleSide }))
  glass.rotation.y = Math.PI / 2
  glass.position.set(rightX - .065, (windowTop + windowSill) / 2, windowCenterZ)
  group.add(glass)
  const frameColor = '#ede9df'
  const frameX = rightX - .105
  box(group, [.07, .065, windowWidth], [frameX, windowSill, windowCenterZ], frameColor)
  box(group, [.07, .065, windowWidth], [frameX, windowTop, windowCenterZ], frameColor)
  box(group, [.07, windowTop - windowSill, .065], [frameX, (windowTop + windowSill) / 2, minZ + .03], frameColor)
  box(group, [.07, windowTop - windowSill, .065], [frameX, (windowTop + windowSill) / 2, maxZ - .03], frameColor)
  box(group, [.07, windowTop - windowSill, .032], [frameX, (windowTop + windowSill) / 2, windowCenterZ], '#ddd8ce')

  box(group, [.085, h, d], [-w / 2, h / 2, 0], wall)
  const trim = new THREE.MeshStandardMaterial({ color: '#cfc8bd', roughness: .8 })
  box(group, [w, .12, .08], [0, .06, -d / 2 + .075], '#cfc8bd', trim)
  box(group, [.08, .12, d], [-w / 2 + .075, .06, 0], '#cfc8bd', trim)
  box(group, [.08, .12, d], [w / 2 - .075, .06, 0], '#cfc8bd', trim)

  if (room.showCeiling) {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: .98, side: THREE.DoubleSide }))
    ceiling.rotation.x = -Math.PI / 2
    ceiling.position.y = h
    group.add(ceiling)
  }
  return group
}

function applyModelMaterial(node: THREE.Mesh, materialName: string) {
  const tint = materialColors[materialName]
  const originals = (node.userData.teriorBaseMaterials as THREE.Material[] | undefined) ?? (Array.isArray(node.material) ? node.material : [node.material])
  const materials = originals.map(original => {
    const cloned = original.clone()
    cloned.side = THREE.DoubleSide
    if (tint && 'color' in cloned && materialName !== 'Clear glass') {
      const strength = materialName === 'Olive green' ? .84 : materialName === 'Brushed brass' ? .72 : .62
      ;(cloned as THREE.MeshStandardMaterial).color.lerp(new THREE.Color(tint), strength)
    }
    if ('roughness' in cloned) (cloned as THREE.MeshStandardMaterial).roughness = Math.max(.32, (cloned as THREE.MeshStandardMaterial).roughness || .7)
    return cloned
  })
  const previous = node.userData.teriorAssignedMaterials as THREE.Material[] | undefined
  previous?.forEach(material => material.dispose())
  node.material = node.userData.teriorHadMaterialArray ? materials : materials[0]
  node.userData.teriorAssignedMaterials = materials
}

function normalizedMaterial(model: THREE.Object3D, materialName: string) {
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    node.castShadow = true
    node.receiveShadow = true
    node.userData.teriorObjectId = model.userData.teriorObjectId
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material]
    node.userData.teriorHadMaterialArray = Array.isArray(node.material)
    node.userData.teriorBaseMaterials = sourceMaterials.map(material => material.clone())
    applyModelMaterial(node, materialName)
  })
}

function createRug(object: SceneObject) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ map: makeWoolTexture(), color: materialColors[object.material] ?? '#d4c9b8', roughness: .98, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(object.width, object.depth), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = .018
  mesh.receiveShadow = true
  group.add(mesh)
  group.userData.baseDimensions = [object.width, object.height, object.depth]
  return group
}

function fabricMaterial(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c8b39a'
  ctx.fillRect(0, 0, 512, 512)
  let seed = 91731
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  for (let i = 0; i < 12500; i++) {
    const x = Math.floor(random() * 512), y = Math.floor(random() * 512)
    ctx.fillStyle = random() > .52 ? 'rgba(255,255,255,.18)' : 'rgba(66,50,34,.13)'
    ctx.fillRect(x, y, 1 + Math.floor(random() * 2), 1)
  }
  for (let i = 0; i < 92; i++) {
    const y = i * 5.6
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.11)' : 'rgba(59,45,32,.09)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke()
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(2.2, 1.1)
  const bumpMap = map.clone()
  bumpMap.colorSpace = THREE.NoColorSpace
  const result = new THREE.MeshStandardMaterial({ color, map, bumpMap, bumpScale: .018, roughness: .96 })
  return result
}

function roundedBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, radius = .04) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 5, radius), material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function cylinderBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radialSegments = 20) {
  const delta = new THREE.Vector3().subVectors(b, a)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * .82, radius, delta.length(), radialSegments), material)
  mesh.position.copy(a).add(b).multiplyScalar(.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function createTailoredSofa(object: SceneObject) {
  const group = new THREE.Group()
  const fabric = fabricMaterial(materialColors[object.material] ?? materialColors['Warm linen'])
  const seam = new THREE.MeshStandardMaterial({ color: '#ddc9ae', roughness: .98 })
  const oak = new THREE.MeshStandardMaterial({ color: '#6d5137', roughness: .62 })
  const brass = new THREE.MeshStandardMaterial({ color: '#a6814b', roughness: .32, metalness: .68 })
  roundedBox(group, [1.94, .22, .82], [0, .27, -.015], fabric, .075)
  roundedBox(group, [1.82, .16, .73], [0, .405, .025], fabric, .06)
  roundedBox(group, [1.91, .58, .19], [0, .59, -.38], fabric, .075)
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * .59
    const cushion = roundedBox(group, [.565, .175, .65], [x, .505, .005], fabric, .062)
    cushion.rotation.x = -.018
    roundedBox(group, [.555, .415, .2], [x, .765, -.355], fabric, .07)
    roundedBox(group, [.015, .018, .55], [x + .276, .585, -.003], seam, .007)
  }
  for (const side of [-1, 1]) {
    roundedBox(group, [.205, .48, .83], [side * .87, .48, -.005], fabric, .082)
    roundedBox(group, [.13, .04, .56], [side * .87, .738, .02], seam, .018)
    for (const z of [-.33, .34]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(.038, .054, .145, 28), oak)
      leg.position.set(side * .78, .086, z)
      leg.rotation.z = side * -.11
      leg.castShadow = true
      group.add(leg)
      const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(.039, .047, .027, 28), brass)
      ferrule.position.set(side * .78, .035, z)
      group.add(ferrule)
    }
  }
  const pillowMaterial = fabricMaterial('#a5ad91')
  for (const [x, tilt] of [[-.56, -.14], [.57, .16]] as const) {
    const pillow = roundedBox(group, [.41, .37, .15], [x, .72, -.205], pillowMaterial, .08)
    pillow.rotation.z = tilt
    pillow.rotation.y = x < 0 ? -.08 : .08
  }
  group.userData.baseDimensions = [2.1, .86, 1]
  return group
}

function createSolidOakTable(object: SceneObject) {
  const group = new THREE.Group()
  const timber = new THREE.MeshStandardMaterial({ color: materialColors[object.material] ?? '#78583b', roughness: .42, metalness: .02 })
  const underframe = new THREE.MeshStandardMaterial({ color: '#4e3928', roughness: .72 })
  const brass = new THREE.MeshStandardMaterial({ color: '#9c7849', roughness: .3, metalness: .68 })
  roundedBox(group, [1.18, .075, .68], [0, .37, 0], timber, .055)
  roundedBox(group, [1.03, .055, .53], [0, .285, 0], underframe, .025)
  for (const x of [-.48, .48]) for (const z of [-.24, .24]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.032, .047, .285, 24), timber)
    foot.position.set(x, .14, z)
    foot.castShadow = true
    group.add(foot)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.034, .036, .025, 24), brass)
    cap.position.set(x, .025, z)
    group.add(cap)
  }
  group.userData.baseDimensions = [1.18, .42, .68]
  return group
}

function createLinenFloorLamp() {
  const group = new THREE.Group()
  const brass = new THREE.MeshStandardMaterial({ color: '#b08b55', roughness: .27, metalness: .78 })
  const shade = new THREE.MeshStandardMaterial({ color: '#e5dac7', roughness: .88, side: THREE.DoubleSide })
  const dark = new THREE.MeshStandardMaterial({ color: '#393634', roughness: .3, metalness: .5 })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.205, .21, .045, 48), brass)
  base.position.y = .025
  group.add(base)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .05, 24), brass)
  collar.position.y = .07
  group.add(collar)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.014, .018, 1.12, 24), brass)
  stem.position.set(0, .63, 0)
  group.add(stem)
  const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.14, 0), new THREE.Vector3(0, 1.33, 0), new THREE.Vector3(-.045, 1.46, 0), new THREE.Vector3(-.16, 1.49, 0)])
  const armMesh = new THREE.Mesh(new THREE.TubeGeometry(arm, 32, .014, 12, false), brass)
  group.add(armMesh)
  const profile = [new THREE.Vector2(.105, 1.37), new THREE.Vector2(.14, 1.41), new THREE.Vector2(.215, 1.63), new THREE.Vector2(.205, 1.66), new THREE.Vector2(.105, 1.39)]
  const lampshade = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), shade)
  lampshade.position.x = -.16
  lampshade.castShadow = true
  group.add(lampshade)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.21, .008, 8, 48), dark)
  rim.rotation.x = Math.PI / 2
  rim.position.set(-.16, 1.63, 0)
  group.add(rim)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.045, 24, 16), new THREE.MeshStandardMaterial({ color: '#ffe2a4', emissive: '#d59a40', emissiveIntensity: 1.2 }))
  bulb.position.set(-.16, 1.39, 0)
  group.add(bulb)
  group.userData.baseDimensions = [.42, 1.62, .42]
  return group
}

function createOliveTree() {
  const group = new THREE.Group()
  const ceramic = new THREE.MeshStandardMaterial({ color: '#ad866c', roughness: .28, metalness: .03 })
  const soil = new THREE.MeshStandardMaterial({ color: '#30291f', roughness: 1 })
  const bark = new THREE.MeshStandardMaterial({ color: '#6d5138', roughness: .9 })
  const leaves = ['#77845d', '#88966c', '#9aa37b', '#687952'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .86, side: THREE.DoubleSide }))
  const pot = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.19, .02), new THREE.Vector2(.23, .06), new THREE.Vector2(.28, .39), new THREE.Vector2(.25, .43), new THREE.Vector2(.215, .39)], 48), ceramic)
  pot.castShadow = true
  group.add(pot)
  const earth = new THREE.Mesh(new THREE.CylinderGeometry(.215, .215, .018, 40), soil)
  earth.position.y = .39
  group.add(earth)
  const trunkStart = new THREE.Vector3(0, .4, 0)
  const trunkTop = new THREE.Vector3(0, 1.35, 0)
  cylinderBetween(group, trunkStart, trunkTop, .038, bark, 18)
  const branchTips: THREE.Vector3[] = []
  for (let i = 0; i < 10; i++) {
    const angle = i * 2.399963
    const y = .78 + (i % 5) * .12
    const tip = new THREE.Vector3(Math.cos(angle) * (.18 + (i % 3) * .06), y, Math.sin(angle) * (.18 + (i % 4) * .05))
    cylinderBetween(group, new THREE.Vector3(0, y - .16, 0), tip, .013, bark, 12)
    branchTips.push(tip)
  }
  for (let i = 0; i < 64; i++) {
    const angle = i * 2.399963
    const ring = Math.floor(i / 16)
    const y = .86 + ring * .19 + (i % 4) * .035
    const radius = .2 + ring * .035 + (i % 3) * .025
    const center = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), leaves[i % leaves.length])
    leaf.position.copy(center)
    leaf.scale.set(.058 + (i % 3) * .006, .15, .026)
    leaf.rotation.set((i % 5) * .12, angle, .32 * Math.sin(angle))
    leaf.castShadow = true
    leaf.receiveShadow = true
    group.add(leaf)
  }
  branchTips.forEach((tip, index) => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), leaves[index % leaves.length])
    leaf.position.copy(tip)
    leaf.scale.set(.08, .19, .033)
    leaf.rotation.z = index % 2 ? -.3 : .3
    leaf.castShadow = true
    group.add(leaf)
  })
  group.userData.baseDimensions = [.7, 1.7, .7]
  return group
}

function createStudioModel(object: SceneObject) {
  if (object.model === 'terior:sofa-editorial') return createTailoredSofa(object)
  if (object.model === 'terior:coffee-table') return createSolidOakTable(object)
  if (object.model === 'terior:floor-lamp') return createLinenFloorLamp()
  if (object.model === 'terior:olive-tree') return createOliveTree()
  return null
}

function createReferencePlane(reference: ReferenceImage, texture: THREE.Texture) {
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(reference.placement.width, reference.placement.height), material)
  plane.position.set(reference.placement.x, reference.placement.y, reference.placement.z)
  plane.rotation.y = THREE.MathUtils.degToRad(reference.placement.rotation)
  plane.name = `Photo reference · ${reference.name}`
  plane.userData.teriorReferenceId = reference.id
  plane.userData.teriorIsPhotographicReference = true
  plane.visible = reference.placement.visible
  plane.renderOrder = 2
  return plane
}

function alignModel(group: THREE.Group, object: SceneObject) {
  group.position.set(object.x, 0, object.z)
  group.rotation.set(0, THREE.MathUtils.degToRad(object.rotation), 0)
  const base = group.userData.baseDimensions as [number, number, number] | undefined
  if (base) group.scale.set(object.width / base[0], object.height / base[1], object.depth / base[2])
}

function cameraFromPose(camera: THREE.PerspectiveCamera, controls: OrbitControls, pose: CameraPose) {
  camera.position.set(...pose.position)
  controls.target.set(...pose.target)
  controls.update()
}

export default function SceneCanvas({ project, selectedId, tool, onSelect, onTransformStart, onTransform, onTransformEnd, onCameraMove, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [assetReport, setAssetReport] = useState('Loading scene assets…')
  const runtimeRef = useRef<{ scene: THREE.Scene; world: THREE.Group; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; transform: TransformControls; groups: Map<string, THREE.Group>; helpers: Map<string, THREE.Box3Helper>; references: Map<string, THREE.Object3D>; loader: GLTFLoader; modelCache: Map<string, Promise<THREE.Group>>; room: THREE.Group | null; environment: THREE.WebGLRenderTarget; pmrem: THREE.PMREMGenerator } | null>(null)
  const projectRef = useRef(project)
  const selectedRef = useRef(selectedId)
  const toolRef = useRef(tool)
  const callbacksRef = useRef({ onSelect, onTransformStart, onTransform, onTransformEnd, onCameraMove })
  projectRef.current = project
  selectedRef.current = selectedId
  toolRef.current = tool
  callbacksRef.current = { onSelect, onTransformStart, onTransform, onTransformEnd, onCameraMove }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#dfe4e9')
    const world = new THREE.Group()
    world.name = 'Terior editable scene'
    scene.add(world)
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 120)
    camera.position.set(...projectRef.current.cameraViews[0].position)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D room canvas. Drag to orbit. Use the Move or Rotate tool to edit the selected object.')
    host.appendChild(renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), .04)
    scene.environment = environment.texture
    scene.environmentIntensity = .38

    const hemi = new THREE.HemisphereLight('#fff8ed', '#777e88', 1.3)
    scene.add(hemi)
    const key = new THREE.DirectionalLight('#fff4e2', 3.25)
    key.position.set(-4, 8, 5)
    key.castShadow = true
    key.shadow.mapSize.set(3072, 3072)
    key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8
    scene.add(key)
    const fill = new THREE.DirectionalLight('#d2e1fc', .7)
    fill.position.set(5, 5, -4)
    scene.add(fill)
    const lampGlow = new THREE.PointLight('#f7d59a', 38, 5.5, 2)
    lampGlow.position.set(1.78, 1.45, -.8)
    scene.add(lampGlow)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = .075
    controls.target.set(...projectRef.current.cameraViews[0].target)
    controls.minDistance = 3.5
    controls.maxDistance = 15
    controls.maxPolarAngle = Math.PI * .48
    controls.addEventListener('end', () => callbacksRef.current.onCameraMove({ name: projectRef.current.activeCamera, position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] }))

    const transform = new TransformControls(camera, renderer.domElement)
    transform.setSize(.78)
    transform.addEventListener('dragging-changed', event => {
      const dragging = (event as unknown as { value: boolean }).value
      controls.enabled = !dragging
      if (dragging) callbacksRef.current.onTransformStart()
      else callbacksRef.current.onTransformEnd()
    })
    transform.addEventListener('objectChange', () => {
      const object = transform.object as THREE.Group | undefined
      if (!object) return
      callbacksRef.current.onTransform(object.userData.teriorObjectId, { x: object.position.x, z: object.position.z, rotation: THREE.MathUtils.radToDeg(object.rotation.y) })
    })
    const transformHelper = transform.getHelper()
    scene.add(transformHelper)

    const loader = new GLTFLoader()
    const groups = new Map<string, THREE.Group>()
    const helpers = new Map<string, THREE.Box3Helper>()
    const references = new Map<string, THREE.Object3D>()
    runtimeRef.current = { scene, world, camera, renderer, controls, transform, groups, helpers, references, loader, modelCache: new Map(), room: null, environment, pmrem }

    const onPointerDown = (event: PointerEvent) => {
      if (toolRef.current !== 'select' && toolRef.current !== 'measure') return
      const rect = renderer.domElement.getBoundingClientRect()
      const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(world.children, true)
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object
        while (node && !node.userData.teriorObjectId) node = node.parent
        if (node?.userData.teriorObjectId) {
          callbacksRef.current.onSelect(node.userData.teriorObjectId as string)
          return
        }
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    let frame = 0
    const render = () => {
      controls.update()
      for (const helper of helpers.values()) helper.box.setFromObject(groups.get(helper.userData.teriorObjectId as string) ?? world)
      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(render)
    }
    render()

    const api: SceneCanvasApi = {
      exportPng: () => new Promise((resolve, reject) => {
        const transformVisibility = transformHelper.visible
        const helperVisibility = [...helpers.values()].map(helper => [helper, helper.visible] as const)
        const restoreEditorHelpers = () => {
          transformHelper.visible = transformVisibility
          helperVisibility.forEach(([helper, visible]) => { helper.visible = visible })
          renderer.render(scene, camera)
        }
        try {
          transformHelper.visible = false
          helpers.forEach(helper => { helper.visible = false })
          renderer.render(scene, camera)
          renderer.domElement.toBlob(blob => {
            restoreEditorHelpers()
            if (blob) resolve(blob)
            else reject(new Error('The current view could not be captured.'))
          }, 'image/png')
        } catch (error) {
          restoreEditorHelpers()
          reject(error)
        }
      }),
      exportGlb: async () => {
        const exporter = new GLTFExporter()
        const result = await exporter.parseAsync(world, { binary: true, onlyVisible: true })
        if (!(result instanceof ArrayBuffer)) throw new Error('The GLB exporter returned an unexpected file format.')
        return new Blob([result], { type: 'model/gltf-binary' })
      },
      getCameraPose: () => ({ name: projectRef.current.activeCamera, position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] }),
      setCameraPose: pose => cameraFromPose(camera, controls, pose),
    }
    onReady(api)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      controls.dispose()
      transform.dispose()
      disposeObject(world)
      renderer.dispose()
      environment.dispose()
      pmrem.dispose()
      renderer.domElement.remove()
      runtimeRef.current = null
    }
  }, [onReady])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const nextRoom = buildRoom(project.room)
    if (runtime.room) {
      runtime.world.remove(runtime.room)
      disposeObject(runtime.room)
    }
    runtime.room = nextRoom
    runtime.world.add(nextRoom)
  }, [project.room.width, project.room.depth, project.room.height, project.room.wallMaterial, project.room.floorMaterial, project.room.showCeiling])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    let cancelled = false
    for (const plane of runtime.references.values()) {
      runtime.world.remove(plane)
      disposeObject(plane)
    }
    runtime.references.clear()
    const loader = new THREE.TextureLoader()
    void Promise.all(project.references.filter(reference => reference.placement.visible).map(async reference => {
      const texture = await loader.loadAsync(reference.dataUrl)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = Math.min(8, runtime.renderer.capabilities.getMaxAnisotropy())
      return [reference, createReferencePlane(reference, texture)] as const
    })).then(entries => {
      if (cancelled) { entries.forEach(([, plane]) => disposeObject(plane)); return }
      for (const [reference, plane] of entries) {
        runtime.references.set(reference.id, plane)
        runtime.world.add(plane)
      }
    }).catch(error => console.error('Could not load a photographic reference', error))
    return () => { cancelled = true }
  }, [project.references])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    let settled = 0
    let failed = 0
    const total = project.objects.length
    const report = () => setAssetReport(failed ? `${failed} scene asset${failed === 1 ? '' : 's'} could not load` : settled < total ? `Loading scene assets · ${settled}/${total}` : '')
    report()
    const active = new Set(project.objects.map(object => object.id))
    for (const [id, group] of runtime.groups) {
      if (!active.has(id)) {
        runtime.world.remove(group)
        disposeObject(group)
        runtime.groups.delete(id)
        const helper = runtime.helpers.get(id)
        if (helper) { runtime.scene.remove(helper); runtime.helpers.delete(id) }
      }
    }
    const add = async (object: SceneObject) => {
      let group: THREE.Group
      if (object.kind === 'rug') {
        group = createRug(object)
      } else if (object.model?.startsWith('terior:')) {
        const studioModel = createStudioModel(object)
        if (!studioModel) return
        group = studioModel
      } else if (object.model) {
        let promise = runtime.modelCache.get(object.model)
        if (!promise) {
          promise = runtime.loader.loadAsync(modelUrl(object.model)).then(gltf => {
            const clone = gltf.scene.clone(true) as THREE.Group
            runtime.modelCache.set(object.model!, Promise.resolve(clone))
            return clone
          })
          runtime.modelCache.set(object.model, promise)
        }
        const source = await promise
        group = new THREE.Group()
        const model = source.clone(true)
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        const sx = object.width / Math.max(.0001, size.x)
        const sy = object.height / Math.max(.0001, size.y)
        const sz = object.depth / Math.max(.0001, size.z)
        model.scale.set(sx, sy, sz)
        model.position.set(-(bounds.min.x + bounds.max.x) * .5 * sx, -bounds.min.y * sy, -(bounds.min.z + bounds.max.z) * .5 * sz)
        model.userData.teriorObjectId = object.id
        normalizedMaterial(model, object.material)
        group.add(model)
        group.userData.baseDimensions = [object.width, object.height, object.depth]
      } else {
        return
      }
      group.name = object.name
      group.userData.teriorObjectId = object.id
      group.userData.teriorModel = object.model
      group.userData.teriorMaterial = object.material
      group.userData.baseDimensions ??= [object.width, object.height, object.depth]
      group.traverse(node => { node.userData.teriorObjectId = object.id })
      alignModel(group, object)
      runtime.groups.set(object.id, group)
      runtime.world.add(group)
      settled += 1
      report()
      if (selectedRef.current === object.id) {
        const current = projectRef.current.objects.find(candidate => candidate.id === object.id)
        runtime.transform.attach(group)
        runtime.transform.enabled = (toolRef.current === 'move' || toolRef.current === 'rotate') && !current?.locked
        runtime.transform.setMode(toolRef.current === 'rotate' ? 'rotate' : 'translate')
        const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(group), '#1e68e8')
        helper.userData.teriorObjectId = object.id
        runtime.helpers.set(object.id, helper)
        runtime.scene.add(helper)
      }
    }
    project.objects.forEach(object => {
      const existing = runtime.groups.get(object.id)
      if (existing && (existing.userData.teriorModel !== object.model || (object.model?.startsWith('terior:') && existing.userData.teriorMaterial !== object.material))) {
        runtime.world.remove(existing); disposeObject(existing); runtime.groups.delete(object.id)
      }
      const group = runtime.groups.get(object.id)
      if (group) {
        settled += 1
        report()
        group.visible = object.visible
        alignModel(group, object)
        if (!object.model?.startsWith('terior:')) group.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return
          applyModelMaterial(node, object.material)
        })
      } else {
        void add(object).catch(error => {
          failed += 1
          report()
          console.error(`Could not load ${object.name}`, error)
        })
      }
    })
  }, [project.objects])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const { transform, groups, scene } = runtime
    const selected = groups.get(selectedId)
    if (selected && selected.visible) {
      transform.attach(selected)
      const selectedObject = project.objects.find(object => object.id === selectedId)
      transform.enabled = (tool === 'move' || tool === 'rotate') && !selectedObject?.locked
      transform.setMode(tool === 'rotate' ? 'rotate' : 'translate')
      const helper = runtime.helpers.get(selectedId)
      if (helper) scene.remove(helper)
      const next = new THREE.Box3Helper(new THREE.Box3().setFromObject(selected), '#1e68e8')
      next.userData.teriorObjectId = selectedId
      runtime.helpers.set(selectedId, next)
      scene.add(next)
      if (tool === 'rotate') {
        transform.showX = false; transform.showY = true; transform.showZ = false
      } else {
        transform.showX = true; transform.showY = false; transform.showZ = true
      }
    } else {
      transform.detach()
      transform.enabled = false
      for (const helper of runtime.helpers.values()) scene.remove(helper)
      runtime.helpers.clear()
    }
  }, [selectedId, tool, project.objects])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const preset = project.cameraViews.find(view => view.name === project.activeCamera)
    if (preset) cameraFromPose(runtime.camera, runtime.controls, preset)
  }, [project.activeCamera, project.cameraViews])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const daylight = project.lighting.daylight / 74
    runtime.renderer.toneMappingExposure = .72 + daylight * .36
    runtime.scene.children.forEach(node => {
      if (node instanceof THREE.HemisphereLight) node.intensity = .8 + project.lighting.fill / 100
      if (node instanceof THREE.DirectionalLight && node.position.x < 0) node.intensity = .8 + project.lighting.daylight / 35
      if (node instanceof THREE.DirectionalLight && node.position.x > 0) node.intensity = .2 + project.lighting.fill / 90
      if (node instanceof THREE.PointLight) {
        const warmth = THREE.MathUtils.clamp((5000 - project.lighting.warmth) / 2600, 0, 1)
        node.color.setHSL(.1 - warmth * .07, .42, .68)
        node.intensity = 20 + project.lighting.fill * .55
      }
    })
  }, [project.lighting.daylight, project.lighting.fill, project.lighting.warmth])

  return <div className="scene-canvas"><div className="scene-render-host" ref={hostRef} />{assetReport && <div className={`asset-report${assetReport.includes('could not') ? ' failed' : ''}`}>{assetReport}</div>}</div>
}

