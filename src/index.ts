export type SerializeOptions = {
  arrayIndexes?: boolean
  maxDepth?: number
}

export type DeserializeOptions = {
  maxDepth?: number
}

export type StringifyOptions = {
  arrayIndexes?: boolean
  maxDepth?: number
  toPrimitiveString?: (value: unknown) => string | undefined
  /**
   * Percent-encodes keys and values (`true`, default). Set to `false` to emit a human-readable, unencoded query string
   * (e.g. for prettier URLs). Note: unencoded output may be ambiguous when keys/values contain `&`, `=` or `?`.
   */
  encode?: boolean
}

export type ParseOptions = {
  maxDepth?: number
  fromPrimitiveString?: (value: unknown) => string | undefined
}

export type ParsedValue = string | ParsedObject | ParsedValue[]
export interface ParsedObject {
  [key: string]: ParsedValue
}

type FlatInput = Record<string, unknown>
type PathToken = string | number | typeof PUSH_TOKEN

const PUSH_TOKEN = Symbol('flat-push')
const DEFAULT_ARRAY_INDEXES = true
const DEFAULT_MAX_DEPTH = 64
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Returns true when value is a plain key/value object (not an array).
 *
 * @example
 *   isRecord({ a: 1 }) // true
 *   isRecord(['a']) // false
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Returns true for objects and arrays, false for primitives/null.
 *
 * @example
 *   isObjectLike({}) // true
 *   isObjectLike([]) // true
 *   isObjectLike(1) // false
 */
const isObjectLike = (value: unknown): value is Record<string, unknown> | unknown[] =>
  value !== null && typeof value === 'object'

/**
 * Returns true only for plain objects (Object prototype or null prototype).
 *
 * @example
 *   isPlainObject({ a: 1 }) // true
 *   isPlainObject(new Date()) // false
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Resolves array serialization mode.
 *
 * @example
 *   toArrayIndexes() // true
 *   toArrayIndexes({ arrayIndexes: false }) // false
 */
const toArrayIndexes = (options?: SerializeOptions): boolean => options?.arrayIndexes ?? DEFAULT_ARRAY_INDEXES

/**
 * Normalizes and clamps maxDepth to an integer >= 1.
 *
 * @example
 *   toMaxDepth({ maxDepth: 3 }) // 3
 *   toMaxDepth({ maxDepth: 0 }) // 1
 */
const toMaxDepth = (options?: SerializeOptions | DeserializeOptions): number => {
  const value = options?.maxDepth
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_DEPTH
  const normalized = Math.floor(value)
  if (normalized < 1) return 1
  return normalized
}

/**
 * Encodes a query string part.
 *
 * @example
 *   encode('a b') // 'a%20b'
 */
const encode = (value: string): string => encodeURIComponent(value)

/**
 * Decodes a query string part and treats '+' as space. Falls back to raw input if decode fails.
 *
 * @example
 *   decode('a+b') // 'a b'
 *   decode('%E0%A4%A') // '%E0%A4%A'
 */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * Converts arbitrary values to transport-safe strings.
 *
 * @example
 *   toPrimitiveString(10) // '10'
 *   toPrimitiveString({ a: 1 }) // '{"a":1}'
 */
export const toPrimitiveString = (value: unknown): string | undefined => {
  const trimedOrUndefined = (value: string) => value.trim() || undefined
  if (typeof value === 'undefined') return undefined
  if (value === null) return undefined
  if (typeof value === 'string') return trimedOrUndefined(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return trimedOrUndefined(String(value))
  }
  try {
    return trimedOrUndefined(JSON.stringify(value))
  } catch {
    return trimedOrUndefined(String(value))
  }
}

/**
 * Parses bracket-style path into tokens used by `assignPathValue`.
 *
 * @example
 *   parseKey('user[name]') // ['user', 'name']
 *   parseKey('items[]') // ['items', PUSH_TOKEN]
 *   parseKey('arr[0]') // ['arr', 0]
 */
