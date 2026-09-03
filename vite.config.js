import { defineConfig } from 'vite';

// Project page at https://yuxing-lee.github.io/detour-bites/ needs
// this base so built asset URLs resolve under the repo subpath.
export default defineConfig({
  base: '/detour-bites/',
});
