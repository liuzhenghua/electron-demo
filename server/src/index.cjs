'use strict'

const { createServer } = require('./app.cjs')
const { host, port } = require('./config.cjs')

const server = createServer()

server.listen(port, host, () => {
  console.log(`Model API server listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
