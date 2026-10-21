import type { ModelLibraryItem } from './types'
import catalog from './model-catalog.json'

const preview = (model: string) => `${import.meta.env.BASE_URL}assets/models/storytellr/${model}.jpg`

export const modelLibrary: ModelLibraryItem[] = catalog.map(({ hasPreview, ...item }) => ({
  ...item,
  ...(hasPreview ? { preview: preview(item.model) } : {}),
}))

export function modelUrl(model: string): string {
  return `${import.meta.env.BASE_URL}assets/models/storytellr/${model}.glb`
}

export function findLibraryItem(model: string): ModelLibraryItem | undefined {
  return modelLibrary.find(item => item.model === model)
}
