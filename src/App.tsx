import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CacheMode, Capability, Model, ModelStatus, ProviderType, Visibility } from './types'
import { capabilityDescriptions, createBlankModel, seedModels } from './data/models'
import { changelog } from './data/changelog'

const views = ['Landing', 'Models', 'Playground', 'Dashboard', 'Changelog', 'Status'] as const
type View = (typeof views)[number] | 'Admin'

const filters = ['All', 'Online', 'Vision', 'Multimodal', 'Fast', 'Long Context', 'Experimental', 'New', 'Staff Picks']
const sortOptions = ['Priority', 'Fastest', 'Longest Context', 'Recently Added', 'Alphabetical']
const adminTabs = ['Overview', 'Models', 'Routing', 'Caching', 'Visibility & Access', 'Privacy / Logs', 'Branding', 'Changelog / Releases']
const capabilities: Capability[] = ['Vision', 'Audio', 'Video', 'Files', 'Tools', 'Reasoning', 'Streaming', 'Multimodal']
const providerTypes: ProviderType[] = ['OpenAI Compatible', 'Anthropic', 'Custom']
const cacheModes: CacheMode[] = ['Off', 'Anthropic Prompt Cache', 'OpenAI Compatible Cache', 'Hybrid']
const statuses: ModelStatus[] = ['Online', 'Offline', 'Coming Soon', 'Degraded']
const visibilities: Visibility[] = ['Public', 'Hidden', 'Staff Only', 'Preview']

function App() {
  const [view, setView] = useState<View>('Landing')
  const [models, setModels] = useState<Model[]>(seedModels)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Priority')
  const [focusedCard, setFocusedCard] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [adminGateOpen, setAdminGateOpen] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [accessMode, setAccessMode] = useState<'Guest' | 'Preview' | 'Google Test' | 'Admin Test'>('Guest')
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState('')
  const [adminTab, setAdminTab] = useState('Overview')
  const [selectedModelId, setSelectedModelId] = useState(seedModels[0].id)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setAdminGateOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0]
  const featuredModels = models.filter((model) => model.featured && model.visibility !== 'Hidden')

  const visibleModels = useMemo(() => {
    const filtered = models.filter((model) => {
      if (model.visibility === 'Hidden') return false
      if (filter === 'All') return true
      if (filter === 'Online') return model.status === 'Online'
      return model.tags.includes(filter) || model.groups.includes(filter) || model.capabilities.includes(filter as Capability)
    })

    return [...filtered].sort((a, b) => {
      if (sort === 'Fastest') return (a.firstToken ?? 99) - (b.firstToken ?? 99)
      if (sort === 'Longest Context') return b.maxContext - a.maxContext
      if (sort === 'Recently Added') return b.added.localeCompare(a.added)
      if (sort === 'Alphabetical') return a.name.localeCompare(b.name)
      return a.sortPriority - b.sortPriority
    })
  }, [filter, models, sort])

  const copyId = async (id: string) => {
    await navigator.clipboard?.writeText(id)
    setCopied(id)
    window.setTimeout(() => setCopied(''), 1200)
  }

  const updateModel = (patch: Partial<Model>) => {
    setModels((current) => current.map((model) => (model.id === selectedModel.id ? { ...model, ...patch } : model)))
  }

  const addModel = () => {
    const next = createBlankModel(models.length + 1)
    setModels((current) => [...current, next])
    setSelectedModelId(next.id)
    setAdminTab('Models')
  }

  const unlockAdmin = () => {
    if (password === '1234') {
      setAdminUnlocked(true)
      setAccessMode('Admin Test')
      setAdminGateOpen(false)
      setPassword('')
      setView('Admin')
    }
  }

  return (
    <>
      <nav className="top-nav">
        <button className="wordmark ghost-button" onClick={() => setView('Landing')}>RAZE</button>
        <div className="nav-links">
          {views.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
        </div>
        <button className="launch-btn" onClick={() => setLoginOpen(true)}><span /> Launch</button>
      </nav>

      <main className="app-frame">
        {view === 'Landing' && <Landing setView={setView} openLogin={() => setLoginOpen(true)} models={featuredModels} focusedCard={focusedCard} setFocusedCard={setFocusedCard} copyId={copyId} copied={copied} />}
        {view === 'Models' && <ModelsView filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} visibleModels={visibleModels} copyId={copyId} copied={copied} />}
        {view === 'Playground' && <Playground models={visibleModels} />}
        {view === 'Dashboard' && <Dashboard accessMode={accessMode} setView={setView} openLogin={() => setLoginOpen(true)} />}
        {view === 'Admin' && adminUnlocked && <AdminPanel models={models} selectedModel={selectedModel} selectedModelId={selectedModelId} setSelectedModelId={setSelectedModelId} adminTab={adminTab} setAdminTab={setAdminTab} updateModel={updateModel} addModel={addModel} toggleCapability={(cap) => toggleCapability(selectedModel, updateModel, cap)} />}
        {view === 'Admin' && !adminUnlocked && <LockedAdmin openGate={() => setAdminGateOpen(true)} />}
        {view === 'Changelog' && <Changelog />}
        {view === 'Status' && <ControlCenter />}
      </main>

      {loginOpen && <LoginModal close={() => setLoginOpen(false)} setAccessMode={setAccessMode} />}
      {adminGateOpen && <AdminGate password={password} setPassword={setPassword} close={() => setAdminGateOpen(false)} submit={unlockAdmin} />}
    </>
  )
}

