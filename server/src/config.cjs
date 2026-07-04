'use strict'

const path = require('node:path')
const dotenv = require('dotenv')
const models = require('../data/models.json')

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })

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
