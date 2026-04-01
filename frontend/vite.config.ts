import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 这些可以保留，不影响
process.env.HTTP_PROXY = ''
process.env.HTTPS_PROXY = ''
process.env.NO_PROXY = ''
process.env.no_proxy = ''

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]__[hash:base64:5]',
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
    },
  },
})