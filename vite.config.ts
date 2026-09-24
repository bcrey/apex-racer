import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Production is served at bcr.co/apexracer (proxied to this Vercel project),
  // so built asset and API URLs carry that prefix; vercel.json maps it back
  // to the root here, which keeps apex-racer.vercel.app working as well.
  base: command === 'build' ? '/apexracer/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    // Reach the dev server through Cloudflare tunnels and Tailscale
    allowedHosts: ['.trycloudflare.com', '.ts.net'],
  },
}));
