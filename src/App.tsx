import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CacheMode, Capability, Model, ModelStatus, ProviderType, Visibility } from './types'
import { capabilityDescriptions, createBlankModel, seedModels } from './data/models'
import { changelog } from './data/changelog'
import { clearUserApiKey, clearUserSession, createUserApiKey, fetchAdminConfig, fetchPublicConfig, fetchUserSession, getStoredAdminKey, getUserApiKey, saveAdminConfig, saveProviderSecret, sendChatCompletion, setStoredAdminKey, startGoogleAuth, storeUserApiKey, uploadAvatar, verifyAdminKey, type UserProfile } from './api'

const views = ['Landing', 'Models', 'Playground', 'Dashboard', 'Changelog', 'Status'] as const
type View = (typeof views)[number] | 'Admin'

const filters = ['All', 'Online', 'Vision', 'Multimodal', 'Fast', 'Long Context', 'Experimental', 'New', 'Staff Picks']
const sortOptions = ['Priority', 'Fastest', 'Longest Context', 'Recently Added', 'Alphabetical']
const adminTabs = ['Overview', 'Models', 'Groups', 'Routing', 'Caching', 'Visibility & Access', 'Privacy / Logs', 'Branding', 'Changelog / Releases']
const capabilities: Capability[] = ['Vision', 'Audio', 'Video', 'Files', 'Tools', 'Reasoning', 'Streaming', 'Multimodal']
const providerTypes: ProviderType[] = ['OpenAI Compatible', 'Anthropic', 'Custom']
const cacheModes: CacheMode[] = ['Off', 'Anthropic Prompt Cache', 'OpenAI Compatible Cache', 'Hybrid']
const statuses: ModelStatus[] = ['Online', 'Offline', 'Coming Soon', 'Degraded']
const visibilities: Visibility[] = ['Public', 'Hidden', 'Staff Only', 'Preview']
const capabilityIcons: Record<Capability, string> = { Vision: 'visibility', Audio: 'graphic_eq', Video: 'movie', Files: 'draft', Tools: 'construction', Reasoning: 'psychology', Streaming: 'stream', Multimodal: 'hub' }

function normalizeMediaUrl(url?: string) {
  const value = url?.trim()
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      return `https://raw.githubusercontent.com${parsed.pathname.replace('/blob/', '/')}`
    }
  } catch {
    return value
  }

  return value
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function looksLikeRawSecret(value: string) {
  return /^(sk-|sk_|eyJ|AIza|xox[baprs]-)/.test(value) || (value.length > 40 && !/^[A-Z0-9_]+$/.test(value))
}

function safeSecretName(model: Model) {
  return `RAZE_${model.id.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}_KEY`
}

