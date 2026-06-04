// Post-build smoke test: verifies the published artifact loads under plain Node
// and that the package "exports" map resolves. Adapt the assertion to your library.
import { serialize, parse } from '../dist/index.js'

const assert = (cond, msg) => {
  if (!cond) {
    console.error('smoke test failed:', msg)
    process.exit(1)
  }
}

const flat = serialize({ user: { name: 'Ada' } })
assert(flat['user[name]'] === 'Ada', 'serialize() should flatten nested keys')

const obj = parse('a=1&b=2')
assert(obj.a === '1' && obj.b === '2', 'parse() should rebuild the object')

console.log('smoke ok')
