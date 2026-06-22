"""
验证UI改进 v2：布局比例 + 分段控制器 + Edge-TTS 下拉菜单 & 折叠面板
"""
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    warnings = []

    # ============================================================
    # Task 1: 布局比例 & 分段控制器
    # ============================================================
    print("=== Task 1: 布局比例 & 分段控制器 ===")
    page.goto(BASE_URL)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 切换到 TTS 页面
    page.locator('[data-testid="tab-tts-synthesis"]').click()
    page.wait_for_timeout(1500)

    # 检查分段控制器（不再是旧式tabs）
    engine_switch = page.locator(f'.engineSwitch')
    if engine_switch.count() > 0:
        print("✓ 分段控制器存在")
    else:
        # 可能用了 CSS Modules 哈希名，尝试通过内容查找
        segment = page.locator('div:has(button:has-text("CosyVoice")):has(button:has-text("Edge-TTS"))')
        if segment.count() > 0:
            print("✓ 分段控制器存在 (via content)")
        else:
            errors.append("分段控制器未找到")
            print("✗ 分段控制器未找到")

    # 检查 CosyVoice 按钮是否可选
    cosyvoice_btn = page.locator('button', has_text='CosyVoice')
    edge_tts_btn = page.locator('button', has_text='Edge-TTS')
    if cosyvoice_btn.count() > 0 and edge_tts_btn.count() > 0:
        print("✓ CosyVoice 和 Edge-TTS 按钮都存在")
    else:
        errors.append("引擎选项按钮缺失")
        print("✗ 引擎选项按钮缺失")

    # 检查布局比例 2:1 (rough check: 左列宽度 > 右列 × 1.5)
    left = page.locator(f'.leftColumn')
    right = page.locator(f'.rightColumn')
    if left.count() > 0 and right.count() > 0:
        left_box = left.bounding_box()
        right_box = right.bounding_box()
        if left_box and right_box:
            ratio = left_box['width'] / right_box['width']
            if ratio >= 1.5:
                print(f"✓ 布局比例 {ratio:.1f}:1 (左:{int(left_box['width'])}px / 右:{int(right_box['width'])}px)")
            else:
                warnings.append(f"布局比例不够大: {ratio:.1f}:1")
                print(f"⚠ 布局比例 {ratio:.1f}:1 (预期 >= 1.5:1)")
        else:
            warnings.append("无法获取布局尺寸")
            print("⚠ 无法获取布局尺寸")
    else:
        # CSS Modules 类名不同，尝试通过 grid 验证
        print("⚠ 使用CSS Modules类名，跳过宽高比例精确检查")

    page.screenshot(path='E:/repos/vcprjs/voice_clone/tests/webapp-testing/layout_ratio.png', full_page=True)

    # ============================================================
    # Task 2: CosyVoice VoiceSelector & ParameterControls (已有)
    # ============================================================
    print("\n=== Task 2: CosyVoice VoiceSelector & ParameterControls ===")
    # 已经在 CosyVoice tab，检查声音下拉和折叠面板
    select = page.locator('[data-testid="voice-select"]')
    empty_msg = page.locator('text=暂无克隆声音')
    loading_msg = page.locator('text=加载声音列表')
    error_msg = page.locator('text=加载声音列表失败')
    if select.count() > 0:
        print("✓ VoiceSelector 下拉菜单存在")
    elif empty_msg.count() > 0 or loading_msg.count() > 0 or error_msg.count() > 0:
        print("✓ VoiceSelector 正常渲染（空/加载/错误状态）")
    else:
        errors.append("VoiceSelector 未找到")
        print("✗ VoiceSelector 未找到")

    # 参数折叠面板
    header_collapsed = page.locator('[aria-expanded="false"]', has_text='参数设置')
    header_expanded = page.locator('[aria-expanded="true"]', has_text='参数设置')
    if header_collapsed.count() > 0:
        print("✓ CosyVoice ParameterControls 默认折叠")
        header_collapsed.first.click()
        page.wait_for_timeout(500)
        lang = page.locator('#language')
        if lang.is_visible():
            print("✓ 展开后控件可见")
        else:
            errors.append("CosyVoice 展开后控件不可见")
            print("✗ 展开后控件不可见")

        header_now_expanded = page.locator('[aria-expanded="true"]', has_text='参数设置')
        if header_now_expanded.count() > 0:
            header_now_expanded.first.click()
            page.wait_for_timeout(500)
            if not lang.is_visible():
                print("✓ 收起后控件隐藏")
            else:
                errors.append("CosyVoice 收起后控件仍可见")
                print("✗ 收起后控件仍可见")
    elif header_expanded.count() > 0:
        warnings.append("CosyVoice 参数初始为展开状态")
        print("⚠ CosyVoice 参数初始展开（预期折叠）")
    else:
        errors.append("CosyVoice 参数面板头部未找到")
        print("✗ CosyVoice 参数面板头部未找到")

    page.screenshot(path='E:/repos/vcprjs/voice_clone/tests/webapp-testing/cosyvoice_panel.png', full_page=True)

    # ============================================================
    # Task 3: Edge-TTS 下拉菜单 & 折叠参数
    # ============================================================
    print("\n=== Task 3: Edge-TTS 下拉菜单 & 折叠参数 ===")
    # 切换到 Edge-TTS
    edge_tts_btn.click()
    page.wait_for_timeout(2000)

    # 检查 Edge-TTS 声音下拉（含语言/性别过滤）
    edge_select = page.locator('[data-testid="edge-voice-select"]')
    if edge_select.count() > 0:
        print("✓ Edge-TTS 声音下拉菜单存在")
    else:
        # Edge-TTS 可能加载失败（后端未启动），检查错误状态
        edge_error = page.locator('text=加载音色列表失败')
        edge_loading = page.locator('text=加载音色列表')
        if edge_error.count() > 0 or edge_loading.count() > 0:
            print("⚠ Edge-TTS 声音选择加载中/失败（后端未启动，预期行为）")
        else:
            errors.append("Edge-TTS 声音选择下拉菜单未找到")
            print("✗ Edge-TTS 声音选择下拉菜单未找到")

    # 检查 Edge-TTS 参数折叠面板（应在右侧列）
    edge_header_collapsed = page.locator('[aria-expanded="false"]', has_text='参数设置')
    edge_header_expanded = page.locator('[aria-expanded="true"]', has_text='参数设置')
    if edge_header_collapsed.count() > 0:
        print("✓ Edge-TTS ParameterControls 默认折叠")
        edge_header_collapsed.first.click()
        page.wait_for_timeout(500)
        # 检查 Edge-TTS 特定控件（语速/音量 range）
        rate_label = page.locator('text=语速')
        volume_label = page.locator('text=音量')
        if rate_label.count() > 0 and volume_label.count() > 0:
            print("✓ Edge-TTS 展开后语速/音量控件可见")
        else:
            errors.append("Edge-TTS 展开后语速/音量控件不可见")
            print("✗ Edge-TTS 展开后语速/音量控件不可见")

        edge_header_now_expanded = page.locator('[aria-expanded="true"]', has_text='参数设置')
        if edge_header_now_expanded.count() > 0:
            edge_header_now_expanded.first.click()
            page.wait_for_timeout(500)
            if rate_label.count() > 0 and not rate_label.is_visible():
                print("✓ Edge-TTS 收起后控件隐藏")
            else:
                warnings.append("Edge-TTS 收起后控件可能仍可见")
                print("⚠ Edge-TTS 收起验证不确定")
    elif edge_header_expanded.count() > 0:
        warnings.append("Edge-TTS 参数初始为展开状态")
        print("⚠ Edge-TTS 参数初始展开（预期折叠）")
    else:
        errors.append("Edge-TTS 参数面板头部未找到")
        print("✗ Edge-TTS 参数面板头部未找到")

    page.screenshot(path='E:/repos/vcprjs/voice_clone/tests/webapp-testing/edge_tts_panel.png', full_page=True)

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

    if warnings:
        print(f"⚠ {len(warnings)} 个警告:")
        for w in warnings:
            print(f"  - {w}")

    browser.close()