function App() {
  const [view, setView] = useState<View>('Landing')
  const [models, setModels] = useState<Model[]>(seedModels)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Priority')
  const [focusedCard, setFocusedCard] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [adminGateOpen, setAdminGateOpen] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [adminKey, setAdminKey] = useState(getStoredAdminKey)
  const [syncState, setSyncState] = useState('loading config')
  const [userApiKey, setUserApiKey] = useState('')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [adminConfig, setAdminConfig] = useState<{ users?: UserProfile[]; userKeys?: Array<{ id: string; key?: string; userId?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>; requestLogs?: Array<{ id: string; at: string; userId: string; email: string; username: string; model: string; status: number; inputTokens: number; outputTokens: number; totalTokens: number; incidentCode?: string }>; incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number }> }>({})
  const [copied, setCopied] = useState('')
  const [adminTab, setAdminTab] = useState('Overview')
  const [selectedModelId, setSelectedModelId] = useState(seedModels[0].id)

  useEffect(() => {
    fetchUserSession().then((session) => {
      setUser(session.user)
      setUserApiKey(getUserApiKey())
    }).catch(() => {
      clearUserApiKey()
      setUserApiKey('')
      setUser(null)
    })
  }, [])

  useEffect(() => {
    fetchPublicConfig().then((config) => {
      if (config.models?.length) setModels(config.models)
      setSyncState('backend connected')
    }).catch((error) => setSyncState(`local fallback: ${error.message}`))
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
    const previousId = selectedModel.id
    setModels((current) => current.map((model) => (model.id === previousId ? { ...model, ...patch } : model)))
    if (patch.id && patch.id !== previousId) setSelectedModelId(patch.id)
  }

  const saveConfig = async () => {
    if (!adminKey) return setSyncState('admin key required')
    try {
      const saved = await saveAdminConfig(adminKey, { models })
      setModels(saved.models)
      setSyncState('config saved')
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'save failed')
    }
  }

  const refreshAdmin = async () => {
    if (!adminKey) return
    const config = await fetchAdminConfig(adminKey)
    setModels(config.models)
    setAdminConfig({ users: config.users, userKeys: config.userKeys, requestLogs: config.requestLogs, incidents: config.incidents })
  }

  const saveSecret = async (name: string, value: string) => {
    if (!adminKey) return setSyncState('admin key required')
    const secretName = looksLikeRawSecret(name) ? safeSecretName(selectedModel) : name
    try {
      if (secretName !== name) updateModel({ providerConfig: { ...selectedModel.providerConfig, apiKeyLabel: secretName } })
      const saved = await saveProviderSecret(adminKey, secretName, value)
      setSyncState(`secret ${saved.name} saved to ${saved.persisted}`)
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'secret save failed')
    }
  }

  const addModel = () => {
    const next = createBlankModel(models.length + 1)
    setModels((current) => [...current, next])
    setSelectedModelId(next.id)
    setAdminTab('Models')
  }

  const unlockAdmin = async () => {
    try {
      await verifyAdminKey(password)
      setStoredAdminKey(password)
      setAdminKey(password)
      setAdminUnlocked(true)
      setAdminGateOpen(false)
      setPassword('')
      setView('Admin')
      fetchAdminConfig(password).then((config) => {
        if (config.models?.length) setModels(config.models)
        setAdminConfig({ users: config.users, userKeys: config.userKeys, requestLogs: config.requestLogs, incidents: config.incidents })
        setSyncState('admin backend connected')
      }).catch((error) => setSyncState(error instanceof Error ? error.message : 'admin sync failed'))
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'admin unlock failed')
    }
  }

  const logout = () => {
    clearUserSession()
    setUserApiKey('')
    setUser(null)
    setView('Landing')
  }

  const authMode = user?.authMethod === 'google' && user.emailVerified ? 'GOOGLE VERIFIED' : 'SIGN-IN REQUIRED'

  return (
    <>
      <nav className="top-nav">
        <button className="wordmark ghost-button" onClick={() => setView('Landing')}>RAZE</button>
        <div className="nav-links">
          {views.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
          <button className={view === 'Admin' ? 'active' : ''} onClick={() => setAdminGateOpen(true)}>Admin</button>
        </div>
        <button className="profile-chip" onClick={() => setView('Dashboard')}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</button>
        <button className="launch-btn" onClick={() => setLoginOpen(true)}><span /> {user ? 'Account' : 'Launch'}</button>
      </nav>

      <main className="app-frame">
        {view === 'Landing' && <Landing setView={setView} openLogin={() => setLoginOpen(true)} models={featuredModels} focusedCard={focusedCard} setFocusedCard={setFocusedCard} copyId={copyId} copied={copied} stats={{ modelCount: visibleModels.length, authMode, adminUnlocked, cacheModes: cacheModes.length, providerCount: providerTypes.length, access: 'COMMUNITY' }} />}
        {view === 'Models' && <ModelsView filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} visibleModels={visibleModels} copyId={copyId} copied={copied} />}
        {view === 'Playground' && <Playground models={visibleModels} />}
        {view === 'Dashboard' && <Dashboard setView={setView} openLogin={() => setLoginOpen(true)} userApiKey={userApiKey} setUserApiKey={setUserApiKey} user={user} setUser={setUser} logout={logout} />}
        {view === 'Admin' && adminUnlocked && <AdminPanel models={models} adminConfig={adminConfig} selectedModel={selectedModel} selectedModelId={selectedModelId} setSelectedModelId={setSelectedModelId} adminTab={adminTab} setAdminTab={setAdminTab} updateModel={updateModel} addModel={addModel} saveConfig={saveConfig} saveSecret={saveSecret} syncState={syncState} toggleCapability={(cap) => toggleCapability(selectedModel, updateModel, cap)} refreshAdmin={refreshAdmin} />}
        {view === 'Admin' && !adminUnlocked && <LockedAdmin openGate={() => setAdminGateOpen(true)} />}
        {view === 'Changelog' && <Changelog />}
        {view === 'Status' && <ControlCenter user={user} syncState={syncState} adminUnlocked={adminUnlocked} />}
      </main>

      {loginOpen && <LoginModal close={() => setLoginOpen(false)} user={user} />}
      {adminGateOpen && <AdminGate password={password} setPassword={setPassword} close={() => setAdminGateOpen(false)} submit={unlockAdmin} />}
    </>
  )
}

