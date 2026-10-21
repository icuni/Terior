async page => {
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto('http://127.0.0.1:5181/')
  await page.waitForFunction(() => !document.body.innerText.includes('Loading scene assets'), null, { timeout: 30000 })
  await page.evaluate(async () => {
    const response = await fetch('/examples/cal-s-living-room.terior')
    if (!response.ok) throw new Error(`Example project request failed: ${response.status}`)
    const project = await response.json()
    const object = {
      id: 'mcp-ui-preview-chair',
      name: 'AI preview chair',
      model: 'chair-modern',
      kind: 'model',
      x: 1.2,
      z: 0.25,
      rotation: 12,
      width: 0.64,
      depth: 0.58,
      height: 0.86,
      material: 'Oak and linen',
      estimated: 'Approximate reference asset · supplied width 0.64 m; library estimated depth and height; geometry remains approximate',
      locked: false,
      dimensionsLocked: false,
      visible: true,
    }
    project.pendingProposal = {
      id: 'mcp-ui-preview',
      baseRevision: project.revision,
      summary: 'Propose adding AI preview chair at X 1.20 m, Z 0.25 m, rotation 12°. Size: 0.64 W × 0.58 D × 0.86 H m. Material: Oak and linen.',
      objectAddition: object,
    }
    localStorage.setItem('terior-project-v1', JSON.stringify(project))
  })
  await page.reload()
  await page.getByText('IDE proposal', { exact: true }).waitFor()
  const previewShown = await page.getByText('0.64 W × 0.58 D × 0.86 H m · Oak and linen').isVisible()
  const estimateShown = await page.getByText('Approximate reference asset · supplied width 0.64 m; library estimated depth and height; geometry remains approximate').isVisible()
  await page.locator('.apply-button').click()
  const objectAdded = await page.getByRole('button', { name: 'AI preview chair', exact: true }).isVisible()
  const dimensionsVisible = await page.getByRole('spinbutton', { name: 'W m' }).inputValue()
  const sceneAssetErrors = consoleErrors.filter(message => /Content Security Policy|GLTFLoader|Couldn't load texture/i.test(message))
  if (sceneAssetErrors.length) throw new Error(`Scene asset loading failed:\n${sceneAssetErrors.join('\n')}`)
  await page.getByRole('button', { name: 'Sofa', exact: true }).click()
  const screenshot = '.playwright-cli/terior-mcp-proposal.png'
  await page.screenshot({ path: screenshot, fullPage: true })
  return { previewShown, estimateShown, objectAdded, widthAfterApply: dimensionsVisible, sceneAssetErrors, screenshot }
}
