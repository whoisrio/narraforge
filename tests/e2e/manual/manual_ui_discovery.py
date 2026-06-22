"""
UI Element Discovery Script
Run: python tests/e2e/test_ui_discovery.py
"""
from playwright.sync_api import sync_playwright
import os

output_dir = r"E:\repos\vcprjs\voice_clone\tests\e2e"
os.makedirs(output_dir, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_viewport_size({"width": 1280, "height": 800})

    print("Navigating to frontend...")
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    # Take screenshot
    page.screenshot(path=os.path.join(output_dir, "screenshot.png"), full_page=True)
    print("Screenshot saved to tests/e2e/screenshot.png")

    # Find all buttons
    buttons = page.locator('button').all()
    print(f"\nFound {len(buttons)} buttons:")
    for i, btn in enumerate(buttons):
        try:
            text = btn.text_content().strip()[:50]
            print(f"  {i+1}. <button> {text}")
        except:
            pass

    # Find all links
    links = page.locator('a').all()
    print(f"\nFound {len(links)} links:")
    for i, link in enumerate(links):
        try:
            text = link.text_content().strip()[:50]
            print(f"  {i+1}. <a> {text}")
        except:
            pass

    # Find all inputs
    inputs = page.locator('input').all()
    print(f"\nFound {len(inputs)} inputs:")
    for i, inp in enumerate(inputs):
        try:
            placeholder = inp.get_attribute('placeholder') or ''
            print(f"  {i+1}. <input> placeholder='{placeholder}'")
        except:
            pass

    # Find all textareas
    textareas = page.locator('textarea').all()
    print(f"\nFound {len(textareas)} textareas:")
    for i, ta in enumerate(textareas):
        try:
            placeholder = ta.get_attribute('placeholder') or ''
            print(f"  {i+1}. <textarea> placeholder='{placeholder}'")
        except:
            pass

    browser.close()
    print("\nDone!")