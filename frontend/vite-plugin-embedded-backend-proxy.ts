/**
 * tauri:dev：将 /api、/health 代理到 data/backend.port 中的内嵌后端，避免误连 8000。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const DEV_PORT_PATH = '/__autoclip/backend-port'

function readEmbeddedBackendPort(repoRoot: string): number | null {
  try {
    const portFile = path.join(repoRoot, 'data', 'backend.port')
    if (!fs.existsSync(portFile)) return null
    const port = Number.parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10)
    return port > 0 ? port : null
  } catch {
    return null
  }
}

function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetOrigin: string,
  onError?: (message: string) => void
) {
  const url = req.url ?? '/'
  const headers = { ...req.headers, host: new URL(targetOrigin).host }
  const proxyReq = http.request(
    `${targetOrigin}${url}`,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )
  proxyReq.on('error', (err) => {
    onError?.(err.message)
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ detail: `代理到内嵌后端失败: ${err.message}` }))
    }
  })
  req.pipe(proxyReq)
}

export function embeddedBackendProxyPlugin(options: {
  repoRoot: string
  tauriDev: boolean
}): Plugin {
  const { repoRoot, tauriDev } = options
  let lastMissingPortLogAt = 0

  return {
    name: 'embedded-backend-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''

        if (url === DEV_PORT_PATH || url.startsWith(`${DEV_PORT_PATH}?`)) {
          const port = readEmbeddedBackendPort(repoRoot)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ port, ready: port != null }))
          return
        }

        if (!url.startsWith('/api') && !url.startsWith('/health')) {
          next()
          return
        }

        if (!tauriDev) {
          next()
          return
        }

        const port = readEmbeddedBackendPort(repoRoot)
        if (!port) {
          const now = Date.now()
          if (now - lastMissingPortLogAt > 5000) {
            lastMissingPortLogAt = now
            console.warn(
              '[embedded-backend-proxy] 内嵌后端尚未写入 data/backend.port，API 请求暂返回 503'
            )
          }
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ detail: '桌面端后端启动中，请稍候…' }))
          return
        }

        proxyRequest(req, res, `http://127.0.0.1:${port}`)
      })
    },
  }
}

export { DEV_PORT_PATH, readEmbeddedBackendPort }
