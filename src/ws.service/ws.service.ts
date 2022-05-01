import sleep from 'sleep-promise'
import Debug from 'debug'
import { singleRunning } from '../single-running.decorator'

import {
  WsListenerService,
  WsListenerServiceConfig,
  Message,
  Template,
} from './ws-listener.service'

const debug = Debug('ws.service')

interface PingConfig {
  /**
   * Send ping request every `heartbeatMs` (null - disabled).
   */
  heartbeatMs?: number
  /**
   * Send ping request if there are no incoming messages for more than `checkAliveMs` (null - disabled).
   */
  checkAliveMs?: number
  /**
   * May be a string, an object or a function.
   */
  request: Message | (() => Message | Promise<Message>)
  /**
   * May be a template or a matcher function.
   */
  response: Template
  /**
   * A timeout to await for the response.
   */
  timeoutMs?: number
}

interface ReconnectConfig {
  /**
   * Delay before auto reconnect (null - disabled).
   */
  delayMs?: number
  /**
   * Resubscribe simultaneously to all subscriptions.
   */
  parallelResubscribe?: boolean
}

export type Subscribe = () => void | Promise<void>

export type WsServiceConfig = WsListenerServiceConfig & {
  ping?: PingConfig
  reconnect?: ReconnectConfig
}

export class WsService extends WsListenerService {
  protected pingConf: PingConfig
  protected reconnectConf: ReconnectConfig
  protected isReconnectConfigured = false
  protected heartbeatTimeoutId: ReturnType<typeof setTimeout>
  protected checkAliveTimeoutId: ReturnType<typeof setTimeout>
  protected subs: any[] = []

  /**
   * Set to `true` on open if reconnect is configured.
   * Set to `false` on `close`
   * Check on `close` event handler
   */
  protected shouldReconnect: boolean = false

  constructor({ ping, reconnect, ...conf }: WsServiceConfig) {
    super(conf)
    this.pingConf = {
      heartbeatMs: null,
      checkAliveMs: null,
      timeoutMs: this.timeoutMs,
      ...ping,
    }
    this.reconnectConf = {
      delayMs: null,
      parallelResubscribe: true,
      ...reconnect,
    }
    if (this.pingConf.heartbeatMs != null || this.pingConf.checkAliveMs != null) {
      const canPing = this.pingConf.request != null && this.pingConf.response != null
      if (!canPing) {
        throw Error('Ping heartbeatMs or checkAliveMs is configured but request or response is not')
      }
    }
    if (this.ws != null) {
      this._init() // in case an opened ws passed to a constructor
    }
  }

  protected _init() {
    this._heartbeatLoop()
    this._scheduleCheckAlive()
    this._configureAutoReconnect()
  }

  @singleRunning()
  override async open() {
    debug('open')
    while (true) {
      try {
        await super.open()
        break
      } catch (err: any) {
        debug('error open', err?.message)
        if (this.reconnectConf.delayMs == null) throw err
        if (!this.shouldReconnect) return
        debug(`will reopen in ${this.reconnectConf.delayMs}ms`)
        await sleep(this.reconnectConf.delayMs)
        if (!this.shouldReconnect) return
        debug('reopen')
      }
    }
    this._init()
  }

  protected override _handleMessage(event) {
    this._scheduleCheckAlive()
    return super._handleMessage(event)
  }

  protected override _reconnectableClose(
    ...args: Parameters<WsListenerService['_reconnectableClose']>
  ): ReturnType<WsListenerService['_reconnectableClose']> {
    if (this.ws != null) debug('close', args[0].code, args[0].reason)
    clearTimeout(this.heartbeatTimeoutId)
    this.heartbeatTimeoutId = null
    clearTimeout(this.checkAliveTimeoutId)
    this.checkAliveTimeoutId = null
    return super._reconnectableClose(...args)
  }

  override async close(
    ...args: Parameters<WsListenerService['close']>
  ): ReturnType<WsListenerService['close']> {
    this.shouldReconnect = false
    return super.close(...args)
  }

