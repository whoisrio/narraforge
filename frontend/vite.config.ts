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
        // 本地开发默认指向 127.0.0.1:8002，Docker 环境通过 VITE_BACKEND_URL=http://backend:8000 覆盖
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://127.0.0.1:2024',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent/, ''),
      },
    },
  },
})