import type { Model } from '../types'

const defaultProvider = {
  provider: 'OpenAI Compatible' as const,
  modelId: 'community-model-id',
  openAIBaseUrl: 'https://api.example.com/v1',
  anthropicEndpoint: '',
  apiKeyLabel: 'RAZE_PROVIDER_KEY',
  cacheMode: 'Off' as const,
  cacheTtlSeconds: 300,
  cacheSystemPrompt: true,
  cacheTools: false,
  cacheLargeContext: true,
}

export const seedModels: Model[] = [
  {
    id: 'community.default',
    name: 'Community Default',
    description: 'Default test route. Replace this with a real OpenAI-compatible or Anthropic endpoint in Admin.',
    maxContext: 128000,
    status: 'Online',
    firstToken: 0.8,
    capabilities: ['Streaming', 'Tools', 'Files'],
    tags: ['Fast'],
    groups: ['Default'],
    featured: true,
    popularity: 1,
    added: '2026-04-24',
    gradient: 'linear-gradient(135deg, #050505, #6e5afd, #05c48b)',
    hoverDescription: 'Production placeholder route awaiting real provider credentials.',
    visibility: 'Public',
    launchAvailable: true,
    sortPriority: 1,
    providerConfig: defaultProvider,
  },
]

export const createBlankModel = (index: number): Model => ({
  id: `new.route.${index}`,
  name: `New Route ${index}`,
  description: 'Configure provider endpoint, caching, capabilities, visibility, and card media before launch.',
  maxContext: 128000,
  status: 'Coming Soon',
  capabilities: ['Streaming'],
  tags: [],
  groups: ['Draft'],
  featured: false,
  popularity: 0,
  added: new Date().toISOString().slice(0, 10),
  gradient: 'linear-gradient(135deg, #050505, #222831, #6e5afd)',
  hoverDescription: 'Draft route. Complete setup in Admin.',
  visibility: 'Hidden',
  launchAvailable: false,
  sortPriority: index,
  providerConfig: { ...defaultProvider, modelId: '' },
})

export const capabilityDescriptions: Record<string, string> = {
  Vision: 'Accepts image input for analysis, extraction, and visual reasoning.',
  Audio: 'Prepared for voice notes, sound input, and transcription workflows.',
  Video: 'Prepared for video-aware analysis and frame-based reasoning.',
  Files: 'Can inspect attached files and long documents when routed.',
  Tools: 'Can call configured tools through supported routes.',
  Reasoning: 'Optimized for deeper multi-step answers and planning.',
  Streaming: 'Returns output progressively while generating.',
  Multimodal: 'Combines multiple input types in one route.',
}
