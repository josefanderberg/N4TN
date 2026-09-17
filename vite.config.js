import { defineConfig } from 'vite';

export default defineConfig({
  // Relativa sökvägar gör att bygget fungerar både i roten och under /reponamn/ på GitHub Pages.
  base: './',
  server: { port: 5178 },
  // three.js ensamt är ~550 kB; det är väntat.
  build: { chunkSizeWarningLimit: 800 },
});
