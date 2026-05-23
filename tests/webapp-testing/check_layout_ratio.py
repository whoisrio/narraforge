"""检查 TTS 页面实际加载的 CSS grid-template-columns"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.locator('[data-testid="tab-tts-synthesis"]').click()
    page.wait_for_timeout(3000)

    # 硬刷新清除缓存
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    page.locator('[data-testid="tab-tts-synthesis"]').click()
    page.wait_for_timeout(2000)

    # 检查 .content 的实际 CSS
    info = page.evaluate("""
    () => {
        const all = document.querySelectorAll("*");
        for (const el of all) {
            const s = getComputedStyle(el);
            if (s.display === "grid" && el.children.length >= 2) {
                const c0 = el.children[0].getBoundingClientRect();
                const c1 = el.children[1].getBoundingClientRect();
                if (c0.width > 100 && c1.width > 100 && c0.width + c1.width > 1000) {
                    // 检查第一个子元素的类名来确认是 leftColumn
                    const child0Class = el.children[0].className;
                    const child1Class = el.children[1].className;
                    return JSON.stringify({
                        parentClass: el.className.substring(0, 60),
                        child0Class: child0Class.substring(0, 40),
                        child1Class: child1Class.substring(0, 40),
                        gridCols: s.gridTemplateColumns,
                        totalWidth: Math.round(c0.width + c1.width),
                        c0w: Math.round(c0.width),
                        c1w: Math.round(c1.width),
                    });
                }
            }
        }
        return "no grid found";
    }
    """)
    print(info)

    b.close()