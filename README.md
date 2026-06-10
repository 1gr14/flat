# @1gr14/flat

> Flatten nested objects, and turn them into URL query strings and back —
> arrays, deep nesting, and custom encoding included.

[![CI](https://github.com/1gr14/flat/actions/workflows/ci.yml/badge.svg)](https://github.com/1gr14/flat/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@1gr14/flat.svg)](https://www.npmjs.com/package/@1gr14/flat)
[![coverage](https://codecov.io/gh/1gr14/flat/branch/main/graph/badge.svg)](https://codecov.io/gh/1gr14/flat)
[![gzip](https://deno.bundlejs.com/badge?q=@1gr14/flat)](https://bundlejs.com/?q=@1gr14/flat)
[![license](https://img.shields.io/npm/l/@1gr14/flat.svg)](./LICENSE)

<!-- docs:start -->

URL query strings and multipart `FormData` only carry a flat list of
`key → value` pairs. `flat` exists to push **nested** objects through them: it
flattens an object to bracket-notation keys on one side and rebuilds it on the
other. Use `stringify` / `parse` for query strings, and `serialize` /
`deserialize` for `FormData`. Arrays, deep nesting, and repeated keys just work;
`File` / `Blob` values travel inside `FormData` untouched; and prototype
pollution is blocked.

```ts
import { serialize, deserialize, stringify, parse } from '@1gr14/flat'

const obj = { q: 'shoes', filters: { price: { min: 10 } }, tags: ['a', 'b'] }

// nested object ⇄ URL query string
const stringified = stringify(obj)
// 'q=shoes&filters[price][min]=10&tags[0]=a&tags[1]=b' (brackets URL-encoded)

const parsed = parse(stringified)
// { q: 'shoes', filters: { price: { min: '10' } }, tags: ['a', 'b'] }  — all strings

// nested object ⇄ flat bracket-notation map (what you append to FormData)
const serialized = serialize(obj)
// { q: 'shoes', 'filters[price][min]': 10, 'tags[0]': 'a', 'tags[1]': 'b' }

const deserialized = deserialize(serialized)
// { q: 'shoes', filters: { price: { min: 10 } }, tags: ['a', 'b'] }  — types kept
```

## Install

```sh
bun add @1gr14/flat
# or: npm install / pnpm add / yarn add
```

Bun 1+ or Node.js 20+. ESM only.

## One core, two transports

Query strings and `FormData` look like different problems, but the work
underneath is identical: walk a nested object into flat bracket-notation keys,
and walk it back. `stringify` / `parse` add URL encoding on top of that core;
`serialize` / `deserialize` hand you the flat map directly (what you feed to
`FormData`). Same utilities either way — so it's one package, not two repos
duplicating the same logic.

## Query strings: `stringify` and `parse`

`stringify` turns a nested object into a query string; `parse` turns it back.
Arrays and nested objects round-trip:

```ts
stringify({ x: '1', deep: { y: 2 }, list: ['a', 'b'] })
// 'x=1&deep[y]=2&list[0]=a&list[1]=b'

parse('x=1&deep[y]=2&list[0]=a&list[1]=b')
// { x: '1', deep: { y: '2' }, list: ['a', 'b'] }

// repeated keys collapse into an array
parse('a=1&a=2') // { a: ['1', '2'] }
```

## Flatten: `serialize` and `deserialize`

Need the flat key/value map instead of a string? `serialize` flattens a nested
object to bracket-notation keys; `deserialize` rebuilds it:

```ts
serialize({ x: 1, user: { profile: { name: 'john' } }, z: ['a', 'b'] })
// { x: 1, 'user[profile][name]': 'john', 'z[0]': 'a', 'z[1]': 'b' }

deserialize({ 'user[profile][name]': 'john', 'z[0]': 'a', 'z[1]': 'b' })
// { user: { profile: { name: 'john' } }, z: ['a', 'b'] }
```

## FormData

`FormData` is flat too — and unlike a query string it can carry files.
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

## Array keys

By default arrays use numeric indexes (`tags[0]`). Pass `arrayIndexes: false`
for empty brackets (`tags[]`) instead:

```ts
serialize({ tags: ['x', 'y'] }) // { 'tags[0]': 'x', 'tags[1]': 'y' }
serialize({ tags: ['x', 'y'] }, { arrayIndexes: false }) // { 'tags[]': ['x', 'y'] }
```

## Custom value encoding

`stringify` takes `toPrimitiveString` to control how each value is written —
return `undefined` to drop a key. `parse` takes the inverse,
`fromPrimitiveString`:

```ts
stringify(
  { id: 7, enabled: true, secret: 'skip-me' },
  {
    toPrimitiveString: (value) =>
      value === 'skip-me' ? undefined : `v:${value}`,
  },
)
// 'id=v:7&enabled=v:true'  — `secret` dropped
```

## Unencoded output

By default `stringify` percent-encodes keys and values. Pass `encode: false` for
a human-readable query string (handy for prettier URLs). Note: unencoded output
can be ambiguous when keys/values contain `&`, `=`, or `?`.

```ts
stringify({ user: { name: 'Ada' } }) // 'user%5Bname%5D=Ada'
stringify({ user: { name: 'Ada' } }, { encode: false }) // 'user[name]=Ada'
```

## Depth limit

Every function takes `maxDepth` (default `64`). Paths deeper than the limit stay
flat instead of nesting — a guard against pathological input.

## API reference

| Call                           | Result                                                 |
| ------------------------------ | ------------------------------------------------------ |
| `serialize(input, options?)`   | Nested object → flat bracket-notation object.          |
| `deserialize(input, options?)` | Flat object → nested object.                           |
| `stringify(input, options?)`   | Nested object → URL query string.                      |
| `parse(input, options?)`       | Query string → nested object.                          |
| `toPrimitiveString(value)`     | Default value-to-string used by `stringify`.           |
| `flat`                         | Namespace bundling all four (also the default export). |

**Options:** `serialize` / `stringify` take `arrayIndexes` (default `true`) and
`maxDepth` (default `64`); `stringify` also takes `toPrimitiveString` and
`encode` (default `true`). `parse` / `deserialize` take `maxDepth`; `parse` also
takes `fromPrimitiveString`.

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **TypeScript 5+** (optional — works in plain JS too)

<!-- docs:end -->

## Community

Questions, bugs, or want to hang with other builders? Join the 1gr14 community —
one hub for all our open-source projects, this one included. Get help, share
what you built, or just say hi:
[1gr14.dev/community](https://1gr14.dev/community)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). Security reports:
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

---

```text
Building open-source software for the glory of the Lord Jesus Christ ☦️
With love for developers of all backgrounds around the world ❤️
Sergei Dmitriev, 2026 😎
```