const parseKey = (input: string): PathToken[] => {
  if (!input) return []
  const tokens: PathToken[] = []
  let current = ''
  let i = 0
  while (i < input.length) {
    const char = input[i]
    if (char !== '[') {
      current += char
      i += 1
      continue
    }

    if (current) {
      tokens.push(current)
      current = ''
    }

    const close = input.indexOf(']', i + 1)
    if (close === -1) {
      return [input]
    }
    const segment = input.slice(i + 1, close)
    if (segment === '') {
      tokens.push(PUSH_TOKEN)
    } else if (/^\d+$/.test(segment)) {
      tokens.push(Number(segment))
    } else {
      tokens.push(segment)
    }
    i = close + 1
  }

  if (current) tokens.push(current)
  return tokens.length ? tokens : [input]
}

/**
 * Appends a key/value into flat map. Repeated keys are merged into arrays.
 *
 * @example
 *   const out = { a: '1' }
 *   appendFlatEntry(out, 'a', '2')
 *   // out.a === ['1', '2']
 */
const appendFlatEntry = (target: FlatInput, key: string, value: unknown): void => {
  if (!(key in target)) {
    target[key] = value
    return
  }
  const existing = target[key]
  if (Array.isArray(existing)) {
    existing.push(value)
    target[key] = existing
    return
  }
  target[key] = [existing, value]
}

/**
 * Recursively flattens nested data into bracket-notation entries.
 *
 * @example
 *   const out: Record<string, unknown> = {}
 *   serializeNode({ user: { name: 'Ada' } }, undefined, out)
 *   // out.user[name] === 'Ada'
 */
const serializeNode = (
  value: unknown,
  path: string | undefined,
  out: FlatInput,
  options?: SerializeOptions,
  visited?: WeakSet<object>,
  currentDepth?: number,
): void => {
  const arrayIndexes = toArrayIndexes(options)
  const maxDepth = toMaxDepth(options)
  const seen = visited ?? new WeakSet<object>()
  const depth = currentDepth ?? 0

  if (!isObjectLike(value)) {
    if (path) appendFlatEntry(out, path, value)
    return
  }

  if (path && depth >= maxDepth) {
    appendFlatEntry(out, path, value)
    return
  }

  if (seen.has(value)) {
    if (path) appendFlatEntry(out, path, value)
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    if (!path) return
    if (value.length === 0) {
      // Omit empty arrays from serialized output.
      return
    }
    for (let index = 0; index < value.length; index += 1) {
      const next = value[index]
      const key = arrayIndexes ? `${path}[${index}]` : `${path}[]`
      serializeNode(next, key, out, options, seen, depth + 1)
    }
    return
  }

  if (!isPlainObject(value)) {
    if (path) appendFlatEntry(out, path, value)
    return
  }

  const keys = Object.keys(value)
  if (!path && keys.length === 0) return
  if (path && keys.length === 0) {
    // Omit empty plain objects from serialized output.
    return
  }

  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) continue
    const nextPath = path ? `${path}[${key}]` : key
    serializeNode(value[key], nextPath, out, options, seen, depth + 1)
  }
}

/**
 * Chooses next container type while building nested output.
 *
 * @example
 *   createContainerForNext(0) // []
 *   createContainerForNext('name') // {}
 */
const createContainerForNext = (next: PathToken | undefined): Record<string, unknown> | unknown[] =>
  typeof next === 'number' || next === PUSH_TOKEN ? [] : {}

/**
 * Assigns a value into nested object/array using parsed path tokens. It ignores dangerous prototype-related keys.
 *
 * @example
 *   const out: Record<string, unknown> = {}
 *   assignPathValue(out, ['user', 'name'], 'Ada')
 *   // out => { user: { name: 'Ada' } }
 */
