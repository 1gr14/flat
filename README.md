# @1gr14/flat

> Flatten a nested object into flat `key → value` pairs and back — the one piece
> of code behind both URL query strings and multipart `FormData`. Arrays, deep
> nesting, files, and custom encoding included.

[![CI](https://github.com/1gr14/flat/actions/workflows/ci.yml/badge.svg)](https://github.com/1gr14/flat/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@1gr14/flat.svg)](https://www.npmjs.com/package/@1gr14/flat)
[![coverage](https://codecov.io/gh/1gr14/flat/branch/main/graph/badge.svg)](https://codecov.io/gh/1gr14/flat)
[![gzip](https://deno.bundlejs.com/badge?q=@1gr14/flat)](https://bundlejs.com/?q=@1gr14/flat)
[![license](https://img.shields.io/npm/l/@1gr14/flat.svg)](./LICENSE)

<!-- docs:start -->

URL query strings and multipart `FormData` look like two different problems, but
underneath they're the same one: each can only carry a **flat** list of
`key → value` pairs. To push a **nested** object through either, you flatten it
to bracket-notation keys on one side and rebuild it on the other — and that work
is byte-for-byte identical whether the destination is a URL or a `FormData`.

`qs` does the query-string half well, but it's heavier and aimed only at search
params. Building the [Point0](https://1gr14.dev/point0) framework, I needed to
flatten _any_ object for both a search string and a `FormData` body — the same
code, two transports — so it belongs in one small package. That's `flat`.

Two pairs of functions, one for each transport. `serialize` / `deserialize` give
you the flat bracket-notation map (what you feed to `FormData`); `stringify` /
`parse` add URL encoding on top and hand you a query string. Arrays, deep
nesting, and repeated keys just work; `File` / `Blob` values ride along inside
`FormData` untouched; and prototype-polluting keys are dropped.

```ts
import { serialize, deserialize, stringify, parse } from '@1gr14/flat'

const obj = { q: 'shoes', filters: { price: { min: 10 } }, tags: ['a', 'b'] }

// nested object ⇄ flat bracket-notation map (what you append to FormData)
const serialized = serialize(obj)
// { q: 'shoes', 'filters[price][min]': 10, 'tags[0]': 'a', 'tags[1]': 'b' }  — types kept
const deserialized = deserialize(serialized)
// { q: 'shoes', filters: { price: { min: 10 } }, tags: ['a', 'b'] }

// nested object ⇄ URL query string
const stringified = stringify(obj)
// 'q=shoes&filters[price][min]=10&tags[0]=a&tags[1]=b'  (brackets URL-encoded)
const parsed = parse(stringified)
// { q: 'shoes', filters: { price: { min: '10' } }, tags: ['a', 'b'] }  — all strings
```

All four are also bundled on a `flat` namespace (`flat.serialize`, …), which is
the package's default export — handy if you'd rather not name every import.

## Install

```sh
bun add @1gr14/flat
# or: npm install / pnpm add / yarn add
```

Bun 1+ or Node.js 20+. ESM only.

## Query strings: `stringify` and `parse`

`stringify` turns a nested object into a query string; `parse` turns it back.
Arrays and nested objects round-trip, and repeated keys collapse into an array:

```ts
stringify({ x: '1', deep: { y: 2 }, list: ['a', 'b'] })
// 'x=1&deep[y]=2&list[0]=a&list[1]=b'  (brackets URL-encoded)

parse('x=1&deep[y]=2&list[0]=a&list[1]=b')
// { x: '1', deep: { y: '2' }, list: ['a', 'b'] }

parse('a=1&a=2') // { a: ['1', '2'] }  — repeated keys → array
```

`parse` accepts a string with or without a leading `?`, decodes percent-escapes,
and reads `+` as a space. Every parsed value is a **string** — query strings
carry no types — so coerce on your side, or use `fromPrimitiveString` (below).

## Flatten: `serialize` and `deserialize`

Need the flat key/value map instead of a string? `serialize` flattens a nested
object to bracket-notation keys; `deserialize` rebuilds it. Unlike a query
string, this keeps the original leaf **values** as-is — numbers stay numbers,
and a `File` stays a `File`:

```ts
serialize({ x: 1, user: { profile: { name: 'john' } }, z: ['a', 'b'] })
// { x: 1, 'user[profile][name]': 'john', 'z[0]': 'a', 'z[1]': 'b' }

deserialize({ 'user[profile][name]': 'john', 'z[0]': 'a', 'z[1]': 'b' })
// { user: { profile: { name: 'john' } }, z: ['a', 'b'] }
```

`deserialize` drops the prototype-polluting keys `__proto__`, `prototype`, and
`constructor`, so it's safe to run on untrusted input. (`serialize` skips them
too.)

## FormData

`FormData` is flat as well — and unlike a query string it can carry files.
`serialize` flattens your object while keeping `File` / `Blob` values intact, so
you append each entry as-is; on the server, read the entries back and
`deserialize`:

```ts
// client — nested object (with a file) → FormData
const flat = serialize({ user: { name: 'Ada' }, avatar: fileFromInput })
const body = new FormData()
for (const [key, value] of Object.entries(flat)) {
  for (const item of Array.isArray(value) ? value : [value]) {
    body.append(key, item) // 'user[name]' → 'Ada', 'avatar' → the File
  }
}

// server — FormData → nested object, file and all
const flatEntries = Object.fromEntries(body.entries())
deserialize(flatEntries) // { user: { name: 'Ada' }, avatar: File }
```

## Pair it with a serializer (Dates, numbers, ...)

There's a catch: `FormData` turns every non-`Blob` value into a string via
`String(value)`, so a `Date`, number, or boolean won't survive the trip on its
own. The fix is the serializer you're already using (superjson, or your own):
let it encode each leaf, and let `flat` handle the structure — files stay as
`Blob`s.

```ts
import { serialize, deserialize } from '@1gr14/flat'
import superjson from 'superjson'

// client — encode each non-file leaf
const flat = serialize({
  user: { name: 'Ada', since: new Date() },
  avatar: file,
})
const body = new FormData()
for (const [key, value] of Object.entries(flat)) {
  for (const item of Array.isArray(value) ? value : [value]) {
    body.append(key, item instanceof Blob ? item : superjson.stringify(item))
  }
}

// server — decode each non-file leaf, then rebuild the object
const flatEntries = Object.fromEntries(
  [...body.entries()].map(([key, value]) => [
    key,
    value instanceof Blob ? value : superjson.parse(value),
  ]),
)
deserialize(flatEntries) // { user: { name: 'Ada', since: Date }, avatar: File }
```

This is exactly what `Point0` does: run the body through its serializer, flatten
with `flat`, then append — files as `Blob`s, everything else encoded.

## Array keys: `arrayIndexes`

By default arrays use numeric indexes (`tags[0]`), which round-trip in order.
Pass `arrayIndexes: false` for empty brackets (`tags[]`) instead — the form many
backends and HTML forms expect:

```ts
serialize({ tags: ['x', 'y'] }) // { 'tags[0]': 'x', 'tags[1]': 'y' }
serialize({ tags: ['x', 'y'] }, { arrayIndexes: false }) // { 'tags[]': ['x', 'y'] }
```

`stringify` takes the same option, since it flattens through `serialize` first.

## Custom value encoding: `toPrimitiveString` / `fromPrimitiveString`

`stringify` writes each leaf with `toPrimitiveString`, and you can override it
to control exactly how values are written — return `undefined` to drop a key
entirely. `parse` takes the inverse, `fromPrimitiveString`, to post-process each
decoded value:

```ts
stringify(
  { id: 7, enabled: true, secret: 'skip-me' },
  {
    encode: false,
    toPrimitiveString: (value) =>
      value === 'skip-me' ? undefined : `v:${value}`,
  },
)
// 'id=v:7&enabled=v:true'  — `secret` dropped
```

The default `toPrimitiveString` is exported too, so you can wrap it instead of
reimplementing it: it stringifies numbers/booleans/bigints, `JSON.stringify`s
objects, and drops `null` / `undefined` / blank strings.

## Unencoded output: `encode`

By default `stringify` percent-encodes keys and values. Pass `encode: false` for
a human-readable query string — handy for prettier URLs. Note: unencoded output
can be ambiguous when keys or values contain `&`, `=`, or `?`.

```ts
stringify({ user: { name: 'Ada' } }) // 'user%5Bname%5D=Ada'
stringify({ user: { name: 'Ada' } }, { encode: false }) // 'user[name]=Ada'
```

## Depth limit: `maxDepth`

Every function takes `maxDepth` (default `64`). Paths deeper than the limit stay
flat instead of nesting — a guard against pathological input:

```ts
stringify({ a: { b: { c: 1 } } }, { maxDepth: 2, encode: false }) // 'a[b]={"c":1}'
deserialize({ 'a[b][c]': '1' }, { maxDepth: 2 }) // { 'a[b][c]': '1' }  — kept flat
```

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **TypeScript 5+** (optional — works in plain JS too)

<!-- docs:end -->

## Community

Questions, bugs, or want to hang with other builders? Join the 1gr14 community —
one hub for all our open-source projects, this one included. Get help, share
what you built, or just say hi:
[1gr14.dev/#community](https://1gr14.dev/#community)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). Security reports:
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

---

Made by [1gr14](https://1gr14.dev), driven by
[community](https://1gr14.dev/#community)