function Landing({ setView, openLogin, models, focusedCard, setFocusedCard, copyId, copied, stats }: { setView: (view: View) => void; openLogin: () => void; models: Model[]; focusedCard: string | null; setFocusedCard: (id: string | null) => void; copyId: (id: string) => void; copied: string; stats: { modelCount: number; authMode: string; adminUnlocked: boolean; cacheModes: number; providerCount: number; access: string } }) {
  return <section className="hero view-shell"><div className="hero-copy"><p className="eyebrow">secure ai router / admin-configured / community access</p><h1>RAZE Router, partially designed by me, then fully vibe coded ?? cuz im lazy</h1><p className="hero-lede">RAZE is a production-ready AI router for model discovery, provider routing, exact-match caching, Google-authenticated access, and real-time streaming through a single OpenAI-style interface.</p><div className="hero-actions"><button className="primary" onClick={openLogin}>{'Sign in with Google'}</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button><button className="secondary" onClick={() => setView('Models')}>Explore Models</button></div></div><TerminalHero /><StatsBar stats={stats} /><section className="showcase-panel"><div><p className="eyebrow">model.cards</p><h2>Configured by admins, rendered live.</h2><p>Cards use admin-defined metadata and stay aligned with the public registry without exposing provider secrets or internal endpoints.</p></div><div className="showcase-grid">{models.length ? models.map((model) => <ModelCard key={model.id} model={model} mode="showcase" focused={focusedCard === model.id} dimmed={Boolean(focusedCard && focusedCard !== model.id)} onFocus={setFocusedCard} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No featured routes" body="Feature a model in Admin to show it here." />}</div></section></section>
}

function TerminalHero() {
  return <div className="terminal-card"><div className="terminal-top"><span>RAZE://BOOT</span><i /></div><div className="kinetic-word" aria-label="RAZE"><span>R</span><span>A</span><span>Z</span><span>E</span></div><div className="boot-lines">{['loading registry', 'checking configured providers', 'warming cache policy', 'preparing protected router'].map((line, index) => <p key={line} style={{ animationDelay: `${index * 180}ms` }}>&gt; {line}</p>)}<p className="operational">&gt; router operational <b>_</b></p></div></div>
}

function StatsBar({ stats }: { stats: { modelCount: number; authMode: string; adminUnlocked: boolean; cacheModes: number; providerCount: number; access: string } }) {
  const values = [['MODELS', String(stats.modelCount)], ['AUTH', stats.authMode], ['ADMIN', stats.adminUnlocked ? 'UNLOCKED' : 'LOCKED'], ['CACHE MODES', String(stats.cacheModes)], ['PROVIDERS', String(stats.providerCount)], ['ACCESS', stats.access]]
  return <section className="stats-bar">{values.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</section>
}

function ModelsView({ filter, setFilter, sort, setSort, visibleModels, copyId, copied }: { filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; visibleModels: Model[]; copyId: (id: string) => void; copied: string }) {
  return <section className="view-shell registry-section"><div className="section-heading split-heading"><div><p className="eyebrow">registry</p><h2>Model Registry</h2><p>Only configured, visible routes appear here. Add production routes from the protected admin panel.</p></div><div className="registry-readout">visible / {visibleModels.length}</div></div><div className="toolbar"><div className="chip-row">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'chip active' : 'chip'}>{item}</button>)}</div><select value={sort} onChange={(event) => setSort(event.target.value)}>{sortOptions.map((item) => <option key={item}>{item}</option>)}</select></div><div className="model-grid">{visibleModels.length ? visibleModels.map((model) => <ModelCard key={model.id} model={model} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No visible routes" body="No visible routes are published yet." />}</div></section>
}

function VideoBackground({ url, title }: { url?: string; title: string }) {
  const [failed, setFailed] = useState(false)
  const src = normalizeMediaUrl(url)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <div className="video-fallback"><span>{failed ? 'video failed to load' : 'no video url'}</span></div>
  return <video key={src} src={src} title={`${title} background video`} autoPlay muted loop playsInline preload="metadata" onError={() => setFailed(true)} onStalled={() => setFailed(true)} />
}

function ModelCard({ model, mode, focused, dimmed, onFocus, onCopy, copied }: { model: Model; mode?: 'showcase'; focused?: boolean; dimmed?: boolean; onFocus?: (id: string | null) => void; onCopy: (id: string) => void; copied: boolean }) {
  return <article className={`model-card ${mode === 'showcase' ? 'portrait' : ''} ${dimmed ? 'dimmed' : ''} ${focused ? 'focused' : ''}`} onMouseEnter={() => onFocus?.(model.id)} onMouseLeave={() => onFocus?.(null)} style={{ '--card-gradient': model.gradient } as CSSProperties}><VideoBackground url={model.videoUrl} title={model.name} /><div className="card-shade" /><div className="model-card-content"><StatusPill status={model.status} /><div className="model-main"><h3>{model.name}</h3><button className="copy-id" onClick={() => onCopy(model.id)}>{copied ? 'copied' : model.id}</button><p>{model.description}</p></div><div className="model-meta"><span>{Math.round(model.maxContext / 1000)}K ctx</span><span>{model.providerConfig.provider}</span><span>{model.providerConfig.cacheMode}</span></div><div className="cap-icons">{model.capabilities.map((cap) => <CapabilityIcon key={cap} capability={cap} />)}</div></div></article>
}

function StatusPill({ status }: { status: ModelStatus }) {
  return <span className={`status status-${status.toLowerCase().replace(/ /g, '-')}`}>{status}</span>
}

function CapabilityIcon({ capability }: { capability: Capability }) {
  return <span className="cap-icon material-symbols-rounded" aria-label={capability}>{capabilityIcons[capability]}<em>{capability}: {capabilityDescriptions[capability]}</em></span>
}

function renderLiteMarkdown(value: string) {
  const escaped = value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char))
  return escaped.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />')
}

