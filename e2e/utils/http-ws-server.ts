import * as http from 'http'
import * as WebSocket from 'ws'
import * as net from 'net'

/**
 * Assume `wsServer` to be created with `noServer: true` option.
 * `httpHandler` can be accessed as `app.handler` in `express` or as `app.callback()` in `koa`.
 *
 * Create http server.
 * Handle 'request' events via `httpHandler`.
 * On 'upgrade' event call `wsServer.handleUpgrade` and emit 'connection' event from `wsServer`.
 */
export function createHttpWsServer(): { httpServer: http.Server; wsServer: WebSocket.Server } {
  const httpServer = http.createServer()

  const wssOptions = { noServer: true }
  const wsServer = new WebSocket.Server(wssOptions)

  httpServer.on('upgrade', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request)
    })
  })

  return { httpServer, wsServer }
}

/**
 * Register `reject` as 'error' events handler.
 * Try to `server.listen`.
 * If successfull then unregister `reject` as 'error' events handler and `resolve`.
 */
export async function listen(server: http.Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.on('error', reject)

    const listenCb = () => {
      server.off('error', reject)
      resolve()
    }
    server.listen(port, listenCb)
  })
}

export async function close(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err != null) reject(err)
      resolve()
    })
  })
}

export class HttpWsServer {
  httpServer: http.Server
  wsServer: WebSocket.Server
  protected sockets = new Set<net.Socket>()

  constructor(protected port: number) {
    const { httpServer, wsServer } = createHttpWsServer()
    httpServer.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
    this.httpServer = httpServer
    this.wsServer = wsServer
  }

  async listen() {
    await listen(this.httpServer, this.port)
  }

  async close({ force = false } = {}) {
    if (force) {
      const { sockets } = this
      for (const socket of sockets) {
        socket.destroy()
        sockets.delete(socket)
      }
    }
    await close(this.httpServer)
  }
}
