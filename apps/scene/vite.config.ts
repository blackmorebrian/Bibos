import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single self-contained HTML so it also works as a file:// page in OBS
// (needed for the camera routes, which require a secure context).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  server: { host: true, port: 5173 },
});
