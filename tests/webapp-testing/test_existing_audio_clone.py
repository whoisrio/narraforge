"""
使用现有音频文件测试声音克隆功能

直接使用数据库中已有的音频文件进行克隆测试
"""

import requests
import time
import os

# 配置
BACKEND_URL = "http://127.0.0.1:8002"

# 数据库中已有的音频文件路径（已转换为 MP3）
EXISTING_AUDIO_PATHS = [
    "E:\\repos\\vcprjs\\voice_clone\\backend\\uploads\\voices\\0841505e-e09e-4afb-8df0-60c4d5c8bbb7.mp3",
    "E:\\repos\\vcprjs\\voice_clone\\backend\\uploads\\voices\\7c510592-b9cd-4660-ab1c-66787de3be7a.mp3",
]

# 对应的数据库 ID
EXISTING_VOICE_IDS = [
    "0841505e-e09e-4afb-8df0-60c4d5c8bbb7",
    "7c510592-b9cd-4660-ab1c-66787de3be7a",
]


def check_audio_files():
    """检查音频文件是否存在"""
    print("\n" + "="*60)
    print("检查现有音频文件")
    print("="*60)
    
    for i, path in enumerate(EXISTING_AUDIO_PATHS):
        exists = os.path.exists(path)
        status = "✅" if exists else "❌"
        print(f"{status} {EXISTING_VOICE_IDS[i]}: {path}")
        
        if exists:
            file_size = os.path.getsize(path)
            print(f"   文件大小：{file_size} bytes")
    
    return all(os.path.exists(p) for p in EXISTING_AUDIO_PATHS)


def test_clone_existing_voice(voice_id: str, voice_name: str):
    """测试克隆已有的声音"""
    print("\n" + "="*60)
    print(f"测试克隆声音：{voice_name}")
    print("="*60)
    
    try:
        payload = {
            "voice_id": voice_id,
            "name": voice_name,
            "role": "custom"
        }
        
        print(f"请求 payload: {payload}")
        print(f"API URL: {BACKEND_URL}/api/clone/create-clone")
        
        resp = requests.post(
            f"{BACKEND_URL}/api/clone/create-clone",
            json=payload,
            timeout=120  # 克隆可能需要较长时间
        )
        
        print(f"\n响应状态码：{resp.status_code}")
        print(f"响应内容：{resp.text[:500]}")
        
        if resp.status_code != 200:
            print(f"\n❌ 克隆失败：{resp.status_code}")
            return None
        
        result = resp.json()
        qwen_voice_id = result.get("qwen_voice_id")
        
        print(f"\n✅ 克隆成功")
        print(f"   本地 ID: {result.get('id')}")
        print(f"   声音名称：{result.get('name')}")
        print(f"   Qwen Voice ID: {qwen_voice_id}")
        print(f"   角色：{result.get('role')}")
        print(f"   已克隆：{result.get('is_cloned')}")
        
        return qwen_voice_id
        
    except Exception as e:
        print(f"❌ 克隆异常：{e}")
        import traceback
        traceback.print_exc()
        return None


def verify_clone(voice_id: str):
    """验证克隆结果"""
    print("\n" + "="*60)
    print(f"验证克隆结果：{voice_id}")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/api/clone/list", timeout=10)
        
        if resp.status_code != 200:
            print(f"❌ 获取声音列表失败")
            return False
        
        voices = resp.json()
        
        for voice in voices:
            if voice.get("id") == voice_id:
                qwen_voice_id = voice.get("qwen_voice_id")
                is_cloned = voice.get("is_cloned")
                
                if qwen_voice_id and is_cloned:
                    print(f"✅ 验证成功")
                    print(f"   qwen_voice_id: {qwen_voice_id}")
                    print(f"   is_cloned: {is_cloned}")
                    return True
                else:
                    print(f"❌ 验证失败")
                    print(f"   qwen_voice_id: {qwen_voice_id or 'None'}")
                    print(f"   is_cloned: {is_cloned}")
                    return False
        
        print(f"❌ 未找到声音 ID: {voice_id}")
        return False
        
    except Exception as e:
        print(f"❌ 验证异常：{e}")
        return False


