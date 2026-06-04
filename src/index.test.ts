import { describe, expect, it } from 'bun:test'
import { deserialize, parse, serialize, stringify } from './index.js'

const buildNPath = (segments: number): string => {
  if (segments <= 0) return ''
  return `n${'[n]'.repeat(segments - 1)}`
}

describe('flat', () => {
  it('serializes nested objects and arrays with indexes', () => {
    const input = {
      x: 1,
      user: { profile: { name: 'john' } },
      z: ['a', 'b'],
    }

    expect(serialize(input)).toEqual({
      x: 1,
      'user[profile][name]': 'john',
      'z[0]': 'a',
      'z[1]': 'b',
    })
  })

  it('serializes arrays without indexes when configured', () => {
    const input = {
      a: ['1', '2'],
      nested: { tags: ['x', 'y'] },
    }

    expect(serialize(input, { arrayIndexes: false })).toEqual({
      'a[]': ['1', '2'],
      'nested[tags][]': ['x', 'y'],
    })
  })

  it('deserializes indexed and push arrays', () => {
    const input = {
      'user[name]': 'john',
      'z[0]': 'a',
      'z[1]': 'b',
      'tags[]': ['x', 'y'],
    }

    expect(deserialize(input)).toEqual({
      user: { name: 'john' },
      z: ['a', 'b'],
      tags: ['x', 'y'],
    })
  })

  it('stringify + parse roundtrip with indexes', () => {
    const input = {
      x: '1',
      deep: { y: 2 },
      list: ['a', 'b'],
    }

    const query = stringify(input)
    expect(decodeURIComponent(query)).toBe('x=1&deep[y]=2&list[0]=a&list[1]=b')
    expect(decodeURIComponent(query)).not.toBe(query)
    expect(parse(query)).toEqual({
      x: '1',
      deep: { y: '2' },
      list: ['a', 'b'],
    })
  })

  it('stringify + parse roundtrip without array indexes', () => {
    const input = {
      list: ['a', 'b'],
      nested: { tags: ['x', 'y'] },
    }

    const query = stringify(input, { arrayIndexes: false })
    expect(decodeURIComponent(query)).toBe('list[]=a&list[]=b&nested[tags][]=x&nested[tags][]=y')
    expect(decodeURIComponent(query)).not.toBe(query)
    expect(parse(query)).toEqual({
      list: ['a', 'b'],
      nested: { tags: ['x', 'y'] },
    })
  })

  it('stringify emits an unencoded query with encode: false', () => {
    const input = {
      q: 'a b',
      deep: { y: 2 },
      list: ['a', 'b'],
    }

    const query = stringify(input, { encode: false })
    expect(query).toBe('q=a b&deep[y]=2&list[0]=a&list[1]=b')

    const queryNoIndexes = stringify({ list: ['a', 'b'] }, { encode: false, arrayIndexes: false })
    expect(queryNoIndexes).toBe('list[]=a&list[]=b')
  })

  it('stringify supports custom toPrimitiveString', () => {
    const input = {
      id: 7,
      enabled: true,
      secret: 'skip-me',
    }

    const query = stringify(input, {
      toPrimitiveString: (value) => {
        if (value === 'skip-me') return undefined
        return `v:${String(value)}`
      },
    })

    expect(decodeURIComponent(query)).toBe('id=v:7&enabled=v:true')
    expect(decodeURIComponent(query)).not.toBe(query)
    expect(query).not.toContain('secret')
  })

  it('parses query starting with question mark and repeated key', () => {
    expect(parse('?a=1&a=2')).toEqual({ a: ['1', '2'] })
  })

  it('parse supports custom fromPrimitiveString', () => {
    const parsed = parse('a=1&b=keep&drop=remove', {
      fromPrimitiveString: (value) => {
        if (value === 'remove') return undefined
        return `x:${String(value)}`
      },
    })

    expect(parsed).toEqual({
      a: 'x:1',
      b: 'x:keep',
    })
    expect(parsed.drop).toBeUndefined()
  })

  it('never throws and falls back to simple output', () => {
    expect(serialize(null)).toEqual({})
    expect(deserialize(null)).toEqual({})
    expect(parse(null)).toEqual({})
    expect(stringify(null)).toBe('')
  })

  it('keeps File and Blob instances as values', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const blob = new Blob(['world'], { type: 'text/plain' })
    const input = {
      file,
      nested: {
        blob,
      },
    }

    const flat = serialize(input)
    expect(flat.file).toBe(file)
    expect(flat['nested[blob]']).toBe(blob)

    const restored = deserialize(flat)
    expect(restored.file).toBe(file)
    expect((restored.nested as { blob: Blob }).blob).toBe(blob)
  })

  it('keeps class instances as-is instead of flattening internals', () => {
    class UserModel {
      constructor(
        public id: number,
        public role: string,
      ) {}
      isAdmin() {
        return this.role === 'admin'
      }
    }

    const owner = new UserModel(7, 'admin')
    const nestedOwner = new UserModel(11, 'user')
    const input = {
      owner,
      nested: { owner: nestedOwner },
    }

    const flat = serialize(input)
    expect(flat.owner).toBe(owner)
    expect(flat['nested[owner]']).toBe(nestedOwner)
    expect(flat['owner[id]']).toBeUndefined()
    expect(flat['nested[owner][id]']).toBeUndefined()
  })

  it('handles very deep plain objects correctly', () => {
    const depth = 250
    const input: Record<string, unknown> = {}
    let current: Record<string, unknown> = input
    for (let i = 0; i < depth; i += 1) {
      current.n = {}
      current = current.n as Record<string, unknown>
    }
    current.value = 'end'

    const flat = serialize(input, { maxDepth: depth + 10 })
    let key = 'n'
    for (let i = 1; i < depth; i += 1) {
      key += '[n]'
    }
    key += '[value]'
    expect(flat[key]).toBe('end')

    const restored = deserialize(flat, { maxDepth: depth + 10 })
    expect(restored).toEqual(input)
  })

  it('uses safe default max depth and can be configured', () => {
    const deepInput: Record<string, unknown> = {}
    let current: Record<string, unknown> = deepInput
    for (let i = 0; i < 80; i += 1) {
      current.n = {}
      current = current.n as Record<string, unknown>
    }
    current.value = 'end'

    const flatDefault = serialize(deepInput)
    expect(flatDefault[buildNPath(80) + '[value]']).toBeUndefined()
    expect(flatDefault[buildNPath(64)]).toBeDefined()

    const flatConfigured = serialize(deepInput, { maxDepth: 120 })
    expect(flatConfigured[buildNPath(80) + '[value]']).toBe('end')
  })

  it('limits deserialize depth with fallback to flat key', () => {
    const deepKey = `${buildNPath(10)}[value]`
    const restored = deserialize({ [deepKey]: 'end' }, { maxDepth: 5 })
    expect(restored).toEqual({ [deepKey]: 'end' })

    const parsed = parse(`${encodeURIComponent(deepKey)}=end`, { maxDepth: 5 })
    expect(parsed).toEqual({ [deepKey]: 'end' })
  })

  it('handles circular references without breaking', () => {
    const node: { id: number; self?: unknown } = { id: 1 }
    node.self = node
    const input = { node }

    const flat = serialize(input)
    expect(flat['node[id]']).toBe(1)
    expect(flat['node[self]']).toBe(node)

    const query = stringify(input)
    const decodedQuery = decodeURIComponent(query)
    expect(decodedQuery).toContain('node[id]=1')
    expect(decodedQuery).toContain('node[self]=[object Object]')
    expect(decodedQuery).not.toBe(query)
  })

  it('skips prototype pollution keys', () => {
    const parsed = parse('__proto__%5Bpolluted%5D=yes&safe=1')
    expect(parsed).toEqual({ safe: '1' })
    expect(({} as { polluted?: string }).polluted).toBeUndefined()
  })

  it('it omits undefined when stringifying', () => {
    const input = {
      a: undefined,
      b: 'b',
      c: '',
      d: [{ x: undefined }],
    }
    const query = stringify(input)
    console.log(query)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  it('it omits null when stringifying', () => {
    const input = {
      a: null,
      b: 'b',
      c: '',
      d: [{ x: null }],
    }
    const query = stringify(input)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  it('it removes empty string on stringify', () => {
    const input = {
      a: null,
      b: 'b',
      c: '',
      d: {},
    }
    const query = stringify(input)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  it('it removes empty object on stringify', () => {
    const input = {
      a: null,
      b: 'b',
      c: '',
      d: {},
    }
    const query = stringify(input)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  it('it removes empty array on stringify', () => {
    const input = {
      a: null,
      b: 'b',
      c: '',
      d: [],
    }
    const query = stringify(input)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  it('it removes nested empty object on stringify', () => {
    const input = {
      a: null,
      b: 'b',
      c: '',
      d: { e: {} },
    }
    const query = stringify(input)
    const round = parse(query)
    expect(round).toEqual({ b: 'b' })
  })

  describe('edge cases & defensive paths', () => {
    it('decode falls back to raw input on malformed percent-encoding', () => {
      expect(parse('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' })
    })

    it('parseKey keeps an unclosed-bracket key flat', () => {
      expect(deserialize({ 'a[b': 'x' })).toEqual({ 'a[b': 'x' })
    })

    it('merges three or more repeated query keys into one array', () => {
      expect(parse('a=1&a=2&a=3')).toEqual({ a: ['1', '2', '3'] })
    })

    it('deserializes a push token followed by a key: a[][b]', () => {
      expect(deserialize({ 'a[][b]': 'x' })).toEqual({ a: [{ b: 'x' }] })
    })

    it('deserializes a numeric index then key, reusing the container', () => {
      expect(deserialize({ 'a[0][b]': 'x', 'a[0][c]': 'y' })).toEqual({ a: [{ b: 'x', c: 'y' }] })
    })

    it('serialize returns {} when a property getter throws', () => {
      const evil = {
        get boom(): string {
          throw new Error('boom')
        },
      }
      expect(serialize(evil)).toEqual({})
    })

    it('deserialize returns {} when reading the keys throws', () => {
      const evil = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('boom')
          },
        },
      )
      expect(deserialize(evil)).toEqual({})
    })

    it('stringify falls back to URLSearchParams when a key cannot be percent-encoded', () => {
      const result = stringify({ '\uD800': 'v' })
      expect(typeof result).toBe('string')
      expect(result).toContain('v')
    })

    it('stringify (encode:false) returns "" when toPrimitiveString throws mid-way', () => {
      const result = stringify(
        { a: 2, b: 1 },
        {
          encode: false,
          toPrimitiveString: (value) => {
            if (value === 1) {
              throw new Error('boom')
            }
            return String(value)
          },
        },
      )
      expect(result).toBe('')
    })
  })
})
