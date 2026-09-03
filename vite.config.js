import { defineConfig } from 'vite';

// Project page at https://yuxing-lee.github.io/detour-bites/ needs
// this base so built asset URLs resolve under the repo subpath.
// Only applied for `vite build` — applying it to `vite`/dev breaks the
// dev server's HMR websocket path.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/detour-bites/' : '/',
}));
