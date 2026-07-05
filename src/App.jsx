import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

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
  const [chats, setChats] = useState([])
  const [activeChat, setActiveChat] = useState(null)
  const [activeConversation, setActiveConversation] = useState(null)
  const [chatMenu, setChatMenu] = useState(null)
  const [runtime, setRuntime] = useState('claude')
  const [selectedModels, setSelectedModels] = useState({})
  const [accessMode, setAccessMode] = useState('approval')
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
      if (!event.target.closest?.('.chat-context-menu')) setChatMenu(null)
    }
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

  useEffect(() => {
    if (!window.electronAPI?.listConversations) return
    Promise.all([window.electronAPI.getSettings(), window.electronAPI.listConversations()]).then(async ([settings, savedChats]) => {
      setRuntime(settings.runtime || 'claude')
      setSelectedModels(settings.selectedModels || {})
      setAccessMode(settings.accessMode || 'approval')
      if (savedChats.length) {
        setChats(savedChats)
        await openChat(savedChats[0].id)
      } else {
        await createChat(settings.runtime || 'claude')
      }
    }).catch(console.error)
  }, [])

  const persistSettings = (patch) => window.electronAPI?.updateSettings?.(patch).catch(console.error)
  const changeRuntime = (value) => { setRuntime(value); persistSettings({ runtime: value }) }
  const changeModel = (runtimeId, modelId) => {
    setSelectedModels((current) => {
      const next = { ...current, [runtimeId]: modelId }
      persistSettings({ selectedModels: next })
      return next
    })
  }
  const changeAccessMode = (value) => { setAccessMode(value); persistSettings({ accessMode: value }) }

  async function openChat(id) {
    const conversation = await window.electronAPI.getConversation(id)
    if (!conversation) return
    setActiveConversation(conversation)
    setActiveChat(id)
    if (conversation.runtime && conversation.runtime !== runtime) changeRuntime(conversation.runtime)
    setPage('chat')
  }

  async function createChat(runtimeOverride = runtime) {
    const now = new Date().toISOString()
    const conversation = { id: crypto.randomUUID(), title: '新对话', createdAt: now, updatedAt: now, runtime: runtimeOverride, messages: [] }
    const saved = await window.electronAPI.saveConversation(conversation)
    setChats((items) => [{ id: saved.id, title: saved.title, createdAt: saved.createdAt, updatedAt: saved.updatedAt, runtime: saved.runtime }, ...items])
    setActiveConversation(saved)
    setActiveChat(saved.id)
    setPage('chat')
  }

  const deleteChat = async (id) => {
    if (activeChat === id) setActiveConversation(null)
    await window.electronAPI.deleteConversation(id)
    const remaining = chats.filter((chat) => chat.id !== id)
    setChats(remaining)
    setChatMenu(null)
    if (activeChat !== id) return
    if (remaining.length) await openChat(remaining[0].id)
    else await createChat()
  }

  const deleteAllChats = async () => {
    await window.electronAPI.deleteAllConversations()
    setChats([])
    setActiveChat(null)
    setActiveConversation(null)
    await createChat()
  }

  const updateChatMetadata = (conversation) => {
    if (!conversation) return
    setActiveConversation(conversation)
    setChats((items) => items.map((chat) => chat.id === conversation.id
      ? { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, runtime: conversation.runtime }
      : chat).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)))
  }

  if (page === 'settings') {
    return <Settings tab={settingsTab} setTab={setSettingsTab} runtime={runtime} setRuntime={changeRuntime} models={models} modelsError={modelsError} onDeleteAll={deleteAllChats} onBack={() => setPage('chat')} />
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top">
          <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开导航' : '折叠导航'}><Icon name="menu" /></button>
        </div>
        <button className="new-chat" onClick={() => createChat()}><Icon name="plus" /><span>新增对话</span></button>
        <nav className="chat-list" aria-label="对话列表">
          {chats.map((chat) => <button key={chat.id} className={page === 'chat' && activeChat === chat.id ? 'active' : ''} onClick={() => openChat(chat.id)} onContextMenu={(event) => { event.preventDefault(); setChatMenu({ id: chat.id, x: event.clientX, y: event.clientY }) }}><Icon name="chat" /><span>{chat.title}</span></button>)}
        </nav>
        {chatMenu && <div className="chat-context-menu" style={{ left: chatMenu.x, top: chatMenu.y }}><button type="button" onClick={() => deleteChat(chatMenu.id)}>删除会话</button></div>}
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
        {activeConversation && <Chat key={activeChat} conversation={activeConversation} runtime={runtime} models={models} modelsError={modelsError} selectedModel={selectedModels[runtime]} accessMode={accessMode} onModelChange={(modelId) => changeModel(runtime, modelId)} onAccessModeChange={changeAccessMode} onSaved={updateChatMetadata} />}
      </section>
    </main>
  )
}

