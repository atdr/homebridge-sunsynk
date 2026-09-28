// Borrow Homebridge's own matter.js instance. A plugin-local @matter/main is a
// second module instance and matter.js rejects its behaviors ("is not a
// Behavior.Type"). Load the ESM build, because that is what Homebridge imports.
const { createRequire } = require('node:module');
const { realpathSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async function homebridgeMatter() {
  // argv[1] is homebridge's bin (main bridge) or dist/childBridgeFork.js (child bridge)
  const candidates = [process.argv[1], require.main?.filename].filter(Boolean);
  for (const entry of candidates) {
    try {
      // argv[1] may omit the .js extension, so resolve from its (real) directory
      const cjsMain = createRequire(path.join(realpathSync(path.dirname(entry)), 'x.js')).resolve('@matter/main');
      const marker = path.join('@matter', 'main');
      const root = cjsMain.slice(0, cjsMain.lastIndexOf(marker) + marker.length);
      const load = (f) => import(pathToFileURL(path.join(root, 'dist', 'esm', f)).href);
      return { root, devices: await load('devices.js'), behaviors: await load('behaviors.js') };
    } catch { /* try next */ }
  }
  throw new Error(`Could not locate Homebridge's @matter/main from ${candidates.join(', ')}`);
};