function Playground({ models }: { models: Model[] }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are routed through RAZE. Be direct and useful.')
  const [result, setResult] = useState('No request sent yet.')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; dataUrl: string }>>([])
  const [debugOpen, setDebugOpen] = useState(true)
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const requestPreview = model ? { model: model.id, messages: [{ role: 'system', content: systemPrompt }, ...messages, { role: 'user', content: prompt || '<prompt>' }], attachments: attachments.map((file) => ({ name: file.name, type: file.type })) } : null
  const attachFiles = async (files: FileList | null) => {
    if (!files) return
    const next = await Promise.all(Array.from(files).slice(0, 4).map((file) => new Promise<{ name: string; type: string; dataUrl: string }>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    })))
    setAttachments(next)
  }
  const submit = async () => {
    if (!model || !prompt.trim()) return
    setResult('sending request...')
    try {
      const outgoing = [...messages, { role: 'user' as const, content: prompt }]
      setMessages(outgoing)
      const data = await sendChatCompletion({ model: model.id, messages: [{ role: 'system', content: systemPrompt }, ...outgoing], attachments, stream: false })
      const raw = JSON.stringify(data, null, 2)
      setResult(raw)
      const assistantText = typeof data === 'object' && data && 'choices' in data ? String((data as any).choices?.[0]?.message?.content || '') : raw
      setMessages([...outgoing, { role: 'assistant', content: assistantText }])
      setPrompt('')
      setAttachments([])
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'request failed')
    }
  }
  return <section className="playground-shell"><header className="playground-topbar"><div className="playground-topbar-left"><span className="playground-badge">Chat</span><div className="playground-title-group"><div className="playground-title-main">RAZE Conversation</div><div className="playground-title-sub">{model?.name || 'No route selected'}</div></div></div><div className="playground-topbar-right"><span className={`playground-status ${model?.status === 'Online' ? 'online' : ''}`}>{model?.status || 'No model'}</span><button className="playground-ghost" onClick={() => setDebugOpen((value) => !value)}>Safe Debug</button></div></header><div className="playground-workspace"><main className="playground-chat-panel"><div className="playground-config"><div className="playground-field-row"><label className="playground-field-label">Route</label><select value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="playground-field-row"><label className="playground-field-label">System</label><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="System prompt" /></div></div><div className="playground-chat-stream">{messages.length ? messages.map((message, index) => <article key={index} className={`playground-message ${message.role}`}><span>{message.role}</span><div dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(message.content) }} /></article>) : <div className="playground-empty"><div className="playground-empty-icon">□</div><span>No messages yet.</span></div>}</div><div className="playground-composer"><div className="playground-composer-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="Enter your message..." /><div className="playground-composer-actions"><label className="playground-icon-btn">＋<input type="file" multiple onChange={(event) => attachFiles(event.target.files)} /></label><button className="playground-icon-btn send" onClick={submit}>→</button></div></div>{attachments.length ? <div className="playground-attachments">{attachments.map((file) => <span key={file.name}>{file.name}</span>)}</div> : null}<div className="playground-composer-hint"><span>Enter to send</span><span>{attachments.length}/4 files</span></div></div></main><aside className={`playground-debug-panel ${debugOpen ? '' : 'hidden'}`}><div className="playground-debug-header"><span>safe debug</span><span>{model?.id || 'no-model'}</span></div><div className="playground-debug-body"><div><div className="playground-debug-title">outgoing payload</div><pre className="playground-code-block">{JSON.stringify(requestPreview, null, 2)}</pre></div><div><div className="playground-debug-title">response</div><pre className="playground-code-block response">{result}</pre></div></div></aside></div></section>
}

