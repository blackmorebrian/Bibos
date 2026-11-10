import { defineConfig } from 'vite';

// Built into the scene's output so Vercel serves it at /panel/.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: '../scene/dist/panel', emptyOutDir: true },
  server: { host: true, port: 5175 },
});