const assignPathValue = (root: Record<string, unknown>, tokens: PathToken[], value: unknown): void => {
  if (!tokens.length) return
  const first = tokens[0]
  if (typeof first !== 'string' || DANGEROUS_KEYS.has(first)) return

  let current: Record<string, unknown> | unknown[] = root

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const isLast = i === tokens.length - 1
    const next = tokens[i + 1]

    if (typeof token === 'string' && DANGEROUS_KEYS.has(token)) return

    if (isLast) {
      if (token === PUSH_TOKEN) {
        if (!Array.isArray(current)) return
        current.push(value)
        return
      }

      if (typeof token === 'number') {
        if (!Array.isArray(current)) return
        current[token] = value
        return
      }

      if (Array.isArray(current)) return
      const existing = current[token]
      if (typeof existing === 'undefined') {
        current[token] = value
      } else if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        current[token] = [existing, value]
      }
      return
    }

    const expectedContainer = createContainerForNext(next)

    if (token === PUSH_TOKEN) {
      if (!Array.isArray(current)) return
      const child = expectedContainer
      current.push(child)
      current = child
      continue
    }

    if (typeof token === 'number') {
      if (!Array.isArray(current)) return
      const existing = current[token]
      if (isObjectLike(existing)) {
        current = existing as Record<string, unknown> | unknown[]
      } else {
        current[token] = expectedContainer
        current = current[token] as Record<string, unknown> | unknown[]
      }
      continue
    }

    if (Array.isArray(current)) return

    const existing = current[token]
    if (isObjectLike(existing)) {
      current = existing as Record<string, unknown> | unknown[]
    } else {
      current[token] = expectedContainer
      current = expectedContainer
    }
  }
}

/**
 * Converts nested plain object input into a flat bracket-notation map.
 *
 * `options.arrayIndexes` controls how arrays are encoded:
 *
 * - `true` (default): { 'tags[0]': 'a', 'tags[1]': 'b' }
 * - `false`: `{ 'tags[]': ['a', 'b'] }`
 *
 * `options.maxDepth` limits recursion depth when walking nested values. When the limit is reached, the current value is
 * kept at that key as-is.
 *
 * @example
 *   serialize({ user: { name: 'Ada' } })
 *   // { 'user[name]': 'Ada' }
 *
 * @example
 *   serialize({ tags: ['a', 'b'] }, { arrayIndexes: true })
 *   // { 'tags[0]': 'a', 'tags[1]': 'b' }
 *
 * @example
 *   serialize({ tags: ['a', 'b'] }, { arrayIndexes: false })
 *   // { 'tags[]': ['a', 'b'] }
 *
 * @example
 *   serialize({ a: { b: { c: 1 } } }, { maxDepth: 2 })
 *   // { 'a[b]': { c: 1 } }
 */
export const serialize = (input: unknown, options?: SerializeOptions): FlatInput => {
  try {
    if (!isRecord(input)) return {}
    const out: FlatInput = {}
    serializeNode(input, undefined, out, options, undefined, 0)
    return out
  } catch {
    return {}
  }
}

/**
 * Converts a flat bracket-notation map into nested object/array structure.
 *
 * `options.maxDepth` limits how deep parsed paths may go. If a key path exceeds the limit, that pair is preserved as a
 * flat key.
 *
 * @example
 *   deserialize({ 'user[name]': 'Ada' })
 *   // { user: { name: 'Ada' } }
 *
 * @example
 *   deserialize({ 'items[]': ['a', 'b'] })
 *   // { items: ['a', 'b'] }
 *
 * @example
 *   deserialize({ 'a[b][c]': '1' }, { maxDepth: 2 })
 *   // { 'a[b][c]': '1' }
 */
