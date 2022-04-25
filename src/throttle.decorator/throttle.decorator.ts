import sleep from 'sleep-promise'

/**
 * @param timeMs - delay after previous call resolution/rejection. Pass 0 to queue calls with no delay.
 */
export function throttleDecorator(timeMs: number) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    descriptor.value = throttle(descriptor.value, timeMs)
  }
}

export function throttle(fn, timeMs: number) {
  let t = null
  const q = []

  return function (this: any, ...args) {
    return new Promise(async (resolve, reject) => {
      const f = async () => {
        const sleepMs = t == null ? 0 : t + timeMs - Date.now()
        if (sleepMs > 0) await sleep(sleepMs)

        try {
          t = Date.now()
          const res = await fn.apply(this, args)
          resolve(res)
        } catch (err) {
          reject(err)
        }

        q.shift()
        if (q.length !== 0) void q[0]()
      }
      q.push(f)
      if (q.length === 1) void q[0]()
    })
  }
}