  /**
   * Return `true` if successfully received pong, otherwise return `false`.
   * Throw if ping request or response in not configured.
   */
  async ping(): Promise<boolean> {
    const pingConf = this.pingConf
    const canPing = pingConf.request != null && pingConf.response != null
    if (!canPing) throw Error('Ping request or response not configured')
    const req = typeof pingConf.request === 'function' ? pingConf.request() : pingConf.request
    await this.send(req)
    const t0 = Date.now()
    try {
      const res = await this.once(pingConf.response, { timeoutMs: pingConf.timeoutMs })
      debug('pong', Date.now() - t0, 'ms')
      return true
    } catch (err) {
      debug('no pong')
      return false
    }
  }

  protected _heartbeatLoop() {
    if (this.pingConf.heartbeatMs == null || !this.isOpen) return
    if (this.heartbeatTimeoutId == null) debug('init heartbeat schedule')
    this.heartbeatTimeoutId = setTimeout(async () => {
      debug('heartbeat')
      const isAlive = await this.ping()
      if (isAlive) {
        this._heartbeatLoop()
      }
    }, this.pingConf.heartbeatMs)
  }

  protected _scheduleCheckAlive() {
    if (this.pingConf.checkAliveMs == null || !this.isOpen) return
    if (this.checkAliveTimeoutId == null) debug('init check alive schedule')
    if (this.checkAliveTimeoutId != null) clearTimeout(this.checkAliveTimeoutId)
    this.checkAliveTimeoutId = setTimeout(async () => {
      debug('check alive')
      const isAlive = await this.ping()
      if (!isAlive) {
        const msg = `Pong not received from server, after ${this.pingConf.timeoutMs} ms`
        await this.reconnectableClose(3003, msg)
      }
    }, this.pingConf.checkAliveMs)
  }

  protected _configureAutoReconnect() {
    if (this.reconnectConf.delayMs == null) return
    if (this.isReconnectConfigured) return
    this.shouldReconnect = true
    if (!this.isOpen) return
    debug('init auto reconnect')

    this.ws.addEventListener('close', async () => {
      if (!this.shouldReconnect) return
      debug(`will reconnect in ${this.reconnectConf.delayMs}ms`)
      await sleep(this.reconnectConf.delayMs)
      await this.reconnect()
    })
    this.isReconnectConfigured = true
  }

  /**
   * Reopen the connection.
   * Restore all subscriptions (call functions previously passed to `subscribe` method).
   */
  async reconnect() {
    debug('reconnect')
    this.isReconnectConfigured = false
    await this.reconnectableClose(3004, 'reconnect')
    // TODO: handle timeout on open (WebSocket was closed before the connection was established)
    await this.open()
    const msg = `restore ${this.subs.length} subscriptions ${
      this.reconnectConf.parallelResubscribe ? 'in parallel' : 'one by one'
    }`
    debug(msg)
    if (this.reconnectConf.parallelResubscribe) {
      const resubscribePromises = this.subs.map((fn) => fn())
      await Promise.all(resubscribePromises)
    } else {
      for (const fn of this.subs) await fn()
    }
  }

  /**
   * Accept a function that performs a sequence of actions required to subscribe.
   * Call the accepted function once to subscribe.
   * Add the function to a list of functions to be called on `reconnect`.
   * Return subscribe function passed as an argument (can be used to `unsubscribe` later).
   */
  async subscribe(fn: Subscribe): Promise<Subscribe> {
    debug('subscribe')
    await fn()
    this.subs.push(fn)
    return fn
  }

  /**
   * Remove a function from a list of functions to be called on reconnect.
   * A sequence of actions required to unsubscribe should be performed elsewhere.
   */
  async unsubscribe(fn: Subscribe) {
    debug('unsubscribe')
    const index = this.subs.indexOf(fn)
    if (index !== -1) this.subs.splice(index, 1)
  }
}
