import { readFile, rename, stat, unlink, writeFile, open } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

const args = process.argv.slice(2)
const projectArg = args.findIndex(value => value === '--project')
const projectPath = path.resolve(projectArg >= 0 ? args[projectArg + 1] ?? '' : process.env.TERIOR_PROJECT ?? '')
if (!projectPath || projectPath === path.resolve('.')) {
  console.error('Set TERIOR_PROJECT or pass --project <absolute-path-to-project.terior>.')
  process.exit(2)
}

const label = 'Terior scene tools'
const number = z.number().finite().min(-100).max(100)

async function withProjectLock(run) {
  const lockPath = `${projectPath}.terior-lock`
  let lock
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      lock = await open(lockPath, 'wx')
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > 30_000) await unlink(lockPath)
      } catch { /* another client released the lock */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  if (!lock) throw new Error('The Terior project is busy. Retry in a moment.')
  try {
    const raw = await readFile(projectPath, 'utf8')
    const project = JSON.parse(raw)
    if (project.format !== 'terior-project' || ![1, 2].includes(project.schemaVersion) || !Array.isArray(project.objects) || !Array.isArray(project.cameraViews)) throw new Error('The selected file is not a supported Terior project.')
    project.schemaVersion = 2
    project.references ??= []
    const result = await run(project)
    if (result.write) {
      const latestRaw = await readFile(projectPath, 'utf8')
      if (latestRaw !== raw) throw new Error('The Terior project changed while this proposal was being prepared. Read the scene again before retrying.')
      const temporaryPath = `${projectPath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temporaryPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
        await rename(temporaryPath, projectPath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => {})
        throw error
      }
    }
    return result.value
  } finally {
    await lock.close()
    await unlink(lockPath).catch(() => {})
  }
}

function checkRevision(project, expectedRevision) {
  if (project.revision !== expectedRevision) throw new Error(`Revision conflict: expected r${expectedRevision}, current project is r${project.revision}. Read the scene again before proposing another change.`)
  if (project.pendingProposal) throw new Error('A proposal is already waiting in Terior. Ask the user to apply or dismiss it before creating another.')
}

function pending(project, proposal) {
  project.pendingProposal = { ...proposal, id: randomUUID(), baseRevision: project.revision }
  return { write: true, value: { message: 'Proposal written. Terior will show it for human review; the scene revision does not change until the user applies it.', proposal: project.pendingProposal } }
}

const server = new McpServer({ name: 'terior-scene-tools', version: '0.2.0' })

server.registerTool('terior_scene_read', {
  title: 'Read Terior scene',
  description: 'Read the current room, objects, saved cameras, references and scene revision from the open .terior project.',
  inputSchema: z.object({}),
}, async () => {
  const scene = await withProjectLock(project => ({
    write: false,
    value: {
      format: project.format,
      schemaVersion: project.schemaVersion,
      projectName: project.projectName,
      revision: project.revision,
      room: project.room,
      lighting: project.lighting,
      activeCamera: project.activeCamera,
      cameraViews: project.cameraViews,
      objects: project.objects.map(({ id, name, model, x, z, rotation, width, depth, height, material, locked, dimensionsLocked, visible, estimated }) => ({ id, name, model, x, z, rotation, width, depth, height, material, locked, dimensionsLocked, visible, estimated })),
      references: project.references.map(({ id, name, mimeType, placement, note }) => ({ id, name, mimeType, placement, note })),
      pendingProposal: project.pendingProposal ?? null,
    },
  }))
  return { content: [{ type: 'text', text: JSON.stringify(scene, null, 2) }] }
})

server.registerTool('terior_propose_object_transform', {
  title: 'Propose object transform',
  description: 'Propose a move or rotation for a Terior object. The editor will show a preview; the scene only changes after the user applies it. Always include the revision returned by terior_scene_read.',
  inputSchema: z.object({
    expectedRevision: z.number().int().positive(),
    objectId: z.string().min(1),
    x: number.optional(),
    z: number.optional(),
    rotation: z.number().finite().min(-360).max(360).optional(),
  }).refine(value => value.x !== undefined || value.z !== undefined || value.rotation !== undefined, { message: 'Specify x, z or rotation.' }),
}, async ({ expectedRevision, objectId, x, z, rotation }) => {
  const result = await withProjectLock(project => {
    checkRevision(project, expectedRevision)
    const current = project.objects.find(object => object.id === objectId)
    if (!current) throw new Error(`Object ${objectId} is not in this scene.`)
    if (current.locked) throw new Error(`${current.name} is locked. Ask the user to unlock it before proposing a change.`)
    const change = { ...current, ...(x === undefined ? {} : { x }), ...(z === undefined ? {} : { z }), ...(rotation === undefined ? {} : { rotation }) }
    const parts = []
    if (x !== undefined || z !== undefined) parts.push(`move ${current.name} to X ${change.x.toFixed(2)} m, Z ${change.z.toFixed(2)} m`)
    if (rotation !== undefined) parts.push(`rotate ${current.name} to ${change.rotation.toFixed(1)}°`)
    return pending(project, { summary: `Proposed ${parts.join(' and ')}.`, objectChanges: [change] })
  })
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.registerTool('terior_propose_camera_pose', {
  title: 'Propose camera position',
  description: 'Propose a saved camera position and aim point in metres. Terior previews this against the current revision; the user applies or dismisses the proposal.',
  inputSchema: z.object({
    expectedRevision: z.number().int().positive(),
    viewName: z.string().min(1).optional(),
    position: z.tuple([number, number, number]),
    target: z.tuple([number, number, number]),
  }),
}, async ({ expectedRevision, viewName, position, target }) => {
  const result = await withProjectLock(project => {
    checkRevision(project, expectedRevision)
    const active = viewName ?? project.activeCamera
    if (!project.cameraViews.some(view => view.name === active)) throw new Error(`Saved camera “${active}” was not found.`)
    return pending(project, {
      summary: `Place camera “${active}” at (${position.map(value => value.toFixed(2)).join(', ')}) m and aim at (${target.map(value => value.toFixed(2)).join(', ')}) m.`,
      cameraPoseChange: { name: active, position, target },
    })
  })
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.registerTool('terior_propose_reference_image', {
  title: 'Attach an IDE image to Terior',
  description: 'Add a local JPEG, PNG or WebP image as a photographic reference plane proposal. This image remains a 2D reference; it is not reconstructed into 3D. Terior asks the user to review before adding it.',
  inputSchema: z.object({
    expectedRevision: z.number().int().positive(),
    filePath: z.string().min(1),
    name: z.string().max(120).optional(),
    imageWidth: z.number().positive().max(20000).optional(),
    imageHeight: z.number().positive().max(20000).optional(),
  }),
}, async ({ expectedRevision, filePath, name, imageWidth, imageHeight }) => {
  const absolutePath = path.resolve(filePath)
  const extension = path.extname(absolutePath).toLowerCase()
  const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : null
  if (!mimeType) throw new Error('Use a local JPEG, PNG or WebP file.')
  const bytes = await readFile(absolutePath)
  if (bytes.length > 900_000) throw new Error('This image is larger than 900 KB. Paste or drag it into Terior to let the editor resize it safely.')
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
  const result = await withProjectLock(project => {
    checkRevision(project, expectedRevision)
    if (project.references.length >= 5) throw new Error('The project already has five image references.')
    if (project.references.reduce((sum, item) => sum + (item.dataUrl?.length ?? 0), 0) + dataUrl.length > 3_800_000) throw new Error('The project image-reference limit is reached. Remove a reference or use a smaller image.')
    const aspect = (imageWidth ?? 1200) / (imageHeight ?? 900)
    let width = Math.min(1.5, project.room.width * .34, 1.55 * aspect)
    let height = width / aspect
    if (height > 1.55) { height = 1.55; width = height * aspect }
    const reference = {
      id: `reference-${randomUUID().slice(0, 10)}`,
      name: name ?? path.basename(absolutePath),
      mimeType,
      dataUrl,
      placement: { x: 0, y: Math.min(project.room.height * .55, project.room.height - height / 2 - .08), z: -project.room.depth / 2 + .14, width, height, rotation: 0, visible: true },
      note: 'Photographic reference plane · 2D image only. It does not contain or imply an editable 3D model.',
    }
    return pending(project, { summary: `Propose attaching “${reference.name}” as a labelled 2D photographic reference plane.`, referenceAddition: reference })
  })
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

console.error(`${label} listening on stdio for ${projectPath}`)
await serveStdio(() => server)
