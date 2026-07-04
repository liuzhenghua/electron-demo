'use strict'

const { models } = require('./config.cjs')

function getTextContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
}

async function requestChat({ modelId, messages }) {
  const model = models.find((item) => item.id === modelId)
  if (!model) throw Object.assign(new Error('Model not found'), { status: 404 })
  if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('messages must not be empty'), { status: 400 })

  const isAnthropic = model.model_provider === 'anthropic'
  const url = isAnthropic ? `${model.endpoint.replace(/\/$/, '')}/v1/messages` : `${model.endpoint.replace(/\/$/, '')}/chat/completions`
  const system = messages.filter((message) => message.role === 'system').map((message) => getTextContent(message.content)).join('\n')
  const body = isAnthropic
    ? {
        model: model.id,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: messages.filter((message) => message.role !== 'system')
      }
    : { model: model.id, messages }
  const headers = isAnthropic
    ? { 'content-type': 'application/json', 'x-api-key': model.api_key, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${model.api_key}` }

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = result.error?.message || `Upstream request failed with status ${response.status}`
    throw Object.assign(new Error(message), { status: 502 })
  }

  const content = isAnthropic
    ? result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    : getTextContent(result.choices?.[0]?.message?.content)

  return { model: model.id, message: { role: 'assistant', content: content || '' } }
}

module.exports = { requestChat }
