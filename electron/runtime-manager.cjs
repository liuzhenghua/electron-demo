'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { fileURLToPath, pathToFileURL } = require('node:url')
const tar = require('tar')

const DEFAULT_VERSIONS = {
  claude: '0.3.201',
  codex: '0.142.5'
}

function validVersion(value, fallback) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.trim()) ? value.trim() : fallback
}

function createRuntimes(versions = {}) {
  return {
  claude: {
    label: 'Claude',
    version: validVersion(versions.claude, DEFAULT_VERSIONS.claude),
    entry: '@anthropic-ai/claude-agent-sdk',
    base: '@anthropic-ai/claude-agent-sdk',
    native: {
      'darwin-arm64': '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      'darwin-x64': '@anthropic-ai/claude-agent-sdk-darwin-x64',
      'win32-arm64': '@anthropic-ai/claude-agent-sdk-win32-arm64',
      'win32-x64': '@anthropic-ai/claude-agent-sdk-win32-x64',
      'linux-arm64': '@anthropic-ai/claude-agent-sdk-linux-arm64',
      'linux-x64': '@anthropic-ai/claude-agent-sdk-linux-x64',
      'linux-arm64-musl': '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
      'linux-x64-musl': '@anthropic-ai/claude-agent-sdk-linux-x64-musl'
    }
  },
  codex: {
    label: 'Codex',
    version: validVersion(versions.codex, DEFAULT_VERSIONS.codex),
    entry: '@openai/codex-sdk',
    base: '@openai/codex',
    sdk: '@openai/codex-sdk',
    native: {
      'darwin-arm64': '@openai/codex-darwin-arm64',
      'darwin-x64': '@openai/codex-darwin-x64',
      'win32-arm64': '@openai/codex-win32-arm64',
      'win32-x64': '@openai/codex-win32-x64',
      'linux-arm64': '@openai/codex-linux-arm64',
      'linux-x64': '@openai/codex-linux-x64'
    }
  }
  }
}

function platformKey() {
  if (process.platform !== 'linux') return `${process.platform}-${process.arch}`
  const report = process.report?.getReport?.()
  const libc = report?.header?.glibcVersionRuntime ? '' : '-musl'
  return `linux-${process.arch}${libc}`
}

function packageDirectory(root, packageName) {
  return path.join(root, 'node_modules', ...packageName.split('/'))
}

function packageSpecs(id, key = platformKey(), versions = {}) {
  const config = createRuntimes(versions)[id]
  const nativePackage = config.native[key]
  if (!nativePackage) return null
  const packages = [config.sdk, config.base].filter(Boolean).map((name) => ({ name, version: config.version, installAs: name }))
  if (id === 'codex') {
    packages.push({ name: '@openai/codex', version: `${config.version}-${nativePackage.slice('@openai/codex-'.length)}`, installAs: nativePackage })
  } else {
    packages.push({ name: nativePackage, version: config.version, installAs: nativePackage })
  }
  return packages
}

function packageKey({ name, version, installAs }) {
  return `${name}@${version}=>${installAs}`
}

class RuntimeManager {
  constructor({ root, fetch, isPackaged, downloadBaseUrl, versions }) {
    this.root = root
    this.fetch = fetch
    this.isPackaged = isPackaged
    this.downloadBaseUrl = downloadBaseUrl?.trim().replace(/\/?$/, '/') || null
    this.runtimes = createRuntimes(versions)
    this.manifestPromise = null
    this.listeners = new Set()
    this.installing = new Map()
    this.modules = new Map()
    this.statuses = Object.fromEntries(Object.entries(this.runtimes).map(([id, config]) => [id, {
      id,
      label: config.label,
      state: isPackaged ? 'checking' : 'ready',
      progress: isPackaged ? 0 : 100
    }]))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatuses() {
    return Object.values(this.statuses).map((status) => ({ ...status }))
  }

  setStatus(id, patch) {
    this.statuses[id] = { ...this.statuses[id], ...patch }
    const snapshot = { ...this.statuses[id] }
    for (const listener of this.listeners) listener(snapshot)
  }

  runtimeRoot(id) {
    const config = this.runtimes[id]
    return path.join(this.root, id, config.version, platformKey())
  }

  markerPath(id) {
    return path.join(this.runtimeRoot(id), '.installed.json')
  }

  async initialize() {
    if (!this.isPackaged) return
    await Promise.all(Object.keys(this.runtimes).map(async (id) => {
      const installed = await this.isInstalled(id)
      this.setStatus(id, { state: installed ? 'ready' : 'pending', progress: installed ? 100 : 0 })
    }))
  }

  async isInstalled(id) {
    try {
      const marker = JSON.parse(await fsp.readFile(this.markerPath(id), 'utf8'))
      return marker.version === this.runtimes[id].version && marker.platform === platformKey()
    } catch {
      return false
    }
  }

  async installAll() {
    const results = []
    // 顺序安装，避免两个 200MB 级下载同时争抢用户带宽。
    for (const id of Object.keys(this.runtimes)) {
      try {
        await this.ensureInstalled(id)
        results.push({ id, status: 'fulfilled' })
      } catch (reason) {
        results.push({ id, status: 'rejected', reason })
      }
    }
    return results
  }

  ensureInstalled(id) {
    if (!this.runtimes[id]) return Promise.reject(new Error(`不支持的运行时：${id}`))
    if (!this.isPackaged) return Promise.resolve()
    if (this.statuses[id].state === 'ready') return Promise.resolve()
    if (this.installing.has(id)) return this.installing.get(id)

    const task = this.install(id).finally(() => this.installing.delete(id))
    this.installing.set(id, task)
    return task
  }

  async install(id) {
    const config = this.runtimes[id]
    const packages = packageSpecs(id, platformKey(), { claude: this.runtimes.claude.version, codex: this.runtimes.codex.version })
    if (!packages) {
      const message = `暂不支持当前系统（${platformKey()}）`
      this.setStatus(id, { state: 'error', message })
      throw new Error(message)
    }

    const target = this.runtimeRoot(id)
    const temporary = `${target}.installing-${process.pid}`
    this.setStatus(id, { state: 'installing', progress: 0, message: `正在准备 ${config.label}` })

    try {
      await fsp.rm(temporary, { recursive: true, force: true })
      await fsp.mkdir(temporary, { recursive: true })
      await fsp.writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true }))

