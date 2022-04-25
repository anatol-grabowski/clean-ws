/**
 * If a method is called while the previous call is still pending
 * then return an existing promise (from the previous call).
 */
export function singleRunning() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const fn = descriptor.value
    const s = Symbol()

    descriptor.value = async function (...args) {
      if (this[s] != null) return this[s]

      this[s] = fn.apply(this, args)
      try {
        const res = await this[s]
        return res
      } finally {
        this[s] = null
      }
    }
  }
}
