'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { pathToFileURL } = require('node:url')
require('dotenv').config({ path: path.resolve('.env'), quiet: true })
const { packageKey, packageSpecs, platformKey } = require('../electron/runtime-manager.cjs')

const platform = process.argv.find((argument) => argument.startsWith('--platform='))?.split('=')[1] || platformKey()
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
const output = path.resolve(outputArgument || 'runtime-packages')
const versions = {
  claude: process.env.CLAUDE_AGENT_SDK_VERSION,
  codex: process.env.CODEX_SDK_VERSION
}

function archiveName(spec) {
  return `${spec.installAs.replace(/^@/, '').replaceAll('/', '-')}@${spec.version}.tgz`
}

async function sha512(filename) {
  const hash = crypto.createHash('sha512')
  await pipeline(fs.createReadStream(filename), hash)
  return `sha512-${hash.digest('base64')}`
}

async function main() {
  const specs = [...new Map(['claude', 'codex']
    .flatMap((runtime) => packageSpecs(runtime, platform, versions) || [])
    .map((spec) => [packageKey(spec), spec])).values()]
  if (!specs.length) throw new Error(`不支持的平台：${platform}`)

  await fsp.mkdir(output, { recursive: true })
  const manifestPath = path.join(output, 'manifest.json')
  let manifest = { schemaVersion: 1, packages: {} }
  try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) } catch {}

  for (const spec of specs) {
    const encodedName = spec.name.replace('/', '%2f')
    const metadataResponse = await fetch(`https://registry.npmjs.org/${encodedName}/${spec.version}`)
    if (!metadataResponse.ok) throw new Error(`无法获取 ${spec.name}@${spec.version}（${metadataResponse.status}）`)
    const metadata = await metadataResponse.json()
    const integrity = metadata.dist?.integrity
    const tarball = metadata.dist?.tarball
    if (!integrity || !tarball) throw new Error(`${spec.name}@${spec.version} 缺少下载信息`)

    const file = archiveName(spec)
    const destination = path.join(output, file)
    let reusable = false
    try { reusable = await sha512(destination) === integrity } catch {}
    if (reusable) {
      console.log(`复用 ${file}`)
    } else {
      console.log(`下载 ${spec.installAs}...`)
      const response = await fetch(tarball)
      if (!response.ok || !response.body) throw new Error(`下载 ${spec.installAs} 失败（${response.status}）`)
      const temporary = `${destination}.downloading`
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary))
      if (await sha512(temporary) !== integrity) {
        await fsp.rm(temporary, { force: true })
        throw new Error(`${spec.installAs} 完整性校验失败`)
      }
      await fsp.rename(temporary, destination)
    }
    manifest.packages[packageKey(spec)] = { file, integrity }
  }

  manifest.updatedAt = new Date().toISOString()
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\n运行时文件已准备到：${output}`)
  console.log(`RUNTIME_DOWNLOAD_BASE_URL=${pathToFileURL(`${output}${path.sep}`).href}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