      for (let index = 0; index < packages.length; index += 1) {
        const packageSpec = packages[index]
        await this.installPackage(packageSpec, temporary, (fileProgress) => {
          const progress = Math.round(((index + fileProgress / 100) / packages.length) * 100)
          this.setStatus(id, { state: 'installing', progress, message: `正在安装 ${config.label}` })
        })
      }

      await fsp.writeFile(path.join(temporary, '.installed.json'), JSON.stringify({
        runtime: id,
        version: config.version,
        platform: platformKey(),
        installedAt: new Date().toISOString()
      }))
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.rm(target, { recursive: true, force: true })
      await fsp.rename(temporary, target)
      this.setStatus(id, { state: 'ready', progress: 100, message: `${config.label} 已就绪` })
    } catch (error) {
      await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {})
      const message = error.message || `${config.label} 安装失败`
      this.setStatus(id, { state: 'error', progress: 0, message })
      throw error
    }
  }

  async installPackage({ name: packageName, version, installAs }, root, onProgress) {
    const source = await this.resolvePackageSource({ name: packageName, version, installAs })
    const { tarball, integrity } = source
    if (!tarball || !integrity?.startsWith('sha512-')) throw new Error(`${packageName} 缺少可信的下载信息`)

    const archive = path.join(root, `.download-${crypto.randomUUID()}.tgz`)
    await this.downloadFile(tarball, archive, packageName, onProgress)

    const actual = `sha512-${crypto.createHash('sha512').update(await fsp.readFile(archive)).digest('base64')}`
    const expected = Buffer.from(integrity.slice(7), 'base64')
    const receivedHash = Buffer.from(actual.slice(7), 'base64')
    if (expected.length !== receivedHash.length || !crypto.timingSafeEqual(expected, receivedHash)) {
      throw new Error(`${packageName} 下载校验失败`)
    }

    const destination = packageDirectory(root, installAs)
    await fsp.mkdir(destination, { recursive: true })
    await tar.x({ file: archive, cwd: destination, strip: 1 })
    await fsp.unlink(archive)
    onProgress(100)
  }

  async resolvePackageSource(spec) {
    if (this.downloadBaseUrl) {
      const manifest = await this.getDownloadManifest()
      const item = manifest.packages?.[packageKey(spec)]
      if (!item?.file || !item.integrity) throw new Error(`下载源缺少 ${spec.installAs}`)
      return { tarball: new URL(item.file, this.downloadBaseUrl).href, integrity: item.integrity }
    }
    const encodedName = spec.name.replace('/', '%2f')
    const response = await this.fetch(`https://registry.npmjs.org/${encodedName}/${spec.version}`)
    if (!response.ok) throw new Error(`无法获取 ${spec.name}（${response.status}）`)
    const metadata = await response.json()
    return metadata.dist || {}
  }

  getDownloadManifest() {
    if (!this.manifestPromise) {
      const url = new URL('manifest.json', this.downloadBaseUrl)
      this.manifestPromise = url.protocol === 'file:'
        ? fsp.readFile(fileURLToPath(url), 'utf8').then(JSON.parse)
        : this.fetch(url.href).then(async (response) => {
          if (!response.ok) throw new Error(`无法读取运行时下载清单（${response.status}）`)
          return response.json()
        })
    }
    return this.manifestPromise
  }

  async downloadFile(source, destination, packageName, onProgress) {
    const url = new URL(source)
    let readable
    let total
    if (url.protocol === 'file:') {
      const filename = fileURLToPath(url)
      total = (await fsp.stat(filename)).size
      readable = fs.createReadStream(filename)
    } else {
      const response = await this.fetch(url.href)
      if (!response.ok || !response.body) throw new Error(`下载 ${packageName} 失败（${response.status}）`)
      total = Number(response.headers.get('content-length')) || 0
      readable = Readable.fromWeb(response.body)
    }
    let received = 0
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        onProgress(total ? Math.min(99, received / total * 100) : 50)
        callback(null, chunk)
      }
    })
    await pipeline(readable, progress, fs.createWriteStream(destination))
  }

  async load(id) {
    if (this.modules.has(id)) return this.modules.get(id)
    await this.ensureInstalled(id)
    if (!this.isPackaged) {
      const module = await import(this.runtimes[id].entry)
      this.modules.set(id, module)
      return module
    }
    const root = this.runtimeRoot(id)
    const packageRoot = packageDirectory(root, this.runtimes[id].entry)
    const packageJson = JSON.parse(await fsp.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    const exported = packageJson.exports?.['.']
    const relativeEntry = exported?.import || exported?.default || packageJson.module || packageJson.main
    if (!relativeEntry) throw new Error(`${this.runtimes[id].label} SDK 缺少入口文件`)
    const entry = path.join(packageRoot, relativeEntry)
    const module = await import(pathToFileURL(entry).href)
    this.modules.set(id, module)
    return module
  }
}

module.exports = { DEFAULT_VERSIONS, RuntimeManager, packageKey, packageSpecs, platformKey }
