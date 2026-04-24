import { useMemo, useState } from 'react'
import type { Capability, Model, ModelStatus } from './types'
import { capabilityDescriptions, seedModels } from './data/models'
import { changelog } from './data/changelog'

const filters = ['All', 'Online', 'Vision', 'Multimodal', 'Fast', 'Long Context', 'Experimental', 'New', 'Staff Picks']
const sortOptions = ['Popular', 'Fastest', 'Longest Context', 'Recently Added', 'Alphabetical']
const adminTabs = ['Overview', 'Models', 'Groups', 'Routing', 'Visibility & Access', 'Presets', 'Privacy / Logs', 'Users', 'Branding', 'Changelog / Releases']
const capabilities: Capability[] = ['Vision', 'Audio', 'Video', 'Files', 'Tools', 'Reasoning', 'Streaming', 'Multimodal']

function App() {
  const [models, setModels] = useState<Model[]>(seedModels)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Popular')
  const [focusedCard, setFocusedCard] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [accessMode, setAccessMode] = useState<'Guest' | 'Preview' | 'Google Test' | 'Admin Test'>('Guest')
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState('')
  const [adminTab, setAdminTab] = useState('Overview')
  const [selectedModelId, setSelectedModelId] = useState(seedModels[0].id)

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0]
  const featuredModels = models.filter((model) => model.featured)

  const visibleModels = useMemo(() => {
    const filtered = models.filter((model) => {
      if (filter === 'All') return true
      if (filter === 'Online') return model.status === 'Online'
      return model.tags.includes(filter) || model.groups.includes(filter) || model.capabilities.includes(filter as Capability)
    })

    return [...filtered].sort((a, b) => {
      if (sort === 'Fastest') return (a.firstToken ?? 99) - (b.firstToken ?? 99)
      if (sort === 'Longest Context') return b.maxContext - a.maxContext
      if (sort === 'Recently Added') return b.added.localeCompare(a.added)
      if (sort === 'Alphabetical') return a.name.localeCompare(b.name)
      return b.popularity - a.popularity
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

  const toggleCapability = (capability: Capability) => {
    const exists = selectedModel.capabilities.includes(capability)
    updateModel({
      capabilities: exists
        ? selectedModel.capabilities.filter((item) => item !== capability)
        : [...selectedModel.capabilities, capability],
    })
  }

  return (
    <>
      <nav className="top-nav">
        <a href="#home" className="wordmark">RAZE</a>
        <div className="nav-links">
          <a href="#models">Models</a>
          <a href="#playground">Playground</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#changelog">Changelog</a>
          <a href="#status">Status</a>
        </div>
        <button className="launch-btn" onClick={() => setLoginOpen(true)}><span /> Launch App</button>
      </nav>

      <main>
        <section id="home" className="hero section-shell">
          <div className="hero-copy">
            <p className="eyebrow">registry.online / discord-linked / fallback-ready</p>
            <h1>Route any prompt. Launch any model. Free for the server.</h1>
            <p className="hero-lede">RAZE is a community AI router for browsing live models, checking system state, and launching prompts through one clean gateway.</p>
            <div className="hero-actions">
              <button className="primary" onClick={() => setLoginOpen(true)}>Launch App</button>
              <a className="secondary" href="#models">Explore Models</a>
            </div>
            <div className="test-strip">Test build: continue with Google or use the small skip access button. Temporary password: <b>1234</b>.</div>
          </div>
          <TerminalHero />
        </section>

        <StatsBar />
        <Capabilities />

        <section className="section-shell showcase-section">
          <div className="section-heading">
            <p className="eyebrow">featured.routes</p>
            <h2>Model ecosystem, live in motion.</h2>
            <p>Portrait cards support admin-linked video backgrounds, fallback gradients, focus dimming, and readable overlays.</p>
          </div>
          <div className="showcase-grid">
            {featuredModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                mode="showcase"
                focused={focusedCard === model.id}
                dimmed={Boolean(focusedCard && focusedCard !== model.id)}
                onFocus={setFocusedCard}
                onCopy={copyId}
                copied={copied === model.id}
              />
            ))}
          </div>
        </section>

        <section id="models" className="section-shell registry-section">
          <div className="section-heading split-heading">
            <div>
              <p className="eyebrow">registry.sync / live</p>
              <h2>Model Registry</h2>
              <p>Browse live routes, model states, capabilities, and community-picked systems.</p>
            </div>
            <div className="registry-readout">models.visible / {visibleModels.length}</div>
          </div>
          <div className="toolbar">
            <div className="chip-row">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'chip active' : 'chip'}>{item}</button>)}</div>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>{sortOptions.map((item) => <option key={item}>{item}</option>)}</select>
          </div>
          <div className="model-grid">
            {visibleModels.map((model) => (
              <ModelCard key={model.id} model={model} onCopy={copyId} copied={copied === model.id} />
            ))}
          </div>
        </section>

        <section id="playground" className="section-shell playground">
          <div>
            <p className="eyebrow">playground.preview</p>
            <h2>Prompt launch surface.</h2>
            <p>The test playground shows how a routed prompt composer will feel once real model routes are connected.</p>
          </div>
          <div className="prompt-panel">
            <div className="panel-top"><span>route / adaptive</span><span>state / ready</span></div>
            <textarea placeholder="Ask RAZE to route this prompt..." />
            <div className="prompt-actions"><button className="primary">Route Prompt</button><span>fallback chain armed</span></div>
          </div>
        </section>

        <Dashboard accessMode={accessMode} />
        <AdminPanel
          models={models}
          selectedModel={selectedModel}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          adminTab={adminTab}
          setAdminTab={setAdminTab}
          updateModel={updateModel}
          toggleCapability={toggleCapability}
        />
        <ControlCenter />
        <Changelog />
      </main>
      <Footer />
      {loginOpen && (
        <LoginModal
          password={password}
          setPassword={setPassword}
          close={() => setLoginOpen(false)}
          setAccessMode={setAccessMode}
        />
      )}
    </>
  )
}

