'use strict'

const path = require('node:path')
const dotenv = require('dotenv')
const modelDefinitions = require('../data/models.json')

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })

function resolveEnvironment(value) {
  if (Array.isArray(value)) return value.map(resolveEnvironment)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvironment(item)]))
  }
  if (typeof value !== 'string') return value

  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    const resolved = process.env[name]
    if (resolved === undefined || resolved === '') throw new Error(`Environment variable ${name} is required by models.json`)
    return resolved
  })
}

const models = resolveEnvironment(modelDefinitions)

if (!models.some((model) => model.model_provider === 'openai') || !models.some((model) => model.model_provider === 'anthropic')) {
  throw new Error('models.json must configure at least one OpenAI model and one Anthropic model')
}

const requiredModelFields = ['id', 'name', 'model_provider', 'endpoint', 'api_key', 'context_window', 'multimodal']
for (const model of models) {
  const missingField = requiredModelFields.find((field) => model[field] === undefined || model[field] === '')
  if (missingField) throw new Error(`Model ${model.id || '<unknown>'} is missing ${missingField}`)
}

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: Number.parseInt(process.env.PORT || '4123', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  models
}