function Landing({ setView, openLogin, models, focusedCard, setFocusedCard, copyId, copied }: { setView: (view: View) => void; openLogin: () => void; models: Model[]; focusedCard: string | null; setFocusedCard: (id: string | null) => void; copyId: (id: string) => void; copied: string }) {
  return <section className="hero view-shell"><div className="hero-copy"><p className="eyebrow">test router / admin-configured / free community access</p><h1>RAZE routes your server’s AI models from one control surface.</h1><p className="hero-lede">A production-minded test shell for model discovery, route testing, endpoint configuration, caching policy, and community access.</p><div className="hero-actions"><button className="primary" onClick={openLogin}>Launch App</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button><button className="secondary" onClick={() => setView('Models')}>Explore Models</button></div><div className="test-strip">Admin is hidden. Press <b>Ctrl + M</b>, then enter <b>1234</b>.</div></div><TerminalHero /><StatsBar /><section className="showcase-panel"><div><p className="eyebrow">model.cards</p><h2>Configured by admins, rendered live.</h2><p>Cards use admin media URLs when they load and fall back cleanly when browsers block playback.</p></div><div className="showcase-grid">{models.length ? models.map((model) => <ModelCard key={model.id} model={model} mode="showcase" focused={focusedCard === model.id} dimmed={Boolean(focusedCard && focusedCard !== model.id)} onFocus={setFocusedCard} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No featured routes" body="Feature a model in Admin to show it here." />}</div></section></section>
}

function TerminalHero() {
  return <div className="terminal-card"><div className="terminal-top"><span>RAZE://BOOT</span><i /></div><div className="kinetic-word" aria-label="RAZE"><span>R</span><span>A</span><span>Z</span><span>E</span></div><div className="boot-lines">{['loading local registry', 'checking configured providers', 'preparing cache policy', 'standing by for route test'].map((line, index) => <p key={line} style={{ animationDelay: `${index * 180}ms` }}>&gt; {line}</p>)}<p className="operational">&gt; test shell ready <b>_</b></p></div></div>
}

function StatsBar() {
  const stats = [['MODELS CONFIGURED', '1'], ['AUTH MODE', 'TEST'], ['ADMIN ACCESS', 'CTRL+M'], ['CACHE MODES', '4'], ['PROVIDERS', '3'], ['ACCESS', 'FREE']]
  return <section className="stats-bar">{stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</section>
}

function ModelsView({ filter, setFilter, sort, setSort, visibleModels, copyId, copied }: { filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; visibleModels: Model[]; copyId: (id: string) => void; copied: string }) {
  return <section className="view-shell registry-section"><div className="section-heading split-heading"><div><p className="eyebrow">registry</p><h2>Model Registry</h2><p>Only configured, visible routes appear here. Add real providers from the hidden admin panel.</p></div><div className="registry-readout">visible / {visibleModels.length}</div></div><div className="toolbar"><div className="chip-row">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'chip active' : 'chip'}>{item}</button>)}</div><select value={sort} onChange={(event) => setSort(event.target.value)}>{sortOptions.map((item) => <option key={item}>{item}</option>)}</select></div><div className="model-grid">{visibleModels.length ? visibleModels.map((model) => <ModelCard key={model.id} model={model} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No visible routes" body="Use Ctrl+M to unlock Admin and publish a route." />}</div></section>
}

function VideoBackground({ url, title }: { url?: string; title: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (!url || failed) return <div className="video-fallback"><span>{failed ? 'video failed to load' : 'no video url'}</span></div>
  return <video key={url} src={url} title={`${title} background video`} autoPlay muted loop playsInline preload="metadata" crossOrigin="anonymous" onError={() => setFailed(true)} onStalled={() => setFailed(true)} />
}

function ModelCard({ model, mode, focused, dimmed, onFocus, onCopy, copied }: { model: Model; mode?: 'showcase'; focused?: boolean; dimmed?: boolean; onFocus?: (id: string | null) => void; onCopy: (id: string) => void; copied: boolean }) {
  return <article className={`model-card ${mode === 'showcase' ? 'portrait' : ''} ${dimmed ? 'dimmed' : ''} ${focused ? 'focused' : ''}`} onMouseEnter={() => onFocus?.(model.id)} onMouseLeave={() => onFocus?.(null)} style={{ '--card-gradient': model.gradient } as CSSProperties}><VideoBackground url={model.videoUrl} title={model.name} /><div className="card-shade" /><div className="model-card-content"><StatusPill status={model.status} /><div className="model-main"><h3>{model.name}</h3><button className="copy-id" onClick={() => onCopy(model.id)}>{copied ? 'copied' : model.id}</button><p>{model.description}</p></div><div className="model-meta"><span>{Math.round(model.maxContext / 1000)}K ctx</span><span>{model.providerConfig.provider}</span><span>{model.providerConfig.cacheMode}</span></div><div className="cap-icons">{model.capabilities.map((cap) => <CapabilityIcon key={cap} capability={cap} />)}</div></div></article>
}

function StatusPill({ status }: { status: ModelStatus }) {
  return <span className={`status status-${status.toLowerCase().replace(/ /g, '-')}`}>{status}</span>
}

function CapabilityIcon({ capability }: { capability: Capability }) {
  return <span className="cap-icon">{capability.slice(0, 2)}<em>{capabilityDescriptions[capability]}</em></span>
}

function Playground({ models }: { models: Model[] }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are routed through RAZE. Be direct and useful.')
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const requestPreview = model ? { provider: model.providerConfig.provider, model: model.providerConfig.modelId || model.id, cache: model.providerConfig.cacheMode, endpoint: model.providerConfig.provider === 'Anthropic' ? model.providerConfig.anthropicEndpoint || 'not configured' : model.providerConfig.openAIBaseUrl || 'not configured' } : null
  return <section className="view-shell playground-view"><div className="section-heading"><p className="eyebrow">playground</p><h2>Route test workspace.</h2><p>Build and inspect a provider request before a backend router is connected.</p></div><div className="playground-grid"><div className="prompt-panel"><div className="panel-top"><span>compose</span><span>{model?.status ?? 'no model'}</span></div><label>Route<select value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>System prompt<textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></label><label>User prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Type a prompt to test routing shape..." /></label><div className="prompt-actions"><button className="primary" disabled={!model || !prompt.trim()}>Validate Route</button><span>{prompt.trim() ? 'request shape ready' : 'waiting for prompt'}</span></div></div><div className="request-panel"><div className="panel-top"><span>request preview</span><span>local only</span></div><pre>{JSON.stringify({ ...requestPreview, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt || '<prompt>' }] }, null, 2)}</pre><div className="route-output"><b>No fake output.</b><p>This test build previews the request shape only. Real responses require a backend proxy with secret storage.</p></div></div></div></section>
}

function Dashboard({ accessMode, setView, openLogin }: { accessMode: string; setView: (view: View) => void; openLogin: () => void }) {
  return <section className="view-shell dashboard-section"><div className="section-heading"><p className="eyebrow">dashboard</p><h2>Command center.</h2><p>Production shell with real-data empty states instead of fake usage history.</p></div><div className="dashboard-grid"><article className="wide-panel"><p className="eyebrow">identity</p><h3>{accessMode === 'Guest' ? 'Not signed in' : accessMode}</h3><p>Google and Discord identity are placeholders until backend auth is connected.</p><button className="primary" onClick={openLogin}>Change access mode</button></article><article><span>Recent sessions</span><p>No sessions yet.</p></article><article><span>Pinned models</span><p>No pinned routes yet.</p></article><article><span>Saved presets</span><p>No presets yet.</p></article><article><span>Status feed</span><p>Local frontend is ready.</p></article><article><span>Next action</span><p>Press Ctrl+M to configure providers.</p><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button></article></div></section>
}

function AdminPanel(props: { models: Model[]; selectedModel: Model; selectedModelId: string; setSelectedModelId: (id: string) => void; adminTab: string; setAdminTab: (tab: string) => void; updateModel: (patch: Partial<Model>) => void; addModel: () => void; toggleCapability: (cap: Capability) => void }) {
  const { models, selectedModel, selectedModelId, setSelectedModelId, adminTab, setAdminTab, updateModel, addModel, toggleCapability } = props
  const updateProvider = (patch: Partial<Model['providerConfig']>) => updateModel({ providerConfig: { ...selectedModel.providerConfig, ...patch } })
  return <section className="view-shell admin-section"><div className="section-heading split-heading"><div><p className="eyebrow">admin / unlocked</p><h2>Registry control panel.</h2><p>Configure routes, provider endpoints, cache behavior, visibility, and card media locally.</p></div><button className="primary" onClick={addModel}>Add Model</button></div><div className="admin-layout"><aside>{adminTabs.map((tab) => <button key={tab} onClick={() => setAdminTab(tab)} className={adminTab === tab ? 'active' : ''}>{tab}</button>)}</aside><div className="admin-workspace"><div className="panel-top"><span>{adminTab}</span><span>local test config</span></div>{adminTab === 'Models' ? <div className="model-editor"><select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select><input value={selectedModel.name} onChange={(event) => updateModel({ name: event.target.value })} placeholder="Display name" /><input value={selectedModel.id} onChange={(event) => updateModel({ id: event.target.value })} placeholder="Internal route ID" /><textarea value={selectedModel.description} onChange={(event) => updateModel({ description: event.target.value })} placeholder="Description" /><input type="number" value={selectedModel.maxContext} onChange={(event) => updateModel({ maxContext: Number(event.target.value) })} /><select value={selectedModel.status} onChange={(event) => updateModel({ status: event.target.value as ModelStatus })}>{statuses.map((item) => <option key={item}>{item}</option>)}</select><select value={selectedModel.visibility} onChange={(event) => updateModel({ visibility: event.target.value as Visibility })}>{visibilities.map((item) => <option key={item}>{item}</option>)}</select><input value={selectedModel.videoUrl ?? ''} onChange={(event) => updateModel({ videoUrl: event.target.value })} placeholder="Video background URL (.mp4/.webm recommended)" /><input value={selectedModel.gradient} onChange={(event) => updateModel({ gradient: event.target.value })} placeholder="Fallback CSS gradient" /><label><input type="checkbox" checked={selectedModel.featured} onChange={(event) => updateModel({ featured: event.target.checked })} /> Featured card</label><label><input type="checkbox" checked={selectedModel.launchAvailable} onChange={(event) => updateModel({ launchAvailable: event.target.checked })} /> Launch available</label><div className="chip-row">{capabilities.map((cap) => <button key={cap} className={selectedModel.capabilities.includes(cap) ? 'chip active' : 'chip'} onClick={() => toggleCapability(cap)}>{cap}</button>)}</div><ProviderEditor model={selectedModel} updateProvider={updateProvider} /><div className="preview-note">If a video link does not preview, the host likely blocks browser playback, CORS, hotlinking, or the file is not direct MP4/WebM. The card now shows that failure instead of silently disappearing.</div><ModelCard model={selectedModel} mode="showcase" onCopy={() => undefined} copied={false} /></div> : <AdminPlaceholder tab={adminTab} model={selectedModel} updateProvider={updateProvider} />}</div></div></section>
}

function ProviderEditor({ model, updateProvider }: { model: Model; updateProvider: (patch: Partial<Model['providerConfig']>) => void }) {
  return <div className="provider-editor"><h3>Provider + cache</h3><select value={model.providerConfig.provider} onChange={(event) => updateProvider({ provider: event.target.value as ProviderType })}>{providerTypes.map((item) => <option key={item}>{item}</option>)}</select><input value={model.providerConfig.modelId} onChange={(event) => updateProvider({ modelId: event.target.value })} placeholder="Provider model ID" /><input value={model.providerConfig.openAIBaseUrl} onChange={(event) => updateProvider({ openAIBaseUrl: event.target.value })} placeholder="OpenAI-compatible base URL" /><input value={model.providerConfig.anthropicEndpoint} onChange={(event) => updateProvider({ anthropicEndpoint: event.target.value })} placeholder="Anthropic custom endpoint" /><input value={model.providerConfig.apiKeyLabel} onChange={(event) => updateProvider({ apiKeyLabel: event.target.value })} placeholder="Secret label, not the key" /><select value={model.providerConfig.cacheMode} onChange={(event) => updateProvider({ cacheMode: event.target.value as CacheMode })}>{cacheModes.map((item) => <option key={item}>{item}</option>)}</select><input type="number" value={model.providerConfig.cacheTtlSeconds} onChange={(event) => updateProvider({ cacheTtlSeconds: Number(event.target.value) })} /><label><input type="checkbox" checked={model.providerConfig.cacheSystemPrompt} onChange={(event) => updateProvider({ cacheSystemPrompt: event.target.checked })} /> Cache stable system prompt</label><label><input type="checkbox" checked={model.providerConfig.cacheTools} onChange={(event) => updateProvider({ cacheTools: event.target.checked })} /> Cache tool schema prefix</label><label><input type="checkbox" checked={model.providerConfig.cacheLargeContext} onChange={(event) => updateProvider({ cacheLargeContext: event.target.checked })} /> Cache large context prefix</label></div>
}

function AdminPlaceholder({ tab, model, updateProvider }: { tab: string; model: Model; updateProvider: (patch: Partial<Model['providerConfig']>) => void }) {
  if (tab === 'Caching' || tab === 'Routing') return <ProviderEditor model={model} updateProvider={updateProvider} />
  return <div className="admin-placeholder"><h3>{tab}</h3><p>No fake operational data. This panel is ready for real backend-backed controls.</p><code>selected / {model.id}</code></div>
}

function LockedAdmin({ openGate }: { openGate: () => void }) {
  return <section className="view-shell locked-admin"><p className="eyebrow">admin locked</p><h2>Hidden control panel.</h2><p>Press Ctrl+M or use the unlock button for the test code gate.</p><button className="primary" onClick={openGate}>Unlock Admin</button></section>
}

function ControlCenter() {
  return <section className="view-shell control-section"><div className="status-panel"><p>RAZE://STATUS</p><span>frontend shell ready</span><span>backend router not connected</span><span>admin gate active</span><span>access free</span><b>TEST STATE: READY</b></div><div className="faq-list">{['Free community app', 'Google auth placeholder', 'Ctrl+M admin gate', 'Real endpoints configured in Admin'].map((item) => <div key={item} className="faq-item"><b>{item}</b><span>Production behavior is represented without fake usage data or commerce flows.</span></div>)}</div></section>
}

function Changelog() {
  return <section className="view-shell changelog-section"><div className="section-heading"><p className="eyebrow">release.history</p><h2>Versioned test builds.</h2></div><div className="release-grid">{changelog.map((entry) => <article key={entry.version}><span>{entry.status}</span><h3>{entry.version}</h3><p>{entry.label}</p><ul>{entry.notes.map((note) => <li key={note}>{note}</li>)}</ul></article>)}</div></section>
}

function LoginModal({ close, setAccessMode }: { close: () => void; setAccessMode: (mode: 'Preview' | 'Google Test') => void }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">test build access</p><h2>Launch RAZE</h2><p>Google login is a non-functional test placeholder. Admin access is separate: Ctrl+M + 1234.</p><button className="primary" onClick={() => { setAccessMode('Google Test'); close() }}>Continue with Google</button><button className="skip" onClick={() => { setAccessMode('Preview'); close() }}>Skip for now</button><small>Testing only. Replace before production deployment.</small></div></div>
}

function AdminGate({ password, setPassword, close, submit }: { password: string; setPassword: (value: string) => void; close: () => void; submit: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">ctrl+m admin gate</p><h2>Enter admin code</h2><p>Temporary test code only.</p><div className="password-row"><input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} autoFocus placeholder="Admin code" type="password" /><button onClick={submit}>Unlock</button></div><small>Test code: 1234</small></div></div>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>
}

function toggleCapability(selectedModel: Model, updateModel: (patch: Partial<Model>) => void, capability: Capability) {
  const exists = selectedModel.capabilities.includes(capability)
  updateModel({ capabilities: exists ? selectedModel.capabilities.filter((item) => item !== capability) : [...selectedModel.capabilities, capability] })
}

export default App