export const deserialize = (input: unknown, options?: DeserializeOptions): Record<string, unknown> => {
  try {
    if (!isRecord(input)) return {}
    const out: Record<string, unknown> = {}
    const maxDepth = toMaxDepth(options)
    for (const [rawKey, rawValue] of Object.entries(input)) {
      const tokens = parseKey(rawKey)
      if (!tokens.length) continue
      if (tokens.length > maxDepth) {
        appendFlatEntry(out, rawKey, rawValue)
        continue
      }
      if (Array.isArray(rawValue)) {
        for (const value of rawValue) {
          assignPathValue(out, tokens, value)
        }
      } else {
        assignPathValue(out, tokens, rawValue)
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Serializes input object to URL query string.
 *
 * Uses `serialize()` internally, so `arrayIndexes` and `maxDepth` have the same effect here as they do in `serialize`.
 *
 * @example
 *   stringify({ user: { name: 'Ada' } })
 *   // 'user%5Bname%5D=Ada'
 *
 * @example
 *   stringify({ tags: ['a', 'b'] }, { arrayIndexes: false })
 *   // 'tags%5B%5D=a&tags%5B%5D=b'
 *
 * @example
 *   stringify({ a: { b: { c: 1 } } }, { maxDepth: 2 })
 *   // 'a%5Bb%5D=%7B%22c%22%3A1%7D'
 *
 * @example
 *   stringify({ user: { name: 'Ada' } }, { encode: false })
 *   // 'user[name]=Ada'
 */
export const stringify = (input: unknown, options?: StringifyOptions): string => {
  const toS = options?.toPrimitiveString ?? toPrimitiveString
  const enc = options?.encode === false ? (value: string): string => value : encode
  try {
    const flat = serialize(input, options)
    const chunks: string[] = []
    for (const [key, rawValue] of Object.entries(flat)) {
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          const value = toS(item)
          if (value === undefined) continue
          chunks.push(`${enc(key)}=${enc(value)}`)
        }
        continue
      }
      const value = toS(rawValue)
      if (value === undefined) continue
      chunks.push(`${enc(key)}=${enc(value)}`)
    }
    return chunks.join('&')
  } catch {
    try {
      if (!isRecord(input)) return ''
      if (options?.encode === false) {
        const chunks: string[] = []
        for (const [key, rawValue] of Object.entries(input)) {
          const value = toS(rawValue)
          if (value === undefined) continue
          chunks.push(`${key}=${value}`)
        }
        return chunks.join('&')
      }
      const urlParams = new URLSearchParams()
      for (const [key, rawValue] of Object.entries(input)) {
        const value = toS(rawValue)
        if (value === undefined) continue
        urlParams.set(key, value)
      }
      return urlParams.toString()
    } catch {
      return ''
    }
  }
}

/**
 * Parses URL query string into nested object/array structure.
 *
 * Accepts with or without a leading `?`. Uses `deserialize()` internally, so `maxDepth` behaves the same: deeper paths
 * than the limit remain flat keys.
 *
 * @example
 *   parse('?user%5Bname%5D=Ada')
 *   // { user: { name: 'Ada' } }
 *
 * @example
 *   parse('items%5B%5D=a&items%5B%5D=b')
 *   // { items: ['a', 'b'] }
 *
 * @example
 *   parse('a%5Bb%5D%5Bc%5D=1', { maxDepth: 2 })
 *   // { 'a[b][c]': '1' }
 */
export const parse = (input: unknown, options?: ParseOptions): ParsedObject => {
  try {
    const fromS = options?.fromPrimitiveString ?? ((value: string) => value)
    if (typeof input !== 'string') return {}
    const query = input.startsWith('?') ? input.slice(1) : input
    if (!query) return {}

    const flat: Record<string, unknown> = {}
    const pairs = query.split('&')
    for (const pair of pairs) {
      if (!pair) continue
      const separatorIndex = pair.indexOf('=')
      const rawKey = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex)
      const rawValue = separatorIndex === -1 ? '' : pair.slice(separatorIndex + 1)
      const key = decode(rawKey)
      if (!key) continue
      const value = fromS(decode(rawValue))
      appendFlatEntry(flat, key, value)
    }
    return deserialize(flat, options) as ParsedObject
  } catch {
    return {}
  }
}

export const flat = {
  serialize,
  deserialize,
  stringify,
  parse,
}

export default flat
