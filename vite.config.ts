import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PLACEHOLDER = '__CLOUDSCAPE_FONT_HASH__';

// Cloudscape sets component fonts through a CSS variable whose name carries a hash
// (e.g. --font-family-base-khplu5) that changes between Cloudscape versions.
// Read the real name from the installed package so src/fonts.css keeps overriding it,
// and fail the build instead of silently falling back to another font.
function cloudscapeFontToken(): Plugin {
  let hash = '';
  return {
    name: 'cloudscape-font-token',
    buildStart() {
      const require = createRequire(import.meta.url);
      const pkgDir = require.resolve('@cloudscape-design/components/package.json').replace(/package\.json$/, '');
      const css = readFileSync(`${pkgDir}internal/base-theme/styles.scoped.css`, 'utf8');
      const found = [...new Set([...css.matchAll(/--font-family-base-([a-z0-9]+):/g)].map(m => m[1]))];
      if (found.length !== 1) {
        this.error(`Expected one Cloudscape --font-family-base-* token, found: ${found.join(', ') || 'none'}`);
      }
      hash = found[0];
    },
    transform(code, id) {
      if (!id.split('?')[0].replace(/\\/g, '/').endsWith('/src/fonts.css')) return null;
      if (!code.includes(PLACEHOLDER)) this.error(`${PLACEHOLDER} not found in src/fonts.css`);
      return { code: code.replaceAll(PLACEHOLDER, hash), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudscapeFontToken()],
  build: { outDir: 'dist' },
});
