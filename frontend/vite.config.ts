/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BACKEND = 'http://127.0.0.1:8787'
const ORIGIN_HEADER = 'origin'

const sourceRoot = (folder: string) => fileURLToPath(new URL(`./src/${folder}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      app: sourceRoot('app'),
      pages: sourceRoot('pages'),
      'system-ui': sourceRoot('system-ui'),
      __scenarios__: sourceRoot('__scenarios__'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/start-plan': {
        target: BACKEND,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxied) => proxied.removeHeader(ORIGIN_HEADER))
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '__tests__/**/*.test.ts'],
  },
})
