# clear-ws

Working with websockets traditionally has some issues. Messy handling of messages, convoluted and leaky reconnect logic. This is especially true when dealing with messages of different types on a single connection.

This package aims to resolve these issues by:

- providing ways to route messages by template object (similar to `app.use('/endpoint', handler)` in express),
- tracking of connection status and reconnecting if needed,
- taking steps necessary to restore subscriptions to data channels after reconnect.

## API

- Send and receive messages (can be used on client and on server):
  - `open`, `close` and `send` methods return promises.
  - `on` method accepts a template object or a matcher function to listen\* for matching incoming messages.
  - `once` method returns a promise to await for a single incoming message.
- Reconnect:
  - Send ping requests on a set interval (`ping.heartbeatMs` option).
  - Send a ping request if there are no incoming messages for a set amount of time (`ping.checkAliveMs` option).
  - Restore dead connection and subscriptions (`reconnect.delayMs` option).
  - `subscribe` method accepts a function that performs steps required to restore a subsciption.

\*) NOTE: Listeners are cleared after the connection is closed. Use `keep: true` option or `subscribe` to preserve listeners after reconnect.

Check out typescript types, [tests](./e2e/ws-service.spec.ts) and examples below for more details.

## Examples

### Send and receive messages

Imagine there is a server that provides the information about weather on a websocket.

- When a client connects to it the server sends a message with a list of available channels.
- A client then selects a channel. After that a server sends updates to the client.
- After some time a client is not interested in getting 'temperature' updates anymore so he unselects the channel.

So the communication between them may look like this:

```
1. [client connects]
2. server: { type: 'listChannels', channels: ['temperature', 'pressure'] }
3. client: { type: 'selectChannel', channel: 'temperature' }
4. server: { type: 'update', channel: 'temperature', value: 21.8' }
   server: { type: 'update', channel: 'temperature', value: 22.2' }
   ...
5. client: { type: 'unselectChannel', channel: 'temperature' }
```

This would look like this in the code:

```
const { WsService } = require('clear-ws')
// 1. Open connection to the server
const config = { url: 'ws://weather-server.com' }
const ws = new WsService(config)
await ws.open()

// 2. Wait for the list of channels from server
const responseTemplate = { type: 'listChannels' }
const response = await ws.once(responseTemplate)
if (!response.channels.includes('temperature')) {
  throw Error('temperature channel not available')
}

// 3. Select temperature channel
const request = { type: 'selectChannel', channel: 'temperature' }
await ws.send(request)

// 4. Listen for updates on the channel
const template = { type: 'update', channel: 'temperature' }
const listener = (event) => {
  const message = `Current temperature is ${event.value} degrees`
  console.log(message)
}
ws.on(template, listener)
...

// 5. Stop listening for updates on the channel
ws.off(template, listener)
await ws.send({ type: 'unselectChannel', channel: 'temperature' })
```

### Reconnect

```
// 1. Configure and open connection
const config = {
  url: 'ws://host.com',
  ping: {
    request: { type: 'ping' },
    response: { type: 'pong' },
    checkAliveMs: 20 * 1000,
    heartbeatMs: 60 * 1000,
  },
  reconnect: {
    delayMs: 10 * 1000,
  }
}
const ws = new WsReconnectService(config)
await ws.open()

// 2. Subscribe
const template = { type: 'subscriptionData', channelId: 18 }
const listener = (msg) => console.log('received new message', msg)
const subscribtion = await ws.subscribe(async () => {
  await ws.send({ type: 'subscribe', channelId: 18 })
  await ws.once({ type: 'subscribtionStatus', channelId: 18, status: 'subscribed' })
  ws.on(template, listener)
})
...

// 3. Unsubscribe
ws.off(template, listener)
ws.unsubscribe(subscribtion)
await ws.send({ type: 'unsubscribe', channelId: 18 })
```
