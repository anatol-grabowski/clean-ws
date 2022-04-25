import { singleRunning } from '.'
import sleep from 'sleep-promise'

describe('singleRunning', () => {
  class Cla {
    @singleRunning()
    async met(fn) {
      await sleep(0)
      fn()
    }
  }

  let inst: Cla

  beforeEach(() => {
    inst = new Cla()
  })

  it('runs once', async () => {
    const fn = jest.fn()
    await Promise.all([inst.met(fn), inst.met(fn), inst.met(fn)])
    expect(fn.mock.calls.length).toEqual(1)
  })

  it('runs multiple times if waited enough', async () => {
    const fn = jest.fn()
    await inst.met(fn)
    await inst.met(fn)
    expect(fn.mock.calls.length).toEqual(2)
  })

  it('has no interference between instances', async () => {
    const fn = jest.fn()
    const fn2 = jest.fn()
    const inst2 = new Cla()
    await Promise.all([inst.met(fn), inst2.met(fn2), inst.met(fn)])
    expect(fn.mock.calls.length).toEqual(1)
    expect(fn2.mock.calls.length).toEqual(1)
  })
})