function Chat({ conversation, runtime, models, modelsError, selectedModel, accessMode, onModelChange, onAccessModeChange, onSaved }) {
  const conversationId = conversation.id
  const runtimeProvider = runtime === 'claude' ? 'anthropic' : 'openai'
  const availableModels = models.filter((model) => model.model_provider === runtimeProvider)
  const [modelId, setModelId] = useState(selectedModel || '')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => restoreMessages(conversation.messages || []))
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const scrollRef = useRef(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const followOutputRef = useRef(true)
  const saveTimerRef = useRef(null)
  const titleRef = useRef(conversation.title || '新对话')
  const latestMessagesRef = useRef(messages)
  const saveReadyRef = useRef(false)
  latestMessagesRef.current = messages

  useEffect(() => {
    const next = selectedModel && availableModels.some((model) => model.id === selectedModel) ? selectedModel : availableModels[0]?.id || ''
    setModelId(next)
    if (next && next !== selectedModel) onModelChange(next)
  }, [runtime, models, selectedModel])
  useEffect(() => {
    if (!saveReadyRef.current) {
      saveReadyRef.current = true
      return undefined
    }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.electronAPI.saveConversation({ id: conversationId, title: titleRef.current, runtime, messages }).then(onSaved).catch(console.error)
    }, 250)
    return () => clearTimeout(saveTimerRef.current)
  }, [messages, runtime])
  useEffect(() => () => {
    clearTimeout(saveTimerRef.current)
    window.electronAPI.saveConversation({ id: conversationId, title: titleRef.current, runtime, messages: latestMessagesRef.current }).catch(console.error)
  }, [])
  useEffect(() => {
    if (!followOutputRef.current) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, chatError])
  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = 'auto'
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`
  }, [input])

  const sendMessage = async () => {
    const content = input.trim()
    if (!content || !modelId || sending) return
    followOutputRef.current = true
    if (!messages.length) titleRef.current = content.replace(/\s+/g, ' ').slice(0, 28) || '新对话'
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
        stop = window.electronAPI.streamChat({ conversationId, runtime, modelId, accessMode, prompt: content }, (event) => {
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
  const trackScrollPosition = () => {
    const element = scrollRef.current
    if (!element) return
    followOutputRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72
  }

  return <div className="chat-page">
    <div className={`conversation ${messages.length ? '' : 'empty-state'}`}>
      <div className="conversation-scroll" ref={scrollRef} onScroll={trackScrollPosition}>
        {!messages.length && <div className="empty-content"><div className="empty-mark"><Icon name="chat" size={28} /></div><h2>今天想聊些什么？</h2><p>当前运行时：{runtime === 'claude' ? 'Claude' : 'Codex'}</p></div>}
        {messages.length > 0 && <div className="messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.role === 'assistant' && <AgentProcess message={message} />}<MessageContent content={message.content} />{sending && index === messages.length - 1 && message.role === 'assistant' && <span className="typing-caret" />}</div>)}</div>}
        {chatError && <p className="chat-error">{chatError}</p>}
        <div ref={endRef} />
      </div>
      <div className="composer-stack">
        {pendingPermissions.map((permission) => <PermissionPrompt permission={permission} onResponse={respondPermission} key={permission.permissionId} />)}
        <div className="prompt-box">
          <textarea ref={inputRef} rows="1" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} placeholder="输入消息…" disabled={sending} />
          <div className="prompt-toolbar">
            <div className="prompt-options">
              <select aria-label="选择模型" disabled={!availableModels.length || sending} value={modelId} onChange={(event) => { setModelId(event.target.value); onModelChange(event.target.value) }}>
                <option value="" disabled>{modelsError ? '模型服务不可用' : availableModels.length ? '选择模型' : '正在读取模型…'}</option>
                {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              <select className={`access-mode ${accessMode}`} aria-label="权限模式" title={accessMode === 'full' ? 'Agent 可在不询问的情况下访问系统' : '敏感工具调用前请求批准'} disabled={sending} value={accessMode} onChange={(event) => onAccessModeChange(event.target.value)}>
                <option value="approval">请求批准</option>
                <option value="full">完全访问权限</option>
              </select>
            </div>
            <button aria-label="发送" onClick={sendMessage} disabled={!modelId || !input.trim() || sending}>{sending ? '…' : '↑'}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
}

function AgentProcess({ message }) {
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

function restoreMessages(messages) {
  return messages.map((message) => message.role !== 'assistant' ? message : {
    ...message,
    status: message.status === 'thinking' || message.status === 'answering' ? 'done' : message.status,
    durationMs: message.durationMs || (message.startedAt ? Date.now() - message.startedAt : 0),
    permissions: (message.permissions || []).map((permission) => permission.status === 'pending' ? { ...permission, status: 'denied' } : permission),
    activities: (message.activities || []).map((activity) => activity.status === 'in_progress' ? { ...activity, status: 'failed', result: activity.result || '会话在工具执行完成前已中断' } : activity)
  })
}

function MessageContent({ content }) {
  if (!content) return null
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
  }}>{content}</ReactMarkdown></div>
}

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false)
  const className = children?.props?.className || ''
  const language = className.match(/language-([^\s]+)/)?.[1] || 'text'
  const code = String(children?.props?.children || '').replace(/\n$/, '')
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return <div className="code-block"><header><span>{language}</span><button type="button" onClick={copy}>{copied ? '已复制' : '复制'}</button></header><pre>{children}</pre></div>
}

function Settings({ tab, setTab, runtime, setRuntime, models, modelsError, onDeleteAll, onBack }) {
  const currentTitle = tab === 'profile' ? '个人资料' : tab === 'config' ? '配置' : '数据管理'
  return <main className="settings-shell">
    <aside className="settings-sidebar">
      <button className="back-button" onClick={onBack}><Icon name="chevron" size={18} />返回对话</button>
      <div className="settings-brand"><span className="settings-mark"><Icon name="settings" size={19} /></span><strong>设置</strong></div>
      <nav className="settings-nav" aria-label="设置导航">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><Icon name="user" size={19} />个人资料</button>
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Icon name="settings" size={19} />配置</button>
        <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><Icon name="chat" size={19} />数据管理</button>
      </nav>
    </aside>
    <section className="settings-main">
      <header><p className="overline">偏好设置</p><h1>{currentTitle}</h1><p>管理你的个人信息和本地运行环境。</p></header>
      <div className="settings-body">{tab === 'profile' ? <Profile /> : tab === 'config' ? <RuntimeConfig runtime={runtime} setRuntime={setRuntime} models={models} modelsError={modelsError} /> : <DataManagement onDeleteAll={onDeleteAll} />}</div>
    </section>
  </main>
}

function DataManagement({ onDeleteAll }) {
  const [openError, setOpenError] = useState('')
  const openDirectory = async () => {
    try {
      setOpenError('')
      await window.electronAPI.openConversationsDirectory()
    } catch (error) {
      setOpenError(error.message || '无法打开会话目录')
    }
  }
  const remove = async () => {
    if (!window.confirm('确定删除所有历史会话吗？此操作无法撤销。')) return
    await onDeleteAll()
  }
  return <section className="panel"><h2>会话数据</h2><p className="muted">聊天记录保存在当前设备的应用数据目录中。</p><div className="data-action"><div><strong>本地会话目录</strong><p>查看 settings.json 和 conversations 会话文件。</p>{openError && <p className="data-error">{openError}</p>}</div><button type="button" onClick={openDirectory}>打开会话目录</button></div><div className="danger-zone"><div><strong>删除所有会话</strong><p>清除应用保存的聊天内容和 SDK 会话关联，新对话会自动创建。</p></div><button type="button" onClick={remove}>删除所有会话</button></div></section>
}

function Profile() {
  return <section className="panel"><h2>个人资料</h2><p className="muted">当前登录账户信息（演示数据）</p><div className="profile-hero"><span className="avatar large">林</span><div><strong>林墨</strong><p>linmo@example.com</p></div></div><div className="field-grid"><label>显示名称<input value="林墨" readOnly /></label><label>邮箱地址<input value="linmo@example.com" readOnly /></label></div><button className="primary">保存更改</button></section>
}

function RuntimeConfig({ runtime, setRuntime, models, modelsError }) {
  const groups = [{ id: 'claude', provider: 'anthropic', title: 'Claude', hint: '使用 Anthropic 协议模型' }, { id: 'codex', provider: 'openai', title: 'Codex', hint: '使用 OpenAI 协议模型' }]
  return <section className="panel"><h2>运行时</h2><p className="muted">选择聊天使用的模型运行环境。</p>{modelsError && <p className="load-error">无法连接模型服务，请检查服务地址与运行状态。</p>}<div className="runtime-list">{groups.map((group) => <button type="button" className={`runtime-card ${runtime === group.id ? 'selected' : ''}`} key={group.id} onClick={() => setRuntime(group.id)}><div className={`runtime-logo ${group.id}`}>{group.title[0]}</div><div className="runtime-copy"><strong>{group.title}</strong><span>{group.hint}</span><small>{models.filter((item) => item.model_provider === group.provider).map((item) => `${item.name} · ${(item.context_window / 1000).toLocaleString()}K${item.multimodal ? ' · 多模态' : ''}`).join('　') || (modelsError ? '模型不可用' : '正在读取模型…')}</small></div><span className="runtime-check">{runtime === group.id ? '✓' : ''}</span></button>)}</div></section>
}
