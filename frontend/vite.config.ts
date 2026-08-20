import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
// 这些可以保留，不影响
process.env.HTTP_PROXY = ''
process.env.HTTPS_PROXY = ''
process.env.NO_PROXY = ''
process.env.no_proxy = ''

/** 按 VITE_SITE_URL 在构建产物中生成 robots.txt / sitemap.xml（爬虫要求绝对 URL）。
 * 未配置站点 URL 时只发 robots.txt（不含 Sitemap 行），避免发出无效 sitemap。 */
function emitSeoFiles(): Plugin {
  return {
    name: 'emit-seo-files',
    generateBundle() {
      const siteUrl = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '')
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          'User-agent: *',
          'Allow: /',
          'Disallow: /admin',
          '',
          ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`, ''] : []),
        ].join('\n'),
      })
      if (!siteUrl) return
      const urls = [
        { loc: '/try', priority: '0.9' },
        { loc: '/', priority: '0.5' },
      ]
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls.map(
            (u) =>
              `  <url><loc>${siteUrl}${u.loc}</loc><priority>${u.priority}</priority></url>`,
          ),
          '</urlset>',
          '',
        ].join('\n'),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitSeoFiles()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Try 页（/try）：独立小 bundle 的 SEO 获客页，
        // 见 docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md
        try: resolve(__dirname, 'try.html'),
      },
    },
  },
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