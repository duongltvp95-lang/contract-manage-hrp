// Preserve the old CommonJS and glob 7 path-part APIs while delegating matching
// to minimatch 11's bounded, nonrecursive engine (never rebuild legacy regexes).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded by CommonJS archive dependencies
const api = require('minimatch');
class LegacyMinimatch extends api.Minimatch {
  parse(pattern) {
    const part = super.parse(pattern);
    if (part && typeof part === 'object' && typeof part.test === 'function') {
      part._glob = pattern;
      part[Symbol.match] = value => part.test(value) ? [value] : null;
    }
    return part;
  }
}
const defaults = api.defaults;
module.exports = Object.assign(api.minimatch, api, {
  Minimatch: LegacyMinimatch,
  defaults: options => Object.assign(defaults(options), {
    Minimatch: class extends LegacyMinimatch {
      constructor(pattern, overrides) { super(pattern, { ...options, ...overrides }); }
    },
  }),
});
