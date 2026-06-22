"""调试：查看 TTS 页面 VoiceSelector 的实际渲染内容"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5173")
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 切换到 TTS 页面
    page.locator('[data-testid="tab-tts-synthesis"]').click()
    page.wait_for_timeout(3000)

    # 打印页面中所有可见文本
    print("--- 页面文本 ---")
    print(page.inner_text('body')[:2000])

    # 查找 VoiceSelector 相关的元素
    for sel in ['[data-testid="voice-select"]', '.VoiceSelector', '#voice-select']:
        count = page.locator(sel).count()
        print(f"\n{sel}: {count}")

    browser.close()