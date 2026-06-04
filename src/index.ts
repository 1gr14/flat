// This is the boilerplate entry point. Replace it with your library.
// Keep exports named, keep imports using the `.js` extension (ESM), and let the
// build (tsdown) and tests (bun) carry over unchanged.

/**
 * Greet someone by name.
 *
 * @example
 *   greet('world') // 'Hello, world!'
 */
export const greet = (name: string): string => {
  return `Hello, ${name}!`
}
