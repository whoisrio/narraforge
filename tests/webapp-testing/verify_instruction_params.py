"""
验证新增功能：复刻指令、SSML开关、过滤Markdown开关
"""
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
BROWSER_PATH = r"C:\Users\riodo\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=BROWSER_PATH)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []

    page.goto(BASE_URL)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 点击"体验文字转语音"按钮进入 TTS 页面
    tts_btn = page.locator('button:has-text("体验文字转语音")')
    if tts_btn.count() > 0:
        tts_btn.click()
        page.wait_for_timeout(2000)
        print("✓ 进入 TTS 页面")
    else:
        # 尝试导航链接
        nav_link = page.locator('a[href*="tts"]')
        if nav_link.count() > 0:
            nav_link.click()
            page.wait_for_timeout(2000)
            print("✓ 通过导航链接进入 TTS 页")

    # 展开参数设置面板
    expand_btn = page.locator('button:has-text("展开")')
    if expand_btn.count() > 0:
        expand_btn.click()
        page.wait_for_timeout(500)
        print("✓ 展开参数设置面板")
    else:
        print("⚠ 未找到'展开'按钮，可能已展开")

    page.screenshot(path='E:/repos/vcprjs/voice_clone/tests/webapp-testing/instruction_params_tts.png', full_page=True)

    # 打印当前页面可见内容用于调试
    body_text = page.inner_text('body')
    print(f"当前页面文本前800字符:\n{body_text[:800]}")

    # -------------------------------------------------------
    # 1. 复刻指令 - 输入框
    # -------------------------------------------------------
    print("\n=== 1. 复刻指令输入框 ===")
    instruction_input = page.locator('input#instruction')
    if instruction_input.count() > 0:
        val = instruction_input.input_value()
        print(f"✓ 复刻指令输入框存在，当前值: '{val}'")
        if '广告配音' in val or '活力' in val:
            print("  ✓ 默认值包含广告配音相关关键词")
    else:
        # 列出所有 input 元素
        all_inputs = page.locator('input').all()
        print(f"  页面上所有 input 元素: {len(all_inputs)}")
        for inp in all_inputs:
            try:
                pid = inp.get_attribute('id')
                ptype = inp.get_attribute('type')
                placeholder = inp.get_attribute('placeholder')
                val = inp.input_value()
                print(f"    id='{pid}' type='{ptype}' placeholder='{placeholder}' value='{val[:40]}'")
            except:
                pass

        # 尝试通过 label 查找
        instruction_label = page.locator('label:has-text("复刻指令"), label:has-text("Instruction")')
        if instruction_label.count() > 0:
            print(f"  ✓ 找到复刻指令 label: {instruction_label.first.inner_text()}")
        errors.append("✗ 复刻指令输入框 #instruction 未找到")
        print("✗ 复刻指令输入框 #instruction 未找到")

    # 确认旧 emotion 下拉已移除
    emotion_el = page.locator('label:has-text("Emotion"), label:has-text("语")').filter(has=page.locator('select'))
    if emotion_el.count() > 0:
        errors.append("✗ 旧的语气/emotion 选择器仍然存在")
        print("✗ 旧的语气/emotion 选择器仍然存在")
    else:
        print("✓ 旧的语气/emotion 下拉已移除")

    # -------------------------------------------------------
    # 2. 预设按钮验证
    # -------------------------------------------------------
    print("\n=== 2. 预设按钮 ===")
    presets = ["广告配音", "播音主持", "温柔治愈"]
    for preset_name in presets:
        btn = page.locator(f'button:has-text("{preset_name}")')
        if btn.count() > 0:
            print(f"✓ 预设按钮 '{preset_name}' 存在")
        else:
            errors.append(f"✗ 预设按钮 '{preset_name}' 未找到")
            print(f"✗ 预设按钮 '{preset_name}' 未找到")

    # 点击预设验证
    if instruction_input.count() > 0:
        print("\n  验证预设点击效果...")
        for preset_name, expected_keyword in [
            ("广告配音", "活力"),
            ("播音主持", "字正腔圆"),
            ("温柔治愈", "温暖"),
        ]:
            btn = page.locator(f'button:has-text("{preset_name}")')
            if btn.count() > 0:
                btn.click()
                page.wait_for_timeout(300)
                val = instruction_input.input_value()
                if expected_keyword in val:
                    print(f"  ✓ 点击'{preset_name}'后输入包含'{expected_keyword}'")
                else:
                    print(f"  ✗ 点击'{preset_name}'后值='{val[:40]}' 不包含'{expected_keyword}'")
                    errors.append(f"✗ 预设'{preset_name}'点击后内容不匹配")

    # -------------------------------------------------------
    # 3. SSML 开关
    # -------------------------------------------------------
    print("\n=== 3. SSML 开关 ===")
    ssml_label = page.locator('text=启用 SSML')
    if ssml_label.count() > 0:
        print("✓ '启用 SSML' 标签存在")
        ssml_toggle = page.locator('div:has(> span:text("启用 SSML")) button[role="switch"]')
        if ssml_toggle.count() > 0:
            initial_state = ssml_toggle.get_attribute('aria-checked')
            print(f"  ✓ SSML 开关存在，初始状态: {initial_state}")
            if initial_state == 'false':
                print("  ✓ SSML 默认关闭")
            ssml_toggle.click()
            page.wait_for_timeout(300)
            new_state = ssml_toggle.get_attribute('aria-checked')
            if new_state == 'true':
                print("  ✓ 点击后 SSML 切换到开启")
            else:
                errors.append(f"✗ SSML 切换失败: {initial_state} → {new_state}")
            ssml_toggle.click()
            page.wait_for_timeout(300)
        else:
            errors.append("✗ SSML 开关按钮未找到")
            print("✗ SSML 开关按钮未找到")
    else:
        errors.append("✗ '启用 SSML' 文本未找到")
        print("✗ '启用 SSML' 文本未找到")

    # -------------------------------------------------------
    # 4. 过滤 Markdown 开关
    # -------------------------------------------------------
    print("\n=== 4. 过滤 Markdown 开关 ===")
    md_label = page.locator('text=过滤 Markdown 标记')
    if md_label.count() > 0:
        print("✓ '过滤 Markdown 标记' 标签存在")
        md_toggle = page.locator('div:has(> span:text("过滤 Markdown 标记")) button[role="switch"]')
        if md_toggle.count() > 0:
            initial_state = md_toggle.get_attribute('aria-checked')
            print(f"  ✓ Markdown 过滤开关存在，初始状态: {initial_state}")
            if initial_state == 'false':
                print("  ✓ Markdown 过滤默认关闭")
            md_toggle.click()
            page.wait_for_timeout(300)
            new_state = md_toggle.get_attribute('aria-checked')
            if new_state == 'true':
                print("  ✓ 点击后 Markdown 过滤切换到开启")
            else:
                errors.append(f"✗ Markdown 过滤切换失败: {initial_state} → {new_state}")
            md_toggle.click()
            page.wait_for_timeout(300)
        else:
            errors.append("✗ Markdown 过滤开关按钮未找到")
            print("✗ Markdown 过滤开关按钮未找到")
    else:
        errors.append("✗ '过滤 Markdown 标记' 文本未找到")
        print("✗ '过滤 Markdown 标记' 文本未找到")

    # -------------------------------------------------------
    # 5. 字符计数
    # -------------------------------------------------------
    print("\n=== 5. 字符计数 ===")
    count_el = page.locator('span:has-text("/50")')
    if count_el.count() > 0:
        print(f"✓ 字符计数存在: {count_el.inner_text()}")
    else:
        print("⚠ 字符计数元素未找到（可能是 CSS Module 类名）")

    # -------------------------------------------------------
    # 截图
    # -------------------------------------------------------
    page.screenshot(
        path='E:/repos/vcprjs/voice_clone/tests/webapp-testing/instruction_params.png',
        full_page=True,
    )
    print(f"\n截图已保存")

    # -------------------------------------------------------
    # 总结
    # -------------------------------------------------------
    print(f"\n{'='*50}")
    if errors:
        print(f"验证失败: {len(errors)} 个错误")
        for e in errors:
            print(f"  {e}")
    else:
        print("✓ 全部验证通过！")

    browser.close()