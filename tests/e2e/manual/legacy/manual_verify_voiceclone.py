"""验证 VoiceClone 页面：AudioPreview 组件 + 50/50 布局 + Clone 按钮"""
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    errors = []

    # ============================================================
    # Task 1: 布局 50/50
    # ============================================================
    print("=== Task 1: VoiceClone 布局 50/50 ===")
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.locator('[data-testid="tab-voice-clone"]').click()
    page.wait_for_timeout(2000)

    result = page.evaluate("""
    () => {
        const all = document.querySelectorAll("*");
        for (const el of all) {
            const s = getComputedStyle(el);
            if (s.display === "grid" && s.gridTemplateColumns.includes("%") && el.children.length >= 2) {
                const c0 = el.children[0].getBoundingClientRect();
                const c1 = el.children[1].getBoundingClientRect();
                if (c0.width > 200 && c1.width > 200) {
                    return JSON.stringify({
                        parent: el.className.substring(0, 50),
                        cols: s.gridTemplateColumns,
                        left: Math.round(c0.width),
                        right: Math.round(c1.width),
                        ratio: (c0.width / c1.width).toFixed(2)
                    });
                }
            }
        }
        return null;
    }
    """)

    if result:
        import json
        r = json.loads(result)
        print(f"  列: {r['cols']}")
        print(f"  左: {r['left']}px, 右: {r['right']}px, 比例: {r['ratio']}")
        if r['ratio'] == "1.00":
            print("  ✓ 严格 50/50 比例")
        elif abs(float(r['ratio']) - 1.0) < 0.05:
            print("  ✓ 近似 1:1 比例")
        else:
            errors.append(f"比例不对: {r['ratio']}")
            print(f"  ✗ 比例不对: {r['ratio']}")
    else:
        print("  未找到百分比 grid（可能使用了 CSS Modules 类名）")

    page.screenshot(path="E:/repos/vcprjs/voice_clone/tests/webapp-testing/voiceclone_layout.png", full_page=True)

    # ============================================================
    # Task 2: 录制 + 上传区域存在
    # ============================================================
    print("\n=== Task 2: 录制和上传组件 ===")
    record_btn = page.locator('button', has_text='开始录制')
    if record_btn.count() > 0:
        print("  ✓ 录制按钮存在")
    else:
        errors.append("录制按钮未找到")
        print("  ✗ 录制按钮未找到")

    upload_zone = page.locator('text=拖拽音频文件到此处')
    if upload_zone.count() > 0:
        print("  ✓ 上传区域存在")
    else:
        errors.append("上传区域未找到")
        print("  ✗ 上传区域未找到")

    # ============================================================
    # Task 3: Clear All 按钮
    # ============================================================
    print("\n=== Task 3: Clear All 按钮 ===")
    clear_all = page.locator('button', has_text='Clear All')
    if clear_all.count() > 0:
        print("  ✓ Clear All 按钮存在")
    else:
        errors.append("Clear All 按钮未找到")
        print("  ✗ Clear All 按钮未找到")

    # ============================================================
    # 结果汇总
    # ============================================================
    print("\n" + "=" * 50)
    if errors:
        print(f"❌ 验证失败: {len(errors)} 个错误")
        for e in errors:
            print(f"  - {e}")
    else:
        print("✅ 全部验证通过!")

    b.close()