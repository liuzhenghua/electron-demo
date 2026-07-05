import { useEffect, useRef, useState } from 'react'

const icons = {
  chat: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.09 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63h.01A1.7 1.7 0 0 0 10 3.09V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9v.01A1.7 1.7 0 0 0 20.91 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>
}

function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [page, setPage] = useState('chat')
  const [settingsTab, setSettingsTab] = useState('profile')
  const [menuOpen, setMenuOpen] = useState(false)
  const [chats, setChats] = useState([{ id: 1, title: '欢迎使用桌面助手' }])
  const [activeChat, setActiveChat] = useState(1)
  const [runtime, setRuntime] = useState('claude')
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const close = (event) => !menuRef.current?.contains(event.target) && setMenuOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  useEffect(() => {
    const request = window.electronAPI?.getModels
      ? window.electronAPI.getModels()
      : Promise.reject(new Error('Electron API unavailable'))
    request
      .then((result) => setModels(result))
      .catch(() => setModelsError(true))
  }, [])

  const newChat = () => {
    const chat = { id: Date.now(), title: `新对话 ${chats.length + 1}` }
    setChats((items) => [chat, ...items])
    setActiveChat(chat.id)
    setPage('chat')
  }

  if (page === 'settings') {
    return <Settings tab={settingsTab} setTab={setSettingsTab} runtime={runtime} setRuntime={setRuntime} models={models} modelsError={modelsError} onBack={() => setPage('chat')} />
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top">
          <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开导航' : '折叠导航'}><Icon name="menu" /></button>
        </div>
        <button className="new-chat" onClick={newChat}><Icon name="plus" /><span>新增对话</span></button>
        <nav className="chat-list" aria-label="对话列表">
          {chats.map((chat) => <button key={chat.id} className={page === 'chat' && activeChat === chat.id ? 'active' : ''} onClick={() => { setActiveChat(chat.id); setPage('chat') }}><Icon name="chat" /><span>{chat.title}</span></button>)}
        </nav>
        <div className="account" ref={menuRef}>
          {menuOpen && <div className="account-menu">
            <button onClick={() => { setPage('settings'); setSettingsTab('profile'); setMenuOpen(false) }}><Icon name="settings" size={18} />设置</button>
            <button onClick={() => setMenuOpen(false)}><Icon name="logout" size={18} />退出登录</button>
          </div>}
          <button className="account-button" onClick={() => setMenuOpen((value) => !value)}>
            <span className="avatar">林</span>
            {!collapsed && <><span className="account-copy"><strong>林墨</strong><small>linmo@example.com</small></span><Icon name="chevron" size={16} /></>}
          </button>
        </div>
      </aside>
      <section className="content">
        <Chat key={activeChat} conversationId={activeChat} runtime={runtime} models={models} modelsError={modelsError} />
      </section>
    </main>
  )
}