function TerminalHero() {
  return (
    <div className="terminal-card">
      <div className="terminal-top"><span>RAZE://REGISTRY_BOOT</span><i /></div>
      <div className="kinetic-word" aria-label="RAZE"><span>R</span><span>A</span><span>Z</span><span>E</span></div>
      <div className="boot-lines">
        {['loading route table', 'syncing public models', 'checking fallback chain', 'reading discord access', 'validating live states', 'preparing model gateway'].map((line, index) => <p key={line} style={{ animationDelay: `${index * 180}ms` }}>&gt; {line}</p>)}
        <p className="operational">&gt; registry state: OPERATIONAL <b>_</b></p>
      </div>
    </div>
  )
}

function StatsBar() {
  const stats = [['MODELS ONLINE', '18'], ['AVG FIRST TOKEN', '0.48s'], ['REQUESTS TODAY', '12,904'], ['ACTIVE USERS', '342'], ['VISION MODELS', '7'], ['UPTIME', '99.98%']]
  return <section className="stats-bar">{stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</section>
}

function Capabilities() {
  const items = ['Adaptive Routing', 'Failover Recovery', 'Multimodal Access', 'Admin-Controlled Registry', 'Community Picks', 'Real-Time Model States', 'Discord-Native Access']
  const logs = ['registry.sync started', 'model.fast-chat online', 'model.deep-reasoning online', 'vision.cluster linked', 'fallback.chain ready', 'discord.access mapped', 'route.gateway operational']
  return (
    <section className="section-shell capabilities-section">
      <div className="capability-grid">{items.map((item) => <article key={item} className="feature-card"><span>{item}</span><p>{featureCopy(item)}</p><code>state / linked</code></article>)}</div>
      <div className="log-window">{logs.map((log, index) => <p key={log}>[12:04:{18 + index}] {log}</p>)}</div>
    </section>
  )
}

function featureCopy(item: string) {
  const copy: Record<string, string> = {
    'Adaptive Routing': 'Routes prompts through available models based on state, speed, and configured priority.',
    'Failover Recovery': 'Moves requests through the next available route when a model drops.',
    'Multimodal Access': 'Indexes vision, audio, video, files, streaming, reasoning, and tools.',
    'Admin-Controlled Registry': 'Admins decide which models appear, how they are grouped, and how they behave.',
    'Community Picks': 'Highlights staff picks, favorites, experimental routes, and coming soon releases.',
    'Real-Time Model States': 'Online, offline, degraded, and preview states stay visible.',
    'Discord-Native Access': 'Designed around server identity, role mapping, and community usage.',
  }
  return copy[item]
}

function ModelCard({ model, mode, focused, dimmed, onFocus, onCopy, copied }: { model: Model; mode?: 'showcase'; focused?: boolean; dimmed?: boolean; onFocus?: (id: string | null) => void; onCopy: (id: string) => void; copied: boolean }) {
  return (
    <article className={`model-card ${mode === 'showcase' ? 'portrait' : ''} ${dimmed ? 'dimmed' : ''} ${focused ? 'focused' : ''}`} onMouseEnter={() => onFocus?.(model.id)} onMouseLeave={() => onFocus?.(null)} style={{ '--card-gradient': model.gradient } as React.CSSProperties}>
      {model.videoUrl && <video src={model.videoUrl} autoPlay muted loop playsInline />}
      <div className="card-shade" />
      <div className="model-card-content">
        <StatusPill status={model.status} />
        <div className="model-main">
          <h3>{model.name}</h3>
          <button className="copy-id" onClick={() => onCopy(model.id)}>{copied ? 'copied' : model.id}</button>
          <p>{model.description}</p>
        </div>
        <div className="model-meta"><span>{Math.round(model.maxContext / 1000)}K ctx</span><span>{model.firstToken ? `${model.firstToken}s ftt` : 'preview route'}</span></div>
        <div className="cap-icons">{model.capabilities.map((cap) => <CapabilityIcon key={cap} capability={cap} />)}</div>
      </div>
    </article>
  )
}

function StatusPill({ status }: { status: ModelStatus }) {
  return <span className={`status status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>
}

function CapabilityIcon({ capability }: { capability: Capability }) {
  return <span className="cap-icon">{capability.slice(0, 2)}<em>{capabilityDescriptions[capability]}</em></span>
}

function Dashboard({ accessMode }: { accessMode: string }) {
  return (
    <section id="dashboard" className="section-shell dashboard-section">
      <div className="section-heading"><p className="eyebrow">operator.dashboard</p><h2>Personal command center.</h2></div>
      <div className="dashboard-grid">
        <article className="wide-panel"><p className="eyebrow">identity</p><h3>Welcome back, Operator.</h3><p>access / {accessMode.toLowerCase()} · discord / linked · build / v0.1.0-test</p></article>
        {['Recent Sessions', 'Favorite Models', 'Usage Summary', 'Average Speed', 'Saved Presets', 'Status Feed'].map((title) => <article key={title}><span>{title}</span><p>{dashboardCopy(title)}</p></article>)}
      </div>
    </section>
  )
}

function dashboardCopy(title: string) {
  const copy: Record<string, string> = {
    'Recent Sessions': 'Deep Reasoning / 14 min ago / Vision Analysis / yesterday',
    'Favorite Models': 'RAZE Nova, RAZE Orbit, RAZE Archive',
    'Usage Summary': '143 routed prompts · most used model / RAZE Nova',
    'Average Speed': '0.54s first token across recent online routes',
    'Saved Presets': 'Fast Chat, Deep Thinking, Vision Analysis, Coding',
    'Status Feed': 'All public routes operational. One experimental video route offline.',
  }
  return copy[title]
}

function AdminPanel(props: { models: Model[]; selectedModel: Model; selectedModelId: string; setSelectedModelId: (id: string) => void; adminTab: string; setAdminTab: (tab: string) => void; updateModel: (patch: Partial<Model>) => void; toggleCapability: (cap: Capability) => void }) {
  const { models, selectedModel, selectedModelId, setSelectedModelId, adminTab, setAdminTab, updateModel, toggleCapability } = props
  return (
    <section className="section-shell admin-section">
      <div className="section-heading"><p className="eyebrow">admin.control / test password 1234</p><h2>Registry control panel.</h2><p>Local test controls for configuring visible model data, routing state, groups, presets, logs, and branding.</p></div>
      <div className="admin-layout">
        <aside>{adminTabs.map((tab) => <button key={tab} onClick={() => setAdminTab(tab)} className={adminTab === tab ? 'active' : ''}>{tab}</button>)}</aside>
        <div className="admin-workspace">
          <div className="panel-top"><span>{adminTab}</span><span>changes / local preview</span></div>
          {adminTab === 'Models' ? (
            <div className="model-editor">
              <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select>
              <input value={selectedModel.name} onChange={(event) => updateModel({ name: event.target.value })} />
              <input value={selectedModel.id} onChange={(event) => updateModel({ id: event.target.value })} />
              <textarea value={selectedModel.description} onChange={(event) => updateModel({ description: event.target.value })} />
              <input type="number" value={selectedModel.maxContext} onChange={(event) => updateModel({ maxContext: Number(event.target.value) })} />
              <select value={selectedModel.status} onChange={(event) => updateModel({ status: event.target.value as ModelStatus })}>{['Online', 'Offline', 'Coming Soon', 'Degraded'].map((item) => <option key={item}>{item}</option>)}</select>
              <input placeholder="Video background URL" value={selectedModel.videoUrl ?? ''} onChange={(event) => updateModel({ videoUrl: event.target.value })} />
              <label><input type="checkbox" checked={selectedModel.featured} onChange={(event) => updateModel({ featured: event.target.checked })} /> Featured route</label>
              <div className="chip-row">{capabilities.map((cap) => <button key={cap} className={selectedModel.capabilities.includes(cap) ? 'chip active' : 'chip'} onClick={() => toggleCapability(cap)}>{cap}</button>)}</div>
              <ModelCard model={selectedModel} mode="showcase" onCopy={() => undefined} copied={false} />
            </div>
          ) : <AdminPlaceholder tab={adminTab} />}
        </div>
      </div>
    </section>
  )
}

function AdminPlaceholder({ tab }: { tab: string }) {
  return <div className="admin-placeholder"><h3>{tab}</h3><p>Operational controls are represented for the test build: route mode, fallback chain, visibility, presets, logs, users, branding, release notes, and Discord role mapping.</p><code>state / configurable</code></div>
}

function ControlCenter() {
  const [open, setOpen] = useState(0)
  const faqs = ['What is RAZE?', 'Is RAZE free?', 'Do I need Discord?', 'Can admins add models?', 'Is this production?']
  return (
    <section id="status" className="section-shell control-section">
      <div className="faq-list">{faqs.map((faq, index) => <button key={faq} className="faq-item" onClick={() => setOpen(index)}><b>{faq}</b>{open === index && <span>{faqAnswer(faq)}</span>}</button>)}</div>
      <div className="status-panel"><p>RAZE://CONTROL_CENTER</p><span>registry online</span><span>discord linked</span><span>routes ready</span><span>fallback armed</span><b>SYSTEM STATE: OPERATIONAL</b></div>
    </section>
  )
}

function faqAnswer(faq: string) {
  const answers: Record<string, string> = {
    'What is RAZE?': 'A free AI router for a Discord community, with model browsing, route state, and admin control.',
    'Is RAZE free?': 'Yes. RAZE is free for everyone in the community.',
    'Do I need Discord?': 'RAZE is designed for Discord communities. Some future access rules can use server roles.',
    'Can admins add models?': 'Yes. Admins can configure cards, visibility, capabilities, groups, and video backgrounds.',
    'Is this production?': 'This is a test build. Skip login and password 1234 are temporary preview behavior.',
  }
  return answers[faq]
}

function Changelog() {
  return <section id="changelog" className="section-shell changelog-section"><div className="section-heading"><p className="eyebrow">release.history</p><h2>Versioned from day one.</h2></div><div className="release-grid">{changelog.map((entry) => <article key={entry.version}><span>{entry.status}</span><h3>{entry.version}</h3><p>{entry.label}</p><ul>{entry.notes.map((note) => <li key={note}>{note}</li>)}</ul></article>)}</div></section>
}

function LoginModal({ password, setPassword, close, setAccessMode }: { password: string; setPassword: (value: string) => void; close: () => void; setAccessMode: (mode: 'Preview' | 'Google Test' | 'Admin Test') => void }) {
  const submitPassword = () => {
    if (password === '1234') {
      setAccessMode('Admin Test')
      close()
    }
  }
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">test build access</p><h2>Launch RAZE</h2><p>Google login is represented as a test placeholder. Skip access is available for preview testing.</p><button className="primary" onClick={() => { setAccessMode('Google Test'); close() }}>Continue with Google</button><button className="skip" onClick={() => { setAccessMode('Preview'); close() }}>Skip for now</button><div className="password-row"><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Test password" type="password" /><button onClick={submitPassword}>Enter</button></div><small>Testing only. Temporary password: 1234.</small></div></div>
}

function Footer() {
  return <footer><div className="footer-giant">RAZE</div><div className="footer-grid">{['Product', 'Registry', 'System', 'Community'].map((col) => <div key={col}><h4>{col}</h4><a>Models</a><a>Dashboard</a><a>Changelog</a><a>Discord</a></div>)}</div><p>RAZE v0.1.0-test / community AI router / free access / Apache 2.0</p></footer>
}

export default App
