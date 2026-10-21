async page => {
  const downloadReady = page.waitForEvent('download', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: /GLB scene/ }).click()
  const download = await downloadReady
  return {
    path: await download.path(),
    filename: download.suggestedFilename(),
    title: await page.title(),
  }
}
