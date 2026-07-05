'use strict'

const codexThreads = new Map()
const claudeSessions = new Map()

function appendDelta(previous, current) {
  if (!current || current === previous) return ''
  return current.startsWith(previous) ? current.slice(previous.length) : current
}

async function runCodex({ conversationId, model, prompt, cwd, signal, onEvent }) {
  const { Codex } = await import('@openai/codex-sdk')
  const key = `${conversationId}:${model.id}`
  let thread = codexThreads.get(key)
  if (!thread) {
    const codex = new Codex({ apiKey: model.api_key, baseUrl: model.endpoint, config: { show_raw_agent_reasoning: true } })
    thread = codex.startThread({ model: model.id, workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: 'workspace-write', approvalPolicy: 'never' })
    codexThreads.set(key, thread)
  }

  const seenText = new Map()
  const { events } = await thread.runStreamed(prompt, { signal })
  for await (const event of events) {
    if (event.type === 'turn.started') onEvent({ type: 'status', status: 'thinking' })
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error(event.message || event.error?.message || 'Codex 执行失败')
    if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
      const item = event.item
      if (item.type === 'agent_message' || item.type === 'reasoning') {
        const previous = seenText.get(item.id) || ''
        const delta = appendDelta(previous, item.text)
        seenText.set(item.id, item.text)
        if (delta) onEvent({ type: item.type === 'reasoning' ? 'reasoning' : 'content', delta })
      } else if (item.type === 'command_execution') {
        onEvent({ type: 'activity', id: item.id, label: `运行命令：${item.command}`, status: item.status, input: item.command, result: item.aggregated_output, exitCode: item.exit_code })
      } else if (item.type === 'file_change') {
        onEvent({ type: 'activity', id: item.id, label: `修改文件：${item.changes.map((change) => change.path).join('、')}`, status: item.status, result: item.changes })
      } else if (item.type === 'mcp_tool_call') {
        onEvent({ type: 'activity', id: item.id, label: `调用工具：${item.server}/${item.tool}`, status: item.status, input: item.arguments, result: item.result || item.error })
      } else if (item.type === 'web_search') {
        onEvent({ type: 'activity', id: item.id, label: `搜索：${item.query}`, status: event.type === 'item.completed' ? 'completed' : 'in_progress' })
      }
    }
    if (event.type === 'turn.completed') onEvent({ type: 'done', usage: event.usage, threadId: thread.id })
  }
}

async function runClaude({ conversationId, model, prompt, cwd, controller, onEvent, requestPermission }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const key = `${conversationId}:${model.id}`
  const seenTools = new Set()
  let streamedText = ''
  let streamedThinking = ''
  const options = {
    abortController: controller,
    cwd,
    model: model.id,
    includePartialMessages: true,
    permissionMode: 'acceptEdits',
    canUseTool: (toolName, input, permissionOptions) => requestPermission({ toolName, input, ...permissionOptions }),
    settingSources: ['user', 'project', 'local'],
    ...(claudeSessions.has(key) ? { resume: claudeSessions.get(key) } : {}),
    env: { ...process.env, ANTHROPIC_API_KEY: model.api_key, ANTHROPIC_BASE_URL: model.endpoint, CLAUDE_AGENT_SDK_CLIENT_APP: 'electron-demo/1.0.0' }
  }

  onEvent({ type: 'status', status: 'thinking' })
  for await (const message of query({ prompt, options })) {
    if (message.session_id) claudeSessions.set(key, message.session_id)
    if (message.type === 'stream_event' && message.event?.type === 'content_block_delta') {
      const delta = message.event.delta
      if (delta?.type === 'text_delta' && delta.text) { streamedText += delta.text; onEvent({ type: 'content', delta: delta.text }) }
      if (delta?.type === 'thinking_delta' && delta.thinking) { streamedThinking += delta.thinking; onEvent({ type: 'reasoning', delta: delta.thinking }) }
    }
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if (block.type === 'text') {
          const delta = appendDelta(streamedText, block.text || '')
          if (delta) { streamedText += delta; onEvent({ type: 'content', delta }) }
        }
        if (block.type === 'thinking') {
          const delta = appendDelta(streamedThinking, block.thinking || '')
          if (delta) { streamedThinking += delta; onEvent({ type: 'reasoning', delta }) }
        }
        if (block.type === 'tool_use' && !seenTools.has(block.id)) {
          seenTools.add(block.id)
          onEvent({ type: 'activity', id: block.id, label: `调用工具：${block.name}`, status: 'in_progress', input: block.input })
        }
      }
      if (message.error) throw new Error(`Claude Agent 执行失败：${message.error}`)
    }
    if (message.type === 'tool_progress') onEvent({ type: 'activity', id: message.tool_use_id, label: `调用工具：${message.tool_name}`, status: 'in_progress' })
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result') continue
        const result = typeof block.content === 'string'
          ? block.content
          : block.content?.map((item) => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n')
        onEvent({ type: 'activity', id: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', result: result || message.tool_use_result })
      }
    }
    if (message.type === 'tool_use_summary') {
      for (const id of message.preceding_tool_use_ids) onEvent({ type: 'activity', id, label: message.summary, status: 'completed' })
    }
    if (message.type === 'result') {
      if (message.is_error) throw new Error(message.errors?.join('；') || 'Claude Agent 执行失败')
      onEvent({ type: 'done', sessionId: message.session_id, usage: message.usage })
    }
  }
}

async function runAgent(options) {
  if (options.runtime === 'codex') return runCodex(options)
  return runClaude(options)
}

module.exports = { runAgent }
