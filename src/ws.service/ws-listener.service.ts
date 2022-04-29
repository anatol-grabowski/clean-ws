import WebSocket from 'isomorphic-ws'
import Debug from 'debug'
import sleep from 'sleep-promise'
import { singleRunning } from '../single-running.decorator'
import { throttle } from '../throttle.decorator'

import { matchObjects } from './match-objects'

const debug = Debug('ws-listener.service')
const debugUnhandled = Debug('ws-listener.service:unhandled')

/**
 * 'isomorphic-ws' uses 'ws' package for node and browser 'WebSocket' for browsers.
 * There are some differences between the APIs of 'ws' and browser 'WebSocket' that should be taken into account.
 * Browser 'WebSocket' doesn't have a 'terminate' method and doesn't accept a callback in a 'send' method.
 */
const isUsingBrowserWs = WebSocket.prototype.terminate == null

export type Message = string | object

/**
 * A template object or a matcher function.
 */
export type Template = any | ((msg: any) => boolean)

export type Listener<T = any> = (msg: T) => void

interface TemplateListener {
  template: Template
  listener: Listener
}

export type WsListenerServiceConfig = {
  /**
   * Timeout for `open` and for `once`.
   */
  timeoutMs?: number
  /**
   * Force delay between `send`s.
   */
  throttleMs?: number
} & ({ url: string } | { ws: WebSocket })

export class WsListenerService {
  protected ws: WebSocket
  protected url: string
  protected timeoutMs: number
  protected throttleMs: number

  protected liteners: TemplateListener[] = []
  protected openPromise: any

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  constructor({ ...conf }: WsListenerServiceConfig) {
    this.timeoutMs = conf.timeoutMs || 5000
    this.throttleMs = conf.throttleMs || 0
    if ('ws' in conf) {
      this.ws = conf.ws
      this.url = conf.ws.url
    }
    if ('url' in conf) {
      this.url = conf.url
    }
    this.send = throttle(this.send, this.throttleMs) as WsListenerService['send']
  }

  @singleRunning()
  async open() {
    debug('open')
    await this.reconnectableClose(3002, 'open')
    await new Promise<void>((res, rej) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      const timeoutCb = () => {
        ws.close()
        rej()
      }
      const openCb = (event) => {
        clearTimeout(timeoutId)
        res(event)
      }
      const timeoutId = setTimeout(timeoutCb, this.timeoutMs)
      ws.addEventListener('open', openCb, { once: true })
      ws.addEventListener('message', (event) => this._handleMessage(event))
      ws.addEventListener('error', (event) => {
        console.error('ws error', event)
        this.reconnectableClose(3001, 'ws error')
      })
      ws.addEventListener('close', async (event) => {
        await sleep(0) // let all 'close' handlers to be triggered, TODO: think if there may be a problem with it
        this._reconnectableClose(event)
      })
    })
  }

  /**
   * Close connection, cleanup.
   */
  async close(code?: number, reason?: string): Promise<void> {
    return this.reconnectableClose(code, reason)
  }

  // TODO: think if `listeners` should be cleared right after a `close` call.
  // Browser implementation of ws doesn't have `removeAllListeners`.
  // Don't clear any listeners for now hoping that `close` is enough.
  protected _reconnectableClose(event) {
    debug('_close', event.code, event.reason)
    this.liteners = []
    this.ws = null
  }

  /**
   * This method exists so that reconnect implementation can use it where reconnectableClose is needed.
   */
  protected async reconnectableClose(code?: number, reason?: string): Promise<void> {
    if (this.ws != null) {
      debug('close', code, reason)
      if (this.ws.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((res) => {
          this.ws.close(code, reason) // will trigger `_close`
          this.ws.addEventListener('close', res, { once: true })
        })
      } else {
        this._reconnectableClose({})
      }
    }
  }

  protected _handleMessage(event) {
    debug('recv', event.data)
    const msg = JSON.parse(event.data)
    let isMsgHandled = false
    for (const sub of this.liteners) {
      const doesMatch =
        typeof sub.template === 'function' ? sub.template(msg) : matchObjects(sub.template, msg)
      if (doesMatch) {
        void sub.listener(msg)
        isMsgHandled = true
      }
    }
    if (!isMsgHandled) {
      debugUnhandled(event.data) // is expected after `once` times out
    }
  }

  async send(msg: Message): Promise<void> {
    const msgStr = typeof msg === 'object' ? JSON.stringify(msg) : msg
    debug('send', msgStr)
    if (isUsingBrowserWs) return this.ws.send(msgStr)
    return new Promise((res, rej) => {
      this.ws.send(msgStr, (err) => (err == null ? res() : rej(err)))
    })
  }

  /**
   * Listen for messages that match a template.
   * Return template and listener function passed as arguments (can be used in `off` later).
   */
  on<T = any>(
    template: Template,
    listener: Listener<T>,
  ): { template: Template; listener: Listener } {
    const sub = { template, listener }
    this.liteners.push(sub)
    return { template, listener }
  }

  /**
   * Remove listener.
   */
  off<T = any>(template: Template, listener: Listener<T>): void {
    const index = this.liteners.findIndex((sub) => {
      return sub.listener === listener && sub.template === template
    })
    if (index !== -1) {
      this.liteners.splice(index, 1)
    }
  }

  /**
   * Get a promise for one message matching a template.
   * @throws Error on timeout.
   */
  async once<T = any>(template: Template, timeoutMs = this.timeoutMs): Promise<T> {
    const promise = new Promise((res, rej) => {
      const cb = (msg) => {
        clearTimeout(timeoutId)
        this.off(template, cb)
        res(msg)
      }
      const timeoutId = setTimeout(() => {
        this.off(template, cb)
        rej(Error(`Timeout ${timeoutMs}ms`))
      }, timeoutMs)
      this.on(template, cb)
    })
    const message = await promise
    return message as T
  }
}
