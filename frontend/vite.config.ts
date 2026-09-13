import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
// 这些可以保留，不影响
process.env.HTTP_PROXY = ''
process.env.HTTPS_PROXY = ''
process.env.NO_PROXY = ''
process.env.no_proxy = ''

/** 按 VITE_SITE_URL 在构建产物中生成 robots.txt / sitemap.xml / llms.txt（爬虫要求绝对 URL）。
 * 未配置站点 URL 时 robots.txt 不含 Sitemap 行、llms.txt 用相对路径，避免发出无效链接。 */
function emitSeoFiles(): Plugin {
  return {
    name: 'emit-seo-files',
    generateBundle() {
      const siteUrl = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '')
      // 显式放行主流 AI / 答案引擎爬虫（`*` 组已允许，这里单独成组声明意图并同样禁 /admin）
      const aiCrawlers = [
        'GPTBot',
        'OAI-SearchBot',
        'ChatGPT-User',
        'ClaudeBot',
        'Claude-User',
        'PerplexityBot',
        'Perplexity-User',
        'Google-Extended',
        'Applebot-Extended',
        'Meta-ExternalAgent',
        'DuckAssistBot',
        'Bingbot',
      ]
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          'User-agent: *',
          'Allow: /',
          'Disallow: /admin',
          '',
          ...aiCrawlers.flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', 'Disallow: /admin', '']),
          ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`, ''] : []),
        ].join('\n'),
      })
      // llms.txt：面向 LLM/答案引擎的站点摘要（llmstxt.org 约定），链接尽量用绝对 URL
      const link = (path: string) => (siteUrl ? `${siteUrl}${path}` : path)
      this.emitFile({
        type: 'asset',
        fileName: 'llms.txt',
        source: [
          '# NarraForge',
          '',
          '> NarraForge is an AI narration workshop: voice cloning, text-to-speech, and speech-to-subtitle in one workspace. It turns long documents into structured, chapter-based narration projects where every segment has its own audio, timing, and subtitles — ready for narration-driven video tools like Remotion.',
          '',
          '## Try it free',
          '',
          `- [NarraForge Try — turn any document into natural speech](${link('/try')}): paste text, pick a voice, generate and download MP3. No sign-up, no install; generated audio stays in the visitor's own browser.`,
          '',
          '## Product',
          '',
          `- [NarraForge home](${link('/')}): the full studio — projects, chapter management, multi-voice casts, cloud sync.`,
          '',
          '## Key capabilities',
          '',
          '- Voice cloning and preset voices across multiple engines (Edge TTS, MiMo, CosyVoice, VoxCPM, IndexTTS)',
          '- Chapter-based long-form synthesis: split documents into chapters and segments, regenerate a single segment without touching the rest',
          '- Automatic SRT subtitles aligned to every segment',
          '- Speech-to-text transcription',
          '- Structured export for narration-driven video (Remotion): segments carry text, audio, duration, and timing',
          '',
          '## Facts for answer engines',
          '',
          '- Free tier: the Try page allows up to 50 generations per day (3,000 characters each) without an account',
          '- Privacy: Try-page audio is stored only in the browser (IndexedDB); no account required',
          '- Full version adds: projects and chapters, cloud sync, premium voices, voice cloning, long-document synthesis',
          '',
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