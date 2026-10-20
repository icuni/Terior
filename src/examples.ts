import { freshScene } from './defaultScene'
import type { ProjectScene, SceneObject } from './types'

export interface RoomExample {
  id: string
  name: string
  description: string
  create: () => ProjectScene
}

const object = (value: SceneObject): SceneObject => value

export const roomExamples: RoomExample[] = [
  {
    id: 'cal-living-room',
    name: "Cal's living room",
    description: 'Warm linen, smoked oak and late afternoon light',
    create: () => freshScene(),
  },
  {
    id: 'quiet-bedroom',
    name: 'Quiet bedroom',
    description: 'A king bed with clear bedside circulation',
    create: () => ({
      format: 'terior-project', schemaVersion: 2, projectName: 'Quiet bedroom', revision: 1,
      room: { width: 4.8, depth: 5.2, height: 2.8, wallMaterial: 'Chalk', floorMaterial: 'Natural oak', showCeiling: false },
      lighting: { daylight: 81, warmth: 4600, fill: 34 },
      objects: [
        object({ id: 'bed-main', name: 'King bed', model: 'bed-king', kind: 'model', x: 0, z: -1.13, rotation: 0, width: 2.03, depth: 2.13, height: .78, material: 'Warm linen', locked: false, visible: true, estimated: 'Model proportions are approximate · verify against product dimensions' }),
        object({ id: 'nightstand-left', name: 'Nightstand', model: 'table-nightstand', kind: 'model', x: -1.47, z: -1.65, rotation: 0, width: .52, depth: .42, height: .58, material: 'Natural oak', locked: false, visible: true }),
        object({ id: 'nightstand-right', name: 'Nightstand 2', model: 'table-nightstand', kind: 'model', x: 1.47, z: -1.65, rotation: 0, width: .52, depth: .42, height: .58, material: 'Natural oak', locked: false, visible: true }),
        object({ id: 'bedroom-rug', name: 'Wool rug', model: null, kind: 'rug', x: 0, z: .1, rotation: 0, width: 2.7, depth: 2.3, height: .025, material: 'Natural wool', locked: false, visible: true }),
        object({ id: 'bedroom-chair', name: 'Occasional chair', model: 'chair-box', kind: 'model', x: 1.62, z: .85, rotation: -20, width: .72, depth: .72, height: .82, material: 'Moss velvet', locked: false, visible: true }),
      ],
      cameraViews: [
        { name: 'Overview', position: [3.7, 4.8, 7.5], target: [0, .7, -.1] },
        { name: 'Bed detail', position: [2.5, 2.5, 4.2], target: [0, .65, -1.1] },
      ], activeCamera: 'Overview', references: [], blenderBuilds: [],
    }),
  },
  {
    id: 'reading-corner',
    name: 'Reading corner',
    description: 'A compact lounge with layered light and storage',
    create: () => ({
      format: 'terior-project', schemaVersion: 2, projectName: 'Reading corner', revision: 1,
      room: { width: 4.4, depth: 3.8, height: 2.7, wallMaterial: 'Soft sage', floorMaterial: 'Walnut', showCeiling: false },
      lighting: { daylight: 59, warmth: 3350, fill: 39 },
      objects: [
        object({ id: 'reading-chair', name: 'Lounge chair', model: 'chair-sofa', kind: 'model', x: -.72, z: -.28, rotation: 12, width: .92, depth: .9, height: .83, material: 'Moss velvet', locked: false, visible: true, estimated: 'Approximate reference model' }),
        object({ id: 'reading-table', name: 'Side table', model: 'table-sit-circle', kind: 'model', x: .42, z: .05, rotation: 0, width: .62, depth: .62, height: .54, material: 'Natural oak', locked: false, visible: true }),
        object({ id: 'reading-lamp', name: 'Floor lamp', model: 'terior:floor-lamp', kind: 'model', x: 1.44, z: -.55, rotation: -22, width: .42, depth: .42, height: 1.62, material: 'Brushed brass', locked: false, visible: true }),
        object({ id: 'reading-shelf', name: 'Bookshelf', model: 'cabinet-bookshelf', kind: 'model', x: -1.7, z: -1.22, rotation: 0, width: .96, depth: .38, height: 1.68, material: 'Smoked oak', locked: false, visible: true }),
        object({ id: 'reading-rug', name: 'Wool rug', model: null, kind: 'rug', x: -.25, z: .25, rotation: -8, width: 2.25, depth: 1.9, height: .025, material: 'Natural wool', locked: false, visible: true }),
        object({ id: 'reading-plant', name: 'Potted olive', model: 'terior:olive-tree', kind: 'model', x: 1.7, z: -1.38, rotation: 18, width: .7, depth: .7, height: 1.55, material: 'Olive green', locked: false, visible: true }),
      ],
      cameraViews: [
        { name: 'Overview', position: [3.2, 3.2, 5.2], target: [0, .65, -.1] },
        { name: 'Reading seat', position: [-2.1, 1.9, 2.8], target: [-.25, .75, -.2] },
      ], activeCamera: 'Overview', references: [], blenderBuilds: [],
    }),
  },
]