function Chat({ conversationId, runtime, models, modelsError }) {
  const runtimeProvider = runtime === 'claude' ? 'anthropic' : 'openai'
  const availableModels = models.filter((model) => model.model_provider === runtimeProvider)
  const [modelId, setModelId] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')

  useEffect(() => { setModelId(availableModels[0]?.id || '') }, [runtime, models])

  const sendMessage = async () => {
    const content = input.trim()
    if (!content || !modelId || sending) return
    const nextMessages = [...messages, { role: 'user', content }]
    setMessages(nextMessages)
    setInput('')
    setSending(true)
    setChatError('')
    try {
      if (!window.electronAPI?.streamChat) throw new Error('Agent SDK 仅可在 Electron 应用中运行')
      setMessages((items) => [...items, { role: 'assistant', content: '', reasoning: '', activities: [], permissions: [], status: 'thinking', startedAt: Date.now() }])
      const applyEvent = (event) => {
        setMessages((items) => items.map((item, index) => index === items.length - 1 ? {
          ...item,
          content: event.type === 'content' ? item.content + event.delta : item.content,
          reasoning: event.type === 'reasoning' ? item.reasoning + event.delta : item.reasoning,
          activities: event.type === 'activity' ? (item.activities.some((activity) => activity.id === event.id) ? item.activities.map((activity) => activity.id === event.id ? { ...activity, ...event } : activity) : [...item.activities, event]) : item.activities,
          permissions: event.type === 'permission' ? [...item.permissions, { ...event, status: 'pending' }] : item.permissions,
          status: event.type === 'done' ? 'done' : event.type === 'content' && item.status === 'thinking' ? 'answering' : item.status,
          durationMs: (event.type === 'done' || event.type === 'content' && item.status === 'thinking') ? (item.durationMs || Date.now() - item.startedAt) : item.durationMs
        } : item))
      }
      await new Promise((resolve, reject) => {
        let stop
        stop = window.electronAPI.streamChat({ conversationId, runtime, modelId, prompt: content }, (event) => {
          if (event.type === 'error') { stop(); reject(new Error(event.message)); return }
          applyEvent(event)
          if (event.type === 'done') { stop(); resolve() }
        })
      })
    } catch (error) {
      setChatError(error.message)
      setMessages((items) => items.map((item, index) => index === items.length - 1 && item.role === 'assistant' ? { ...item, status: 'error' } : item))
    } finally {
      setSending(false)
    }
  }

  const respondPermission = (permissionId, allowed) => {
    window.electronAPI.respondPermission(permissionId, allowed)
    setMessages((items) => items.map((item) => ({
      ...item,
      permissions: item.permissions?.map((permission) => permission.permissionId === permissionId ? { ...permission, status: allowed ? 'allowed' : 'denied' } : permission)
    })))
  }

  const pendingPermissions = messages.flatMap((message) => message.permissions || []).filter((permission) => permission.status === 'pending')

  return <div className="chat-page">
    <div className={`conversation ${messages.length ? '' : 'empty-state'}`}>
      {!messages.length && <div className="empty-content"><div className="empty-mark"><Icon name="chat" size={28} /></div><h2>今天想聊些什么？</h2><p>当前运行时：{runtime === 'claude' ? 'Claude' : 'Codex'}</p></div>}
      {messages.length > 0 && <div className="messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.role === 'assistant' && <AgentProcess message={message} onPermissionResponse={respondPermission} />}<MessageContent content={message.content} />{sending && index === messages.length - 1 && message.role === 'assistant' && <span className="typing-caret" />}</div>)}</div>}
      {chatError && <p className="chat-error">{chatError}</p>}
      <div className="composer-stack">
        {pendingPermissions.map((permission) => <PermissionPrompt permission={permission} onResponse={respondPermission} key={permission.permissionId} />)}
        <div className="prompt-box">
          <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendMessage() }} placeholder="输入消息…" disabled={sending} />
          <div className="prompt-toolbar">
            <select aria-label="选择模型" disabled={!availableModels.length || sending} value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="" disabled>{modelsError ? '模型服务不可用' : availableModels.length ? '选择模型' : '正在读取模型…'}</option>
              {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
            <button aria-label="发送" onClick={sendMessage} disabled={!modelId || !input.trim() || sending}>{sending ? '…' : '↑'}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
}

function AgentProcess({ message, onPermissionResponse }) {
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [elapsedMs, setElapsedMs] = useState(() => message.durationMs || Date.now() - message.startedAt)

  useEffect(() => {
    if (message.status !== 'thinking') {
      setElapsedMs(message.durationMs || Date.now() - message.startedAt)
      return undefined
    }
    const timer = setInterval(() => setElapsedMs(Date.now() - message.startedAt), 250)
    return () => clearInterval(timer)
  }, [message.status, message.durationMs, message.startedAt])

  useEffect(() => {
    if (message.status === 'answering') setReasoningOpen(false)
  }, [message.status])

  const seconds = Math.max(0.1, elapsedMs / 1000).toFixed(elapsedMs < 10000 ? 1 : 0)
  return <section className="agent-process">
    <div className="reasoning">
      <button className="reasoning-toggle" type="button" aria-expanded={reasoningOpen} onClick={() => setReasoningOpen((value) => !value)}>
        {message.status === 'thinking' && <span className="reasoning-spinner" />}
        <span>{message.status === 'thinking' ? `思考中 · ${seconds} 秒` : `已思考 ${seconds} 秒`}</span>
        <i className={reasoningOpen ? 'open' : ''} />
      </button>
      {reasoningOpen && message.reasoning && <div className="reasoning-content"><MessageContent content={message.reasoning} /></div>}
    </div>
    {message.activities?.length > 0 && <div className="activity-list">{message.activities.map((activity) => <ToolActivity activity={activity} key={activity.id} />)}</div>}
  </section>
}

