import { HttpWsServer } from './utils/http-ws-server'
import { WsService } from '../src/ws.service'
import sleep from 'sleep-promise'

describe('WsService', () => {
  const port = 8003
  const url = `ws://localhost:${port}`
  let server: HttpWsServer

  beforeEach(async () => {
    server = new HttpWsServer(port)
    await server.listen()
  })

  afterEach(async () => {
    await server.close({ force: true })
  })

  describe('send and receive messages', () => {
    it('gets a message by client using `on` method', async () => {
      server.wsServer.on('connection', (ws) => {
        const msg = JSON.stringify({ type: 'hello', value: 'world' })
        ws.send(msg)
      })
      const listener = jest.fn()

      const wsOptions = { url }
      const ws = new WsService(wsOptions)
      await ws.open()
      ws.on({ type: 'hello' }, listener)
      await sleep(100)
      expect(listener.mock.calls[0][0].value).toBe('world')
    })

    it('gets a message by client using `once` method', async () => {
      server.wsServer.on('connection', (ws) => {
        const msg = JSON.stringify({ type: 'hello', value: 'world' })
        ws.send(msg)
      })

      const wsOptions = { url }
      const ws = new WsService(wsOptions)
      await ws.open()
      const msg = await ws.once({ type: 'hello' })
      expect(msg.value).toBe('world')
    })

    it('`sends` a message from server', async () => {
      server.wsServer.on('connection', async (ws) => {
        const ws1 = new WsService({ ws })
        await ws1.send({ type: 'hello', value: 'world' })
      })

      const wsOptions = { url }
      const ws = new WsService(wsOptions)
      await ws.open()
      const msg = await ws.once({ type: 'hello' })
      expect(msg.value).toBe('world')
    })
  })

  describe('reconnect if configured', () => {
    it('reconnects if socket is closed', async () => {
      server.wsServer.on('connection', async (ws) => {
        const msg = JSON.stringify({ type: 'hello', value: 'world' })
        ws.send(msg)
      })
      const listener = jest.fn()

      const wsOptions = { url, reconnect: { delayMs: 500 } }
      const ws = new WsService(wsOptions)
      await ws.open()
      ws.on({ type: 'hello' }, listener, { keep: true })

      server.destroyAllSockets()

      await sleep(1000)
      await ws.close()
      expect(listener).toBeCalledTimes(2)
    })

    it('reconnects if server is down', async () => {
      server.wsServer.on('connection', async (ws) => {
        const msg = JSON.stringify({ type: 'hello', value: 'world' })
        ws.send(msg)
      })
      const listener = jest.fn()

      const wsOptions = { url, reconnect: { delayMs: 500 } }
      const ws = new WsService(wsOptions)
      await ws.open()
      ws.on({ type: 'hello' }, listener, { keep: true })

      await sleep(10)
      expect(listener).toBeCalledTimes(1)

      await server.close({ force: true })
      await sleep(750) // let one reconnect fail
      await server.listen()

      await sleep(500)
      await ws.close()
      expect(listener).toBeCalledTimes(2)
    })
  })
})
