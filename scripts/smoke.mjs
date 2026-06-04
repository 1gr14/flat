// Post-build smoke test: verifies the published artifact loads under plain Node
// and that the package "exports" map resolves. Adapt the assertion to your library.
import { greet } from '../dist/index.js'

const assert = (cond, msg) => {
  if (!cond) {
    console.error('smoke test failed:', msg)
    process.exit(1)
  }
}

assert(greet('world') === 'Hello, world!', 'greet() should work from the built package')

console.log('smoke ok')
