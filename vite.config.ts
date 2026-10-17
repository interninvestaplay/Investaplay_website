import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

// Fix Windows junction / symlink path resolution issues in Vite & Rollup
try {
  process.chdir(fs.realpathSync(process.cwd()));
} catch (e) {
  // Ignore if realpath fails
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true, // Allows network access from other devices/phones
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/socket.io': {
          target: backendUrl,
          ws: true,
        },
      },
    },
  };
});
