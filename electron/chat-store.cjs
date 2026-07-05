'use strict'

const path = require('node:path')
const fs = require('node:fs/promises')

class ChatStore {
  constructor(userDataPath) {
    this.root = path.join(userDataPath, 'chat-data')
    this.conversationsDir = path.join(this.root, 'conversations')
    this.settingsPath = path.join(this.root, 'settings.json')
    this.deletedConversationIds = new Set()
    this.writeQueues = new Map()
  }

  async initialize() {
    await fs.mkdir(this.conversationsDir, { recursive: true })
  }

  conversationPath(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('无效的会话 ID')
    return path.join(this.conversationsDir, `${id}.json`)
  }

  async readJson(file, fallback = null) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw error
    }
  }

  async writeJson(file, value) {
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, file)
  }

  async listConversations() {
    const files = (await fs.readdir(this.conversationsDir)).filter((file) => file.endsWith('.json'))
    const conversations = (await Promise.all(files.map((file) => this.readJson(path.join(this.conversationsDir, file))))).filter(Boolean)
    return conversations
      .map(({ id, title, createdAt, updatedAt, runtime }) => ({ id, title, createdAt, updatedAt, runtime }))
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
  }

  async getConversation(id) {
    return this.readJson(this.conversationPath(id))
  }

  async saveConversation(input) {
    if (this.deletedConversationIds.has(input.id)) return null
    const previousWrite = this.writeQueues.get(input.id) || Promise.resolve()
    const write = previousWrite.then(() => this.saveConversationNow(input))
    this.writeQueues.set(input.id, write.catch(() => {}))
    return write
  }

  async saveConversationNow(input) {
    if (this.deletedConversationIds.has(input.id)) return null
    const now = new Date().toISOString()
    const previous = await this.getConversation(input.id)
    const conversation = {
      id: input.id,
      title: input.title || previous?.title || '新对话',
      createdAt: previous?.createdAt || input.createdAt || now,
      updatedAt: now,
      runtime: input.runtime || previous?.runtime || 'claude',
      messages: input.messages || previous?.messages || [],
      sdkSessions: previous?.sdkSessions || {},
      ...input,
      sdkSessions: { ...(previous?.sdkSessions || {}), ...(input.sdkSessions || {}) },
      updatedAt: now
    }
    await this.writeJson(this.conversationPath(input.id), conversation)
    return conversation
  }

  async saveSdkSession(id, key, sessionId) {
    if (!sessionId) return
    const previousWrite = this.writeQueues.get(id) || Promise.resolve()
    const write = previousWrite.then(async () => {
      if (this.deletedConversationIds.has(id)) return null
      const conversation = await this.getConversation(id)
      if (!conversation) return null
      return this.saveConversationNow({ ...conversation, sdkSessions: { ...conversation.sdkSessions, [key]: sessionId } })
    })
    this.writeQueues.set(id, write.catch(() => {}))
    await write
  }

  async deleteConversation(id) {
    this.deletedConversationIds.add(id)
    await (this.writeQueues.get(id) || Promise.resolve())
    await fs.rm(this.conversationPath(id), { force: true })
  }

  async deleteAllConversations() {
    const files = (await fs.readdir(this.conversationsDir)).filter((file) => file.endsWith('.json'))
    files.forEach((file) => this.deletedConversationIds.add(file.slice(0, -5)))
    await Promise.all(this.writeQueues.values())
    await Promise.all(files.map((file) => fs.rm(path.join(this.conversationsDir, file), { force: true })))
  }

  async getSettings() {
    return {
      runtime: 'claude',
      selectedModels: {},
      accessMode: 'approval',
      ...(await this.readJson(this.settingsPath, {}))
    }
  }

  async updateSettings(patch) {
    const settings = { ...(await this.getSettings()), ...patch }
    await this.writeJson(this.settingsPath, settings)
    return settings
  }
}

module.exports = { ChatStore }
