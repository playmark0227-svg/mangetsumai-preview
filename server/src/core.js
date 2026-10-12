/* Shared pricing / shipping / catalog logic (../../js/core.js, also used by the shop).
 *
 * js/core.js is a classic browser script: it assigns globalThis.MangetsuCore and, when it is
 * loaded as CommonJS, module.exports. Importing it for its side effect and reading the global
 * works everywhere we run:
 *   - Node (tests, dev/serve.mjs): there is no package.json above js/, so Node loads the file
 *     as CommonJS; the IIFE runs and sets globalThis.MangetsuCore.
 *   - wrangler / esbuild: the file is bundled as a CommonJS module and executed on import.
 * A default import (`import Core from '../../js/core.js'`) would also work in both today, but it
 * breaks if a package.json with "type": "module" is ever added above js/, so we avoid it.
 */
import '../../js/core.js';

const Core = globalThis.MangetsuCore;
if (!Core || typeof Core.priceCart !== 'function' || typeof Core.normalize !== 'function') {
  throw new Error('js/core.js could not be loaded');
}

export default Core;
