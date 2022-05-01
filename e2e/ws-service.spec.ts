import { HttpWsServer } from './utils/http-ws-server'
import { WsService } from '../src/ws.service'

describe('WsService', () => {
  const port = 8003
  let server: HttpWsServer

  beforeEach(async () => {
    server = new HttpWsServer(port)
    await server.listen()
  })

  afterEach(async () => {
    await server.close({ force: true })
  })

  it('gets a message', async () => {
    server.wsServer.on('connection', (ws) => {
      const msg = JSON.stringify({ type: 'hello', value: 'world' })
      ws.send(msg)
    })

    const wsOptions = { url: `ws://localhost:${port}` }
    const ws = new WsService(wsOptions)
    await ws.open()
    const msg = await ws.once({ type: 'hello' })
    expect(msg.value).toBe('world')
  })
})
