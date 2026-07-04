'use strict'

const http = require('node:http')
const { corsOrigin } = require('./config.cjs')
const { getAnthropicModels, getModels, getOpenAIModels } = require('./models.cjs')
const { requestChat } = require('./chat.cjs')

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key, anthropic-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  response.end(status === 204 ? undefined : JSON.stringify(body))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) reject(Object.assign(new Error('Request body is too large'), { status: 413 }))
    })
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })) }
    })
    request.on('error', reject)
  })
}

async function handleRequest(request, response) {
  if (request.method === 'OPTIONS') return sendJson(response, 204, null)

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { status: 'ok' })
  }

  if (request.method === 'GET' && url.pathname === '/api/models') {
    return sendJson(response, 200, getModels())
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readJson(request)
      const result = await requestChat({ modelId: body.model, messages: body.messages })
      return sendJson(response, 200, result)
    } catch (error) {
      return sendJson(response, error.status || 500, { error: { message: error.message || 'Chat request failed' } })
    }
  }

  const modelPaths = ['/v1/models', '/openai/v1/models', '/anthropic/v1/models']
  if (request.method !== 'GET' || !modelPaths.includes(url.pathname)) {
    return sendJson(response, 404, { error: { type: 'not_found_error', message: 'Route not found' } })
  }

  const useAnthropic = url.pathname.startsWith('/anthropic/') || Boolean(request.headers['anthropic-version'])
  return sendJson(response, 200, useAnthropic ? getAnthropicModels() : getOpenAIModels())
}

function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => sendJson(response, 500, { error: { message: error.message } }))
  })
}

module.exports = { createServer, handleRequest }