function PermissionPrompt({ permission, onResponse }) {
  return <div className="permission-prompt"><div><strong>{permission.title || `${permission.displayName || permission.toolName} 请求授权`}</strong>{permission.description && <p>{permission.description}</p>}<code>{summarizeToolInput(permission.input)}</code></div><span><button type="button" onClick={() => onResponse(permission.permissionId, false)}>拒绝</button><button className="allow" type="button" onClick={() => onResponse(permission.permissionId, true)}>允许</button></span></div>
}

function ToolActivity({ activity }) {
  const details = [activity.input && `输入\n${formatToolDetails(activity.input)}`, activity.result && `结果\n${formatToolDetails(activity.result)}`].filter(Boolean).join('\n\n')
  return <details className={`tool-activity ${activity.status}`}><summary><i /><span>{activity.label || '工具调用'}</span><small>{activity.status === 'in_progress' ? '执行中' : activity.status === 'failed' ? '失败' : '已完成'}</small><b /></summary>{details && <pre>{details}</pre>}</details>
}

function formatToolDetails(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function summarizeToolInput(input) {
  if (!input) return ''
  const value = input.url || input.query || input.command || input.file_path || input.path
  return typeof value === 'string' ? value : JSON.stringify(input)
}

function MessageContent({ content }) {
  const renderInline = (line) => line.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)
  return content.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph.split('\n').map((line, lineIndex) => <span key={lineIndex}>{renderInline(line)}{lineIndex < paragraph.split('\n').length - 1 && <br />}</span>)}</p>)
}

function Settings({ tab, setTab, runtime, setRuntime, models, modelsError, onBack }) {
  const currentTitle = tab === 'profile' ? '个人资料' : '配置'
  return <main className="settings-shell">
    <aside className="settings-sidebar">
      <button className="back-button" onClick={onBack}><Icon name="chevron" size={18} />返回对话</button>
      <div className="settings-brand"><span className="settings-mark"><Icon name="settings" size={19} /></span><strong>设置</strong></div>
      <nav className="settings-nav" aria-label="设置导航">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><Icon name="user" size={19} />个人资料</button>
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Icon name="settings" size={19} />配置</button>
      </nav>
    </aside>
    <section className="settings-main">
      <header><p className="overline">偏好设置</p><h1>{currentTitle}</h1><p>管理你的个人信息和本地运行环境。</p></header>
      <div className="settings-body">{tab === 'profile' ? <Profile /> : <RuntimeConfig runtime={runtime} setRuntime={setRuntime} models={models} modelsError={modelsError} />}</div>
    </section>
  </main>
}

function Profile() {
  return <section className="panel"><h2>个人资料</h2><p className="muted">当前登录账户信息（演示数据）</p><div className="profile-hero"><span className="avatar large">林</span><div><strong>林墨</strong><p>linmo@example.com</p></div></div><div className="field-grid"><label>显示名称<input value="林墨" readOnly /></label><label>邮箱地址<input value="linmo@example.com" readOnly /></label></div><button className="primary">保存更改</button></section>
}

function RuntimeConfig({ runtime, setRuntime, models, modelsError }) {
  const groups = [{ id: 'claude', provider: 'anthropic', title: 'Claude', hint: '使用 Anthropic 协议模型' }, { id: 'codex', provider: 'openai', title: 'Codex', hint: '使用 OpenAI 协议模型' }]
  return <section className="panel"><h2>运行时</h2><p className="muted">选择聊天使用的模型运行环境。</p>{modelsError && <p className="load-error">无法连接模型服务，请检查服务地址与运行状态。</p>}<div className="runtime-list">{groups.map((group) => <button type="button" className={`runtime-card ${runtime === group.id ? 'selected' : ''}`} key={group.id} onClick={() => setRuntime(group.id)}><div className={`runtime-logo ${group.id}`}>{group.title[0]}</div><div className="runtime-copy"><strong>{group.title}</strong><span>{group.hint}</span><small>{models.filter((item) => item.model_provider === group.provider).map((item) => `${item.name} · ${(item.context_window / 1000).toLocaleString()}K${item.multimodal ? ' · 多模态' : ''}`).join('　') || (modelsError ? '模型不可用' : '正在读取模型…')}</small></div><span className="runtime-check">{runtime === group.id ? '✓' : ''}</span></button>)}</div></section>
}
