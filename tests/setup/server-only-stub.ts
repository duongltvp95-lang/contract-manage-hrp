/**
 * Test stub for the `server-only` package.
 *
 * `server-only` deliberately throws unless it is resolved with the
 * `react-server` condition, which stops a Client Component from importing
 * server code. Vitest has no such condition, so every `lib/services/*` and
 * `lib/r2/*` import would explode. Aliasing it to an empty module keeps the
 * guard where it matters (the Next build) and lets the tests import the code
 * they are checking.
 */
export {};
