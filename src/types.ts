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

export type ProviderType = 'OpenAI Compatible' | 'Anthropic' | 'Custom'
export type CacheMode = 'Off' | 'Anthropic Prompt Cache' | 'OpenAI Compatible Cache' | 'Hybrid'
export type Visibility = 'Public' | 'Hidden' | 'Staff Only' | 'Preview'

export type ProviderConfig = {
  provider: ProviderType
  modelId: string
  openAIBaseUrl: string
  anthropicEndpoint: string
  apiKeyLabel: string
  cacheMode: CacheMode
  cacheTtlSeconds: number
  cacheSystemPrompt: boolean
  cacheTools: boolean
  cacheLargeContext: boolean
}

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
  visibility: Visibility
  launchAvailable: boolean
  sortPriority: number
  providerConfig: ProviderConfig
}

export type ChangelogEntry = {
  version: string
  label: string
  date: string
  status: 'Live' | 'Planned'
  notes: string[]
}
