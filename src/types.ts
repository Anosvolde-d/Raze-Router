export type ModelStatus = 'Online' | 'Offline' | 'Coming Soon' | 'Degraded'

export type Capability =
  | 'Vision'
  | 'Audio'
  | 'Video'
  | 'Files'
  | 'Tools'
  | 'Reasoning'
  | 'Streaming'
  | 'Multimodal'

export type Model = {
  id: string
  name: string
  description: string
  maxContext: number
  status: ModelStatus
  firstToken?: number
  capabilities: Capability[]
  tags: string[]
  groups: string[]
  featured: boolean
  popularity: number
  added: string
  videoUrl?: string
  gradient: string
  hoverDescription: string
  visibility: 'Public' | 'Hidden' | 'Staff Only' | 'Preview'
  launchAvailable: boolean
  sortPriority: number
}

export type ChangelogEntry = {
  version: string
  label: string
  date: string
  status: 'Live' | 'Planned'
  notes: string[]
}
