import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = path.join(root, 'examples', 'cal-s-living-room.terior')

class McpTestClient {
  constructor(projectPath, env = process.env) {
    this.child = spawn(process.execPath, [path.join(root, 'mcp-server', 'server.mjs'), '--project', projectPath], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })
    this.nextId = 1
    this.pending = new Map()
    this.messages = []
    this.buffer = ''
    this.stderr = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if (message.id !== undefined) {
          const waiter = this.pending.get(message.id)
          if (waiter) {
            this.pending.delete(message.id)
            clearTimeout(waiter.timer)
            waiter.resolve(message)
          }
        }
      }
    })
    this.child.stderr.on('data', chunk => { this.stderr += chunk })
    this.child.on('message', message => this.messages.push(message))
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}\n${this.stderr}`))
      }, 20000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  async start() {
    const response = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'terior-test', version: '1.0.0' },
    })
    assert.ok(response.result?.serverInfo, 'MCP server initialized')
    this.notify('notifications/initialized')
  }

  async call(name, args) {
    const response = await this.request('tools/call', { name, arguments: args })
    if (response.error) throw new Error(response.error.message)
    const result = response.result
    if (result?.isError) return { isError: true, text: result.content?.map(item => item.text ?? '').join('\n') ?? '' }
    const text = result?.content?.find(item => item.type === 'text')?.text ?? ''
    return { isError: false, text, value: text ? JSON.parse(text) : null }
  }

  waitForMessage(type, timeoutMs = 5000) {
    const existing = this.messages.find(message => message.type === type)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const poll = () => {
        const message = this.messages.find(item => item.type === type)
        if (message) resolve(message)
        else if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for child message ${type}\n${this.stderr}`))
        else setTimeout(poll, 10)
      }
      poll()
    })
  }

  send(message) { this.child.send(message) }

  async close() {
    for (const waiter of this.pending.values()) clearTimeout(waiter.timer)
    this.pending.clear()
    this.child.stdin.end()
    const exited = new Promise(resolve => this.child.once('exit', resolve))
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))])
    if (this.child.exitCode === null) this.child.kill()
  }
}

async function withProject(run, options = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'terior-mcp-test-'))
  const projectPath = path.join(tempDir, 'room.terior')
  const initialText = await readFile(fixturePath, 'utf8')
  await writeFile(projectPath, initialText, 'utf8')
  const client = options.startClient === false ? null : new McpTestClient(projectPath, options.env ?? process.env)
  try {
    await client?.start()
    await run({ client, projectPath, tempDir, initial: JSON.parse(initialText) })
  } finally {
    await client?.close()
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function clearProposal(projectPath, fixture) {
  await writeFile(projectPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
}

test('camera proposal updates its named non-active camera', async () => {
  await withProject(async ({ client, projectPath, initial }) => {
    const target = initial.cameraViews.find(view => view.name !== initial.activeCamera)
    assert.ok(target, 'fixture has a non-active saved camera')
    const result = await client.call('terior_propose_camera_pose', {
      expectedRevision: initial.revision,
      viewName: target.name,
      position: [1.25, 2.4, 3.1],
      target: [0.2, 0.7, -0.1],
    })
    assert.equal(result.isError, false)
    assert.equal(result.value.proposal.cameraPoseChange.name, target.name)
    const saved = JSON.parse(await readFile(projectPath, 'utf8'))
    assert.equal(saved.activeCamera, initial.activeCamera)
    assert.equal(saved.pendingProposal.cameraPoseChange.name, target.name)
  })
})

test('MCP object creation and dimension proposals stay pending for review', async () => {
  await withProject(async ({ client, projectPath, initial }) => {
    const created = await client.call('terior_propose_object_create', {
      expectedRevision: initial.revision,
      modelId: 'chair-sofa-wide',
      name: 'Cal test chair',
      x: 1.2,
      z: 0.4,
      width: 0.64,
      material: 'Oak and linen',
    })
    assert.equal(created.isError, false)
    assert.equal(created.value.proposal.objectAddition.name, 'Cal test chair')
    assert.equal(created.value.proposal.objectAddition.model, 'chair-sofa-wide')
    assert.match(created.value.proposal.objectAddition.estimated, /supplied width 0\.64 m/i)
    assert.match(created.value.proposal.objectAddition.estimated, /library estimates depth .* height/i)
    assert.match(created.value.proposal.summary, /Estimate:/)
    assert.deepEqual(
      [created.value.proposal.objectAddition.x, created.value.proposal.objectAddition.z, created.value.proposal.objectAddition.width],
      [1.2, 0.4, 0.64],
    )
    let saved = JSON.parse(await readFile(projectPath, 'utf8'))
    assert.equal(saved.pendingProposal.objectAddition.id, created.value.proposal.objectAddition.id)
    assert.equal(saved.objects.some(object => object.id === created.value.proposal.objectAddition.id), false)

    await clearProposal(projectPath, initial)
    const target = initial.objects.find(object => !object.locked && !object.dimensionsLocked)
    assert.ok(target, 'fixture has an unlocked object')
    const resized = await client.call('terior_propose_object_dimensions', {
      expectedRevision: initial.revision,
      objectId: target.id,
      width: target.width + 0.2,
      depth: target.depth + 0.05,
    })
    assert.equal(resized.isError, false)
    assert.equal(resized.value.proposal.objectChanges[0].width, target.width + 0.2)
    assert.equal(resized.value.proposal.objectChanges[0].depth, target.depth + 0.05)
    saved = JSON.parse(await readFile(projectPath, 'utf8'))
    assert.equal(saved.objects.find(object => object.id === target.id).width, target.width)
    assert.equal(saved.pendingProposal.objectChanges[0].id, target.id)
  })
})

test('dimension proposals respect dimension locks', async () => {
  await withProject(async ({ client, projectPath, initial }) => {
    const target = initial.objects[0]
    const locked = {
      ...initial,
      objects: initial.objects.map(object => object.id === target.id ? { ...object, dimensionsLocked: true } : object),
    }
    await writeFile(projectPath, `${JSON.stringify(locked, null, 2)}\n`, 'utf8')
    const result = await client.call('terior_propose_object_dimensions', {
      expectedRevision: initial.revision,
      objectId: target.id,
      width: target.width + 0.1,
    })
    assert.equal(result.isError, true)
    assert.match(result.text, /dimensions are locked/i)
    assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).pendingProposal, undefined)
  })
})