def test_tts(qwen_voice_id: str):
    """使用克隆的声音进行 TTS 合成"""
    print("\n" + "="*60)
    print(f"测试 TTS 合成：{qwen_voice_id}")
    print("="*60)
    
    if not qwen_voice_id:
        print("⚠️  没有 Qwen Voice ID，跳过测试")
        return True
    
    try:
        payload = {
            "text": "这是使用克隆声音合成的语音测试。",
            "voice_id": qwen_voice_id,
            "speed": 1.0,
            "volume": 80,
            "pitch": 0
        }
        
        resp = requests.post(
            f"{BACKEND_URL}/api/tts/synthesize",
            json=payload,
            timeout=60
        )
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ TTS 合成失败：{resp.status_code}")
            print(f"响应：{resp.text[:300]}")
            return False
        
        # 保存音频文件
        import tempfile
        from pathlib import Path
        output_path = Path(tempfile.gettempdir()) / f"test_cloned_tts_{qwen_voice_id}.mp3"
        
        with open(output_path, "wb") as f:
            f.write(resp.content)
        
        file_size = len(resp.content)
        print(f"✅ TTS 合成成功")
        print(f"   音频大小：{file_size} bytes")
        print(f"   保存位置：{output_path}")
        
        return True
        
    except Exception as e:
        print(f"❌ TTS 合成异常：{e}")
        import traceback
        traceback.print_exc()
        return False


def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始运行现有音频文件的声音克隆测试")
    print("="*60)
    
    results = {
        "check_files": False,
        "clone": False,
        "verify": False,
        "tts": False,
    }
    
    # 检查文件
    results["check_files"] = check_audio_files()
    
    if not results["check_files"]:
        print("\n⚠️  音频文件不存在，跳过后续测试")
        return results
    
    # 测试克隆第一个声音
    voice_id = EXISTING_VOICE_IDS[0]
    voice_name = f"test_clone_{int(time.time())}"
    
    qwen_voice_id = test_clone_existing_voice(voice_id, voice_name)
    results["clone"] = bool(qwen_voice_id)
    
    if not results["clone"]:
        print("\n⚠️  克隆失败，但继续验证数据库状态")
    
    time.sleep(2)
    
    # 验证克隆结果
    results["verify"] = verify_clone(voice_id)
    
    time.sleep(1)
    
    # TTS 合成
    results["tts"] = test_tts(qwen_voice_id)
    
    return results


def print_summary(results: dict):
    """打印测试摘要"""
    print("\n" + "="*60)
    print("📊 测试摘要")
    print("="*60)
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    for test_name, result in results.items():
        status = "✅" if result else "❌"
        print(f"{status} {test_name}: {'PASS' if result else 'FAIL'}")
    
    print(f"\n总计：{passed}/{total} 测试通过")
    
    if passed == total:
        print("🎉 所有测试通过！声音克隆功能完全正常！")
    else:
        print("⚠️  部分测试失败，请检查日志")
        
        if not results["clone"]:
            print("\n💡 可能的问题:")
            print("   1. PUBLIC_BASE_URL 未配置（CosyVoice 需要公网 URL）")
            print("   2. QWEN_API_KEY 无效")
            print("   3. Qwen API 服务不可用")
            print("   4. 音频格式不支持")
            print("\n📝 解决方案:")
            print("   1. 在 backend/.env 中配置 PUBLIC_BASE_URL")
            print("      - 使用 ngrok: PUBLIC_BASE_URL=https://xxxx.ngrok.io")
            print("      - 或使用实际域名：PUBLIC_BASE_URL=https://your-domain.com")
            print("   2. 重启后端服务")
            print("   3. 检查后端日志：backend/logs/app.log")


if __name__ == "__main__":
    results = run_all_tests()
    print_summary(results)
