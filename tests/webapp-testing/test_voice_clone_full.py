"""
声音克隆功能完整测试

测试场景：
1. 上传音频文件
2. 调用克隆 API 将声音注册到 Qwen 服务器
3. 验证数据库中 qwen_voice_id 已设置
4. 使用克隆的声音进行 TTS 合成

依赖：
- 后端服务运行在 http://127.0.0.1:8002
- 需要一个实际的音频文件
"""

import requests
import time
from pathlib import Path

# 配置
BACKEND_URL = "http://127.0.0.1:8002"
TEST_AUDIO_PATH = Path(__file__).parent / "test_audio.mp3"


def find_test_audio():
    """查找测试音频文件"""
    # 首先检查指定路径
    if TEST_AUDIO_PATH.exists():
        return TEST_AUDIO_PATH
    
    # 检查当前目录
    for pattern in ["*.mp3", "*.wav", "*.webm"]:
        for file in Path(__file__).parent.glob(pattern):
            print(f"找到测试音频：{file}")
            return file
    
    # 检查 backend/uploads 目录
    uploads_dir = Path(__file__).parent.parent.parent / "backend" / "uploads"
    if uploads_dir.exists():
        for file in uploads_dir.glob("*.mp3"):
            print(f"找到上传的音频：{file}")
            return file
    
    return None


def test_upload_audio():
    """测试 1: 上传音频文件"""
    print("\n" + "="*60)
    print("测试 1: 上传音频文件")
    print("="*60)
    
    audio_file = find_test_audio()
    if not audio_file:
        print("❌ 未找到测试音频文件")
        print("   请在 tests/webapp-testing 目录下放置一个音频文件")
        return None
    
    print(f"使用音频文件：{audio_file}")
    
    try:
        with open(audio_file, "rb") as f:
            files = {"file": (audio_file.name, f, "audio/mpeg")}
            resp = requests.post(f"{BACKEND_URL}/api/clone/upload", files=files, timeout=30)
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ 上传失败：{resp.status_code}")
            print(f"响应：{resp.text[:200]}")
            return None
        
        result = resp.json()
        voice_id = result.get("id")
        print(f"✅ 上传成功")
        print(f"   声音 ID: {voice_id}")
        print(f"   文件名：{result.get('filename')}")
        print(f"   文件路径：{result.get('filepath')}")
        
        return voice_id
        
    except Exception as e:
        print(f"❌ 上传异常：{e}")
        return None


def test_clone_voice(voice_id: str):
    """测试 2: 克隆声音到 Qwen 服务器"""
    print("\n" + "="*60)
    print("测试 2: 克隆声音到 Qwen 服务器")
    print("="*60)
    
    if not voice_id:
        print("❌ 没有有效的声音 ID")
        return None
    
    try:
        payload = {
            "voice_id": voice_id,
            "name": f"test_clone_{int(time.time())}",
            "role": "custom"
        }
        
        resp = requests.post(
            f"{BACKEND_URL}/api/clone/create-clone",
            json=payload,
            timeout=120  # 克隆可能需要较长时间
        )
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ 克隆失败：{resp.status_code}")
            print(f"响应：{resp.text[:300]}")
            return None
        
        result = resp.json()
        qwen_voice_id = result.get("qwen_voice_id")
        
        print(f"✅ 克隆成功")
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


def test_verify_clone(voice_id: str):
    """测试 3: 验证克隆结果"""
    print("\n" + "="*60)
    print("测试 3: 验证克隆结果")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/api/clone/list", timeout=10)
        
        if resp.status_code != 200:
            print(f"❌ 获取声音列表失败")
            return False
        
        voices = resp.json()
        
        # 查找我们的声音
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


def test_tts_with_cloned_voice(qwen_voice_id: str):
    """测试 4: 使用克隆的声音进行 TTS 合成"""
    print("\n" + "="*60)
    print("测试 4: 使用克隆的声音进行 TTS 合成")
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
        output_path = Path(__file__).parent / f"test_cloned_tts_output.mp3"
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
    print("🚀 开始运行声音克隆完整功能测试")
    print("="*60)
    
    results = {
        "upload": False,
        "clone": False,
        "verify": False,
        "tts": False,
    }
    
    # 测试 1: 上传音频
    voice_id = test_upload_audio()
    results["upload"] = bool(voice_id)
    
    if not results["upload"]:
        print("\n⚠️  上传失败，跳过后续测试")
        return results
    
    time.sleep(1)
    
    # 测试 2: 克隆声音
    qwen_voice_id = test_clone_voice(voice_id)
    results["clone"] = bool(qwen_voice_id)
    
    if not results["clone"]:
        print("\n⚠️  克隆失败，但继续验证数据库状态")
    
    time.sleep(1)
    
    # 测试 3: 验证克隆结果
    results["verify"] = test_verify_clone(voice_id)
    
    time.sleep(1)
    
    # 测试 4: TTS 合成
    results["tts"] = test_tts_with_cloned_voice(qwen_voice_id)
    
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
            print("\n💡 建议:")
            print("   1. 检查 QWEN_API_KEY 是否正确配置")
            print("   2. 检查后端日志：backend/logs/app.log")
            print("   3. 确认音频格式是否为 MP3/WAV/OGG")


if __name__ == "__main__":
    results = run_all_tests()
    print_summary(results)