test('an autosave completed during an MCP proposal is preserved by the MCP write guard', async () => {
  await withProject(async ({ client, projectPath, tempDir, initial }) => {
    const preloadPath = path.join(tempDir, 'pause-read.cjs')
    await writeFile(preloadPath, `
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const { syncBuiltinESMExports } = require('node:module');
      const originalReadFile = fs.readFile;
      let paused = false;
      fs.readFile = async function(file, ...args) {
        const value = await originalReadFile.call(this, file, ...args);
        if (!paused && path.resolve(String(file)) === path.resolve(process.env.TERIOR_TEST_PROJECT)) {
          paused = true;
          process.send({ type: 'project-read-for-proposal' });
          await new Promise(resolve => process.once('message', message => {
            if (message.type === 'continue-after-autosave') resolve();
          }));
        }
        return value;
      };
      syncBuiltinESMExports();
    `, 'utf8')
    const env = {
      ...process.env,
      TERIOR_TEST_PROJECT: projectPath,
      NODE_OPTIONS: `--require="${preloadPath.replaceAll('\\', '/')}"`,
    }
    const raceClient = new McpTestClient(projectPath, env)
    try {
      await raceClient.start()
      const proposal = raceClient.call('terior_propose_camera_pose', {
        expectedRevision: initial.revision,
        viewName: initial.cameraViews.find(view => view.name !== initial.activeCamera)?.name ?? initial.activeCamera,
        position: [4, 2, 3],
        target: [0, 1, 0],
      })
      await raceClient.waitForMessage('project-read-for-proposal')
      const autosaved = {
        ...initial,
        revision: initial.revision + 1,
        objects: initial.objects.map((object, index) => index === 0 ? { ...object, x: object.x + 0.17 } : object),
      }
      const autosavedText = `${JSON.stringify(autosaved, null, 2)}\n`
      await writeFile(projectPath, autosavedText, 'utf8')
      raceClient.send({ type: 'continue-after-autosave' })
      const result = await proposal
      assert.equal(result.isError, true)
      assert.match(result.text, /changed while this proposal was being prepared/i)
      assert.equal(await readFile(projectPath, 'utf8'), autosavedText)
    } finally {
      await raceClient.close()
    }
  }, { startClient: false })
})
