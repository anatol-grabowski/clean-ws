import expect from 'expect'

export function matchObjects(a, b): boolean {
  try {
    expect(b).toMatchObject(a)
    return true
  } catch (err) {
    return false
  }
}
