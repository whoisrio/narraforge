"""快速检查 VoiceClone 50/50 布局是否生效"""
from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.locator('[data-testid="tab-voice-clone"]').click()
    page.wait_for_timeout(3000)

    # 硬刷新
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.locator('[data-testid="tab-voice-clone"]').click()
    page.wait_for_timeout(2000)

    # 直接找所有 grid 的 computed style
    result = page.evaluate("""
    () => {
        const grids = [];
        const all = document.querySelectorAll("*");
        for (const el of all) {
            const s = getComputedStyle(el);
            if (s.display === "grid" && el.children.length >= 2) {
                const c0 = el.children[0].getBoundingClientRect();
                const c1 = el.children[1].getBoundingClientRect();
                if (c0.width > 200 && c1.width > 200 && c0.width + c1.width > 800) {
                    grids.push({
                        cls: el.className.substring(0, 60),
                        cols: s.gridTemplateColumns,
                        c0: Math.round(c0.width),
                        c1: Math.round(c1.width),
                        ratio: (c0.width / c1.width).toFixed(2),
                    });
                }
            }
        }
        return JSON.stringify(grids);
    }
    """)
    
    grids = json.loads(result)
    for g in grids:
        print(f"  {g['cls']}: {g['cols']} | 左={g['c0']} 右={g['c1']} 比例={g['ratio']}")

    b.close()