function Dashboard({ setView, openLogin, userApiKey, setUserApiKey, user, setUser, logout }: { setView: (view: View) => void; openLogin: () => void; userApiKey: string; setUserApiKey: (value: string) => void; user: UserProfile | null; setUser: (user: UserProfile) => void; logout: () => void }) {
  const [keyState, setKeyState] = useState('')
  const [avatarState, setAvatarState] = useState('')

  const onAvatarFile = async (file: File) => {
    if (!user) return setAvatarState('Sign in with Google before uploading an avatar.')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        setAvatarState('uploading avatar...')
        const result = await uploadAvatar(String(reader.result))
        setUser(result.user)
        setAvatarState('avatar updated')
      } catch (error) {
        setAvatarState(error instanceof Error ? error.message : 'avatar upload failed')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) await onAvatarFile(file)
  }

  const generateKey = async () => {
    if (!user || user.authMethod !== 'google' || !user.emailVerified) return setKeyState('Sign in with a verified Google account before generating an API key.')
    setKeyState('generating key...')
    try {
      const key = await createUserApiKey('Dashboard key')
      storeUserApiKey(key.key)
      setUserApiKey(key.key)
      setKeyState('key generated')
    } catch (error) {
      setKeyState(error instanceof Error ? error.message : 'key generation failed')
    }
  }

  return <section className="view-shell dashboard-section"><div className="section-heading"><p className="eyebrow">dashboard</p><h2>Command center.</h2><p>Verified Google sessions can manage avatars and generate protected RAZE API keys.</p></div><div className="dashboard-grid"><article className="wide-panel"><p className="eyebrow">account</p><h3>{user ? user.username : 'Sign in required'}</h3><p>{user ? `${user.email} · ${user.emailVerified ? 'verified Google account' : 'verification required'}` : 'Sign in with Google to unlock avatar storage and API key creation.'}</p><div className="dashboard-actions">{user ? <><button className="primary" onClick={logout}>Sign out</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button></> : <><button className="google-btn" onClick={openLogin}>Sign in with Google</button><button className="secondary" onClick={() => setView('Models')}>View Registry</button></>}</div></article><article className="wide-panel"><span>Profile image</span><p>Drop a PNG, JPEG, WEBP, or GIF file under 750 KB. The image is stored in the backend database and served through your protected profile route.</p><div className={`avatar-dropzone ${user ? '' : 'disabled'}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><div className="avatar-preview">{user?.avatarUrl ? <img src={user.avatarUrl} alt="Profile avatar" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</div><div className="avatar-copy"><b>Drop avatar here</b><span>{user ? 'or use file picker' : 'sign in first'}</span></div><label className="secondary avatar-upload-label">Choose file<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!user} onChange={(event) => { const file = event.target.files?.[0]; if (file) onAvatarFile(file) }} /></label></div><small>{avatarState || 'No avatar uploaded yet.'}</small></article><article className="wide-panel"><span>Your API key</span><p>Use this as <code>Authorization: Bearer your_key</code> for RAZE endpoints.</p><div className="password-row"><input value={userApiKey} readOnly placeholder="No key generated yet" /><button onClick={generateKey}>Generate Key</button><button disabled={!userApiKey} onClick={() => navigator.clipboard?.writeText(userApiKey)}>Copy</button></div><small>{keyState || 'API keys are gated behind verified Google sessions.'}</small></article><article><span>Auth state</span><p>{user ? `${user.authMethod || 'session'} / ${user.emailVerified ? 'verified' : 'unverified'}` : 'No active session.'}</p></article><article><span>Registry access</span><p>Browse routes, check capabilities, and copy route IDs from the public registry.</p></article><article><span>Next action</span><p>Send a request through the protected router.</p><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button></article></div></section>
}

function AdminPanel(props: { models: Model[]; adminConfig: { userKeys?: Array<{ id: string; key?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>; incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number }> }; selectedModel: Model; selectedModelId: string; setSelectedModelId: (id: string) => void; adminTab: string; setAdminTab: (tab: string) => void; updateModel: (patch: Partial<Model>) => void; addModel: () => void; saveConfig: () => void; saveSecret: (name: string, value: string) => void; syncState: string; toggleCapability: (cap: Capability) => void; refreshAdmin: () => void }) {
  const { models, adminConfig, selectedModel, selectedModelId, setSelectedModelId, adminTab, setAdminTab, updateModel, addModel, saveConfig, saveSecret, syncState, toggleCapability, refreshAdmin } = props
  const updateProvider = (patch: Partial<Model['providerConfig']>) => updateModel({ providerConfig: { ...selectedModel.providerConfig, ...patch } })
  return <section className="view-shell admin-section"><div className="section-heading split-heading"><div><p className="eyebrow">admin / protected</p><h2>Registry control panel.</h2><p>Configure routes, provider endpoints, cache behavior, visibility, and card media through the backend-backed admin store.</p><p className="eyebrow">{syncState}</p></div><div className="admin-actions"><button className="secondary" onClick={refreshAdmin}>Refresh</button><button className="secondary" onClick={saveConfig}>Save Config</button><button className="primary" onClick={addModel}>Add Model</button></div></div><div className="admin-layout"><aside>{adminTabs.map((tab) => <button key={tab} onClick={() => setAdminTab(tab)} className={adminTab === tab ? 'active' : ''}>{tab}</button>)}</aside><div className="admin-workspace"><div className="panel-top"><span>{adminTab}</span><span>backend backed</span></div>{adminTab === 'Models' ? <div className="model-editor"><label>Selected route<select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{models.map((model) => <option value={model.id} key={model.id}>{model.name} / {model.id}</option>)}</select></label><label>Display name<input value={selectedModel.name} onChange={(event) => updateModel({ name: event.target.value })} placeholder="Display name" /></label><label>Copyable route ID<input value={selectedModel.id} onChange={(event) => updateModel({ id: event.target.value })} placeholder="Internal route ID" /></label><label>Description<textarea value={selectedModel.description} onChange={(event) => updateModel({ description: event.target.value })} placeholder="Description" /></label><label>Groups<input value={selectedModel.groups.join(', ')} onChange={(event) => updateModel({ groups: splitList(event.target.value) })} placeholder="Featured, Fast, Staff Picks" /></label><label>Tags<input value={selectedModel.tags.join(', ')} onChange={(event) => updateModel({ tags: splitList(event.target.value) })} placeholder="Fast, Vision, Experimental" /></label><label>Max context<input type="number" value={selectedModel.maxContext} onChange={(event) => updateModel({ maxContext: Number(event.target.value) })} /></label><label>First token latency<input type="number" step="0.1" value={selectedModel.firstToken || 0} onChange={(event) => updateModel({ firstToken: Number(event.target.value) })} /></label><label>Status<select value={selectedModel.status} onChange={(event) => updateModel({ status: event.target.value as ModelStatus })}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label>Visibility<select value={selectedModel.visibility} onChange={(event) => updateModel({ visibility: event.target.value as Visibility })}>{visibilities.map((item) => <option key={item}>{item}</option>)}</select></label><label>Gradient<input value={selectedModel.gradient} onChange={(event) => updateModel({ gradient: event.target.value })} placeholder="linear-gradient(...)" /></label><label>Hover description<textarea value={selectedModel.hoverDescription} onChange={(event) => updateModel({ hoverDescription: event.target.value })} placeholder="Tooltip description" /></label><label>Video URL<input value={selectedModel.videoUrl || ''} onChange={(event) => updateModel({ videoUrl: event.target.value })} placeholder="https://..." /></label><div className="chip-row">{capabilities.map((cap) => <button key={cap} type="button" className={selectedModel.capabilities.includes(cap) ? 'chip active' : 'chip'} onClick={() => toggleCapability(cap)}>{cap}</button>)}</div><div className="preview-note"><span>Feature flags</span><label><input type="checkbox" checked={selectedModel.featured} onChange={(event) => updateModel({ featured: event.target.checked })} /> Featured</label><label><input type="checkbox" checked={selectedModel.launchAvailable} onChange={(event) => updateModel({ launchAvailable: event.target.checked })} /> Launch available</label></div><div className="admin-card-preview"><ModelCard model={selectedModel} onCopy={() => undefined} copied={false} /></div></div> : <AdminPlaceholder tab={adminTab} model={selectedModel} updateProvider={updateProvider} adminConfig={adminConfig} saveSecret={saveSecret} />}</div></div></section>
}

function ProviderEditor({ model, updateProvider, saveSecret }: { model: Model; updateProvider: (patch: Partial<Model['providerConfig']>) => void; saveSecret: (name: string, value: string) => void }) {
  const [secretValue, setSecretValue] = useState('')
  return <div className="provider-editor"><div className="provider-header"><div><p className="eyebrow">provider.settings</p><h3>Provider route</h3></div><span>secrets stay server-side</span></div><p className="provider-help">Use a safe secret name like RAZE_PROVIDER_KEY in config. Paste the real API key only in Provider API key, then save it. Raw keys are never displayed again.</p><label>Provider type<select value={model.providerConfig.provider} onChange={(event) => updateProvider({ provider: event.target.value as ProviderType })}>{providerTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Provider model ID<input value={model.providerConfig.modelId} onChange={(event) => updateProvider({ modelId: event.target.value })} placeholder="provider/model-id" /></label><label>OpenAI-compatible base URL<input value={model.providerConfig.openAIBaseUrl} onChange={(event) => updateProvider({ openAIBaseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label><label>Anthropic endpoint<input value={model.providerConfig.anthropicEndpoint} onChange={(event) => updateProvider({ anthropicEndpoint: event.target.value })} placeholder="https://api.anthropic.com/v1/messages" /></label><label>API key secret name<input value={looksLikeRawSecret(model.providerConfig.apiKeyLabel) ? safeSecretName(model) : model.providerConfig.apiKeyLabel} onChange={(event) => updateProvider({ apiKeyLabel: event.target.value })} placeholder="RAZE_PROVIDER_KEY" /></label><label>Provider API key<input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Paste provider key here" /></label><button type="button" className="secondary" disabled={!secretValue.trim()} onClick={() => { saveSecret(model.providerConfig.apiKeyLabel, secretValue); setSecretValue('') }}>Save Provider Key</button><label>Cache mode<select value={model.providerConfig.cacheMode} onChange={(event) => updateProvider({ cacheMode: event.target.value as CacheMode })}>{cacheModes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Cache TTL seconds<input type="number" value={model.providerConfig.cacheTtlSeconds} onChange={(event) => updateProvider({ cacheTtlSeconds: Number(event.target.value) })} /></label><div className="provider-checks"><label><input type="checkbox" checked={model.providerConfig.cacheSystemPrompt} onChange={(event) => updateProvider({ cacheSystemPrompt: event.target.checked })} /> Cache system prompt</label><label><input type="checkbox" checked={model.providerConfig.cacheTools} onChange={(event) => updateProvider({ cacheTools: event.target.checked })} /> Cache tools</label><label><input type="checkbox" checked={model.providerConfig.cacheLargeContext} onChange={(event) => updateProvider({ cacheLargeContext: event.target.checked })} /> Cache large context</label></div></div>
}

function AdminPlaceholder({ tab, model, updateProvider, adminConfig, saveSecret }: { tab: string; model: Model; updateProvider: (patch: Partial<Model['providerConfig']>) => void; adminConfig?: { users?: UserProfile[]; userKeys?: Array<{ id: string; key?: string; userId?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>; requestLogs?: Array<{ id: string; at: string; userId: string; email: string; username: string; model: string; status: number; inputTokens: number; outputTokens: number; totalTokens: number; incidentCode?: string }>; incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number }> }; saveSecret: (name: string, value: string) => void }) {
  if (tab === 'Caching' || tab === 'Routing') return <ProviderEditor model={model} updateProvider={updateProvider} saveSecret={saveSecret} />
  if (tab === 'Privacy / Logs') return <div className="admin-placeholder"><h3>Users, keys, and requests</h3><p>Keys are created from verified Google-backed dashboards only. Admin sees email, key fingerprint, request counts, token estimates, and incident codes.</p><h3>Users</h3><div className="endpoint-list">{(adminConfig?.users || []).map((user) => <code key={user.id}>{user.email} / {user.username} / {user.banned ? 'banned' : 'active'}</code>)}</div><h3>API keys</h3><div className="endpoint-list">{(adminConfig?.userKeys || []).map((key) => <code key={key.id}>{key.label}: {key.key} / {key.requestCount} req / {key.active ? 'active' : 'revoked'}</code>)}</div><h3>Requests</h3><div className="endpoint-list">{(adminConfig?.requestLogs || []).map((log) => <code key={log.id}>{log.email} / {log.model} / in {log.inputTokens} / out {log.outputTokens} / total {log.totalTokens} / {log.incidentCode || log.status}</code>)}</div><h3>Incidents</h3><div className="endpoint-list">{(adminConfig?.incidents || []).map((incident) => <code key={incident.code}>{incident.code} / {incident.status ?? 'n/a'} / {incident.model}</code>)}</div></div>
  if (tab === 'Overview') return <div className="admin-placeholder"><h3>Admin map</h3><p>Use Models for card media, groups, IDs, visibility, and provider routing. The backend serves `/v1/models`, `/v1/messages`, `/v1/chat/completions`, `/chat/completions`, `/metrics`, and protected admin routes with secret injection and request logs.</p><div className="endpoint-list"><code>GET /v1/models</code><code>POST /v1/messages</code><code>POST /v1/chat/completions</code><code>GET /metrics</code></div></div>
  if (tab === 'Groups') return <div className="admin-placeholder"><h3>Groups</h3><p>Create and manage groups from the Models tab by editing the comma-separated group field on each route. Examples: Featured, Fast, Smart, Vision, Staff Picks.</p><code>selected / {model.id}</code></div>
  return <div className="admin-placeholder"><h3>{tab}</h3><p>This panel is connected to the backend-backed control surface and ready for production configuration.</p><code>selected / {model.id}</code></div>
}

function LockedAdmin({ openGate }: { openGate: () => void }) {
  return <section className="view-shell locked-admin"><p className="eyebrow">admin locked</p><h2>Protected control panel.</h2><p>Use the unlock button and your configured admin key for backend-backed management.</p><button className="primary" onClick={openGate}>Unlock Admin</button></section>
}

function ControlCenter({ user, syncState, adminUnlocked }: { user: UserProfile | null; syncState: string; adminUnlocked: boolean }) {
  const items = [
    user ? `active user session / ${user.email}` : 'no active user session',
    `config sync / ${syncState}`,
    `admin panel / ${adminUnlocked ? 'unlocked' : 'locked'}`,
    'protected key generation / google verified only',
    'streaming, caching, rate limiting, and observability enabled'
  ]
  return <section className="view-shell control-section"><div className="status-panel"><p>RAZE://STATUS</p>{items.map((item) => <span key={item}>{item}</span>)}<b>PRODUCTION STATE: READY</b></div><div className="faq-list">{['OpenAI-compatible routing surface', 'Google-authenticated sessions', 'Railway-ready deployment'].map((item) => <div key={item} className="faq-item"><b>{item}</b><span>RAZE routes requests through a protected backend, keeps provider secrets server-side, and exposes a single standardized API surface.</span></div>)}</div></section>
}

function Changelog() {
  return <section className="view-shell changelog-section"><div className="section-heading"><p className="eyebrow">release.history</p><h2>Production release history.</h2></div><div className="release-grid">{changelog.map((entry) => <article key={entry.version}><span>{entry.status}</span><h3>{entry.version}</h3><p>{entry.label}</p><ul>{entry.notes.map((note) => <li key={note}>{note}</li>)}</ul></article>)}</div></section>
}

function LoginModal({ close, user }: { close: () => void; user: UserProfile | null }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">secure access</p><h2>{user ? 'Account connected' : 'Launch RAZE'}</h2><p>{user ? `Signed in as ${user.email}.` : 'Use Google OAuth to create a verified session and unlock protected API key generation.'}</p><button className="google-btn" onClick={startGoogleAuth}>{user ? 'Continue with Google' : 'Sign in with Google'}</button><small>Only verified Google accounts can create sessions and dashboard API keys.</small></div></div>
}

function AdminGate({ password, setPassword, close, submit }: { password: string; setPassword: (value: string) => void; close: () => void; submit: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">admin gate</p><h2>Enter admin key</h2><p>This key is also used for protected backend admin routes.</p><div className="password-row"><input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} autoFocus placeholder="Admin key" type="password" /><button onClick={submit}>Unlock</button></div><small>Set RAZE_ADMIN_KEY on Railway before production.</small></div></div>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>
}

function toggleCapability(selectedModel: Model, updateModel: (patch: Partial<Model>) => void, capability: Capability) {
  const exists = selectedModel.capabilities.includes(capability)
  updateModel({ capabilities: exists ? selectedModel.capabilities.filter((item) => item !== capability) : [...selectedModel.capabilities, capability] })
}

export default App
