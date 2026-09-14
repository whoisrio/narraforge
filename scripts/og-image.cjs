#!/usr/bin/env node
/**
 * 生成 og:image 社交分享封面（1200×630 PNG）→ frontend/public/og-cover.png
 *
 * 设计语言与 Landing / Try 页一致：米白底 + 琥珀主色 + 品牌弧环 logo，
 * 签名元素是底部「波形 → 分段时间线」横带（产品 thesis：音频有结构）。
 *
 * 用法：node scripts/og-image.cjs
 * 依赖：根目录 playwright（e2e 已有）+ 本机 chromium。
 */
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'frontend', 'public', 'og-cover.png');

// 波形柱：确定性伪随机，左密右疏，过渡到时间线
const bars = Array.from({ length: 34 }, (_, i) => {
  const h = 8 + Math.round(46 * Math.abs(Math.sin(i * 1.7) * 0.7 + Math.sin(i * 0.9) * 0.3));
  return `<i style="height:${h}px"></i>`;
}).join('');

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500;1,6..72,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; }
  .card {
    position: relative;
    width: 1200px; height: 630px;
    background: #fff8f1;
    font-family: 'Plus Jakarta Sans', sans-serif;
    color: #1d1b17;
    padding: 60px 72px 48px;
    display: flex; flex-direction: column;
  }
  /* 右上品牌弧环 logo（Landing hero 同款渐变弧）+ 光晕 */
  .glow {
    position: absolute; right: 40px; top: 30px;
    width: 460px; height: 460px; border-radius: 50%;
    background: radial-gradient(circle at center, rgba(196,122,58,0.10) 0%, transparent 70%);
  }
  .ring {
    position: absolute; right: 75px; top: 65px;
    width: 390px; height: 390px; border-radius: 50%;
    border: 1px solid rgba(196,122,58,0.18);
  }
  .logo { position: absolute; right: 100px; top: 90px; }
  .dot1 { position: absolute; right: 118px; top: 120px; width: 22px; height: 22px; border-radius: 50%; background: rgba(196,122,58,0.50); }
  .dot2 { position: absolute; right: 420px; top: 400px; width: 15px; height: 15px; border-radius: 50%; background: rgba(212,148,78,0.40); }
  .dot3 { position: absolute; right: 150px; top: 430px; width: 9px; height: 9px; border-radius: 50%; background: rgba(139,76,13,0.30); }

  .wordmark { display: flex; align-items: center; gap: 14px; }
  .wordmark svg { display: block; }
  .wordmark span {
    font-size: 20px; font-weight: 800; letter-spacing: 3px; color: #1d1b17;
  }
  .kicker {
    margin-top: 56px;
    font-size: 15px; font-weight: 700; letter-spacing: 3px;
    text-transform: uppercase; color: #c47a3a;
  }
  h1 {
    margin-top: 16px;
    font-family: 'Newsreader', Georgia, serif;
    font-size: 66px; font-weight: 600; line-height: 1.08; letter-spacing: -0.02em;
    max-width: 620px;
  }
  h1 em { font-style: italic; color: #c47a3a; }
  .sub {
    margin-top: 20px;
    font-size: 19px; line-height: 1.5; color: #534439; max-width: 560px;
  }
  /* 转化 CTA：社交预览里的可点击暗示 */
  .cta {
    margin-top: 30px;
    align-self: flex-start;
    display: flex; align-items: center; gap: 10px;
    background: #8b4c0d; color: #fff8f1;
    font-size: 18px; font-weight: 700; letter-spacing: 0.3px;
    padding: 13px 24px; border-radius: 999px;
    box-shadow: 0 4px 14px rgba(139,76,13,0.30);
  }
  .cta .arr { color: #e8a838; font-weight: 800; }

  /* 签名元素：波形 → 分段时间线 */
  .strip {
    margin-top: auto;
    border-top: 1px solid #e8e1db;
    padding-top: 18px;
  }
  .stripLabel {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; letter-spacing: 2px; color: #8b4c0d; opacity: 0.75;
    margin-bottom: 14px;
  }
  .track { display: flex; align-items: center; gap: 24px; }
  .wave { display: flex; align-items: center; gap: 4px; height: 56px; }
  .wave i { display: block; width: 4px; border-radius: 2px; background: #c47a3a; opacity: 0.85; }
  .arrow { color: #c47a3a; font-size: 22px; font-weight: 600; }
  .segments { display: flex; gap: 10px; flex: 1; }
  .seg {
    border: 1px solid #e8e1db; border-radius: 8px; background: #ffffff;
    padding: 10px 14px 9px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .seg .t { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #8b4c0d; }
  .seg .b { margin-top: 7px; height: 5px; border-radius: 3px; background: rgba(196,122,58,0.30); }
  .seg.s1 { width: 150px; } .seg.s1 .b { width: 82%; }
  .seg.s2 { width: 110px; } .seg.s2 .b { width: 64%; }
  .seg.s3 { width: 180px; } .seg.s3 .b { width: 91%; }
  .seg.s4 { width: 130px; } .seg.s4 .b { width: 70%; }
</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="ring"></div>
  <div class="logo">
    <svg width="340" height="340" viewBox="0 0 320 320" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d4944e" /><stop offset="1" stop-color="#8b4c0d" />
        </linearGradient>
        <linearGradient id="lg2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c47a3a" /><stop offset="1" stop-color="#d4944e" />
        </linearGradient>
      </defs>
      <g transform="translate(160 160)">
        <path d="M0 -128 A128 128 0 0 1 109.8 -65" stroke="url(#lg1)" stroke-width="35" stroke-linecap="round" />
        <path d="M120 -31 A128 128 0 0 1 90.6 90.6" stroke="url(#lg2)" stroke-width="35" stroke-linecap="round" opacity="0.88" />
        <path d="M65 109.8 A128 128 0 0 1 -65 109.8" stroke="url(#lg1)" stroke-width="35" stroke-linecap="round" opacity="0.72" />
        <path d="M-90.6 90.6 A128 128 0 0 1 -120 -31" stroke="url(#lg2)" stroke-width="35" stroke-linecap="round" opacity="0.55" />
        <path d="M-109.8 -65 A128 128 0 0 1 0 -128" stroke="url(#lg1)" stroke-width="35" stroke-linecap="round" opacity="0.38" />
        <circle cx="0" cy="0" r="22" fill="#8b4c0d" />
        <circle cx="0" cy="0" r="9" fill="#fff8f1" />
      </g>
    </svg>
  </div>
  <div class="dot1"></div><div class="dot2"></div><div class="dot3"></div>

  <div class="wordmark">
    <svg width="34" height="34" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="23" fill="#1a1814"/>
      <circle cx="24" cy="24" r="23" stroke="#c47a3a" stroke-width="1.5" opacity="0.4"/>
      <rect x="18" y="10" width="12" height="18" rx="6" fill="#c47a3a"/>
      <path d="M15 26a9 9 0 0 0 18 0" stroke="#c47a3a" stroke-width="2" fill="none" stroke-linecap="round"/>
      <line x1="24" y1="35" x2="24" y2="40" stroke="#c47a3a" stroke-width="2" stroke-linecap="round"/>
      <line x1="19" y1="40" x2="29" y2="40" stroke="#c47a3a" stroke-width="2" stroke-linecap="round"/>
      <path d="M34 16a5 5 0 0 1 0 8" stroke="#e8a838" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.7"/>
      <path d="M37 13a10 10 0 0 1 0 14" stroke="#e8a838" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.4"/>
    </svg>
    <span>NARRAFORGE</span>
  </div>

  <div class="kicker">AI Voice Studio</div>
  <h1>Every segment has<br />its own <em>voice</em>.</h1>
  <p class="sub">Voice cloning, text-to-speech &amp; speech-to-subtitle — chapter-based long-form synthesis where every segment keeps its own boundary, duration and timing.</p>
  <div class="cta">Try it free — no sign-up <span class="arr">→</span></div>

  <div class="strip">
    <div class="stripLabel">SEGMENT TIMELINE · CH 01</div>
    <div class="track">
      <div class="wave">${bars}</div>
      <div class="arrow">→</div>
      <div class="segments">
        <div class="seg s1"><div class="t">0:00 – 0:12</div><div class="b"></div></div>
        <div class="seg s2"><div class="t">0:12 – 0:19</div><div class="b"></div></div>
        <div class="seg s3"><div class="t">0:19 – 0:44</div><div class="b"></div></div>
        <div class="seg s4"><div class="t">0:44 – 1:02</div><div class="b"></div></div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: 'png' });
  await browser.close();
  console.log(`og-cover written: ${OUT}`);
})();
