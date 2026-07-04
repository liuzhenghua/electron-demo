'use strict'

const { models } = require('./config.cjs')

function getModels() {
  return { data: models }
}

function getOpenAIModels() {
  return {
    object: 'list',
    data: models.filter((model) => model.model_provider === 'openai').map((model) => ({
      id: model.id,
      object: 'model',
      created: 1735689600,
      owned_by: model.model_provider
    }))
  }
}

function getAnthropicModels() {
  const data = models.filter((model) => model.model_provider === 'anthropic').map((model) => ({
    id: model.id,
    type: 'model',
    display_name: model.name,
    created_at: '2025-01-01T00:00:00Z'
  }))

  return {
    data,
    has_more: false,
    first_id: data.at(0)?.id || null,
    last_id: data.at(-1)?.id || null
  }
}

module.exports = { getAnthropicModels, getModels, getOpenAIModels, models }
