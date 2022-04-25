const { WsService } = require('.')

async function main() {
  const ws = new WsService({
    url: 'wss://ws.kraken.com',
    ping: {
      request: { event: 'ping' },
      response: { event: 'pong' },
      heartbeatMs: 1000 * 60 * 10,
      checkAliveMs: 1000 * 10,
    },
    reconnect: {
      autoReconnectDelayMs: 0,
    },
  })

  await ws.open()
  await ws.subscribe(async () => {
    await ws.once({ event: 'systemStatus', status: 'online' })
    ws.on({ event: 'heartbeat' }, () => {})
  })

  const pair = 'XBT/USD'
  const channelName = 'book'
  const levels = 10
  const msg = {
    event: 'subscribe',
    pair: [pair],
    subscription: {
      name: channelName,
      depth: levels,
    },
  }
  await ws.send(msg)

  const fullChannelName = `${channelName}-${levels}`
  const resTemplate = {
    event: 'subscriptionStatus',
    status: 'subscribed',
    pair,
    channelName: fullChannelName,
    subscription: msg.subscription,
  }
  await ws.once(resTemplate)

  const templateFn = (msg) => {
    if (!Array.isArray(msg)) return false
    const [msgChannelName, msgPair] = msg.slice(-2)
    return msgPair === pair && msgChannelName === fullChannelName
  }
  ws.on(templateFn, (msg) => {
    console.log(msg)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
