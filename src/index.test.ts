import { describe, expect, expectTypeOf, it } from 'bun:test'
import { greet } from './index.js'

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('world')).toBe('Hello, world!')
  })
})

// Type-level tests. We test public types too, not just runtime behavior.
// This function is never called — `tsc` (and `tsgo`) check its body, nothing runs.
function assertTypes() {
  expectTypeOf(greet).toEqualTypeOf<(name: string) => string>()
  expectTypeOf(greet('world')).toBeString()
}

describe('types', () => {
  it('compile-time type assertions hold', () => {
    expect(typeof assertTypes).toBe('function') // referenced so tsc checks it; never invoked
  })
})
