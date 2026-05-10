import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiProxyTarget = env.VITE_VERCEL_API_PROXY_TARGET?.trim();
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        ...(apiProxyTarget
          ? {
              proxy: {
                '/api': { target: apiProxyTarget, changeOrigin: true },
              },
            }
          : {}),
      },
      // Para desplegar bajo subruta (ej. /preview/athenea/), descomenta y ajusta:
      // base: '/preview/athenea/',
      plugins: [
        react(),
        nodePolyfills({
          include: ['buffer', 'process', 'util', 'stream'],
          globals: { Buffer: true, process: true },
          protocolImports: true,
        }),
      ],
      define: {
        // Legacy: kept for any third-party module that might still read these.
        // The app itself reads the AI endpoint from `import.meta.env.VITE_AI_ENDPOINT_URL`
        // and only falls back to `VITE_GEMINI_API_KEY` if the endpoint is missing.
        'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
