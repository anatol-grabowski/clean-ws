import { throttleDecorator, throttle } from '.'
import sleep from 'sleep-promise'

describe('throttle', () => {
  it('throttles', async () => {
    const ms = 100
    const fn = jest.fn(async () => {
      await sleep(0)
      return Date.now()
    })
    const th = throttle(fn, ms)

    const promises = [th(1), th(2), th(3)]

    await promises[0]
    expect(fn).toBeCalledTimes(1)
    await promises[1]
    expect(fn).toBeCalledTimes(2)
    await promises[2]
    expect(fn).toBeCalledTimes(3)
    const dt1 = (await fn.mock.results[1].value) - (await fn.mock.results[0].value)
    const dt2 = (await fn.mock.results[2].value) - (await fn.mock.results[1].value)
    expect(dt1).toBeGreaterThanOrEqual(ms - 10)
    expect(dt2).toBeGreaterThanOrEqual(ms - 10)
    expect(fn.mock.calls).toEqual([[1], [2], [3]])
  })
})

describe('throttleDecorator', () => {
  class Cla {
    called = []

    @throttleDecorator(0)
    async met(fn) {
      await sleep(0)
      fn()
      this.called.push(fn)
    }
  }

  let inst: Cla

  beforeEach(() => {
    inst = new Cla()
  })

  it('just queues calls if time is 0', async () => {
    const fn1 = jest.fn()
    const fn2 = jest.fn()
    const fn3 = jest.fn()

    const promises = [inst.met(fn1), inst.met(fn2), inst.met(fn3)]

    await promises[0]
    expect(fn1).toBeCalled()
    expect(fn2).not.toBeCalled()
    expect(fn3).not.toBeCalled()
    await promises[1]
    expect(fn1).toBeCalled()
    expect(fn2).toBeCalled()
    expect(fn3).not.toBeCalled()
    await promises[2]
    expect(fn1).toBeCalled()
    expect(fn2).toBeCalled()
    expect(fn3).toBeCalled()
  })
})
