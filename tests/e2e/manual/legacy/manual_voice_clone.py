"""
声音克隆功能端到端测试

测试场景：
1. 上传音频文件
2. 克隆声音
3. 验证克隆成功
4. 使用克隆的声音进行 TTS 合成

依赖：
- 后端服务运行在 http://127.0.0.1:8002
- 前端服务运行在 http://localhost:5173
"""

import requests
import os
import time
import base64
from pathlib import Path

# 配置
BACKEND_URL = "http://127.0.0.1:8002"
TEST_AUDIO_PATH = Path(__file__).parent / "test_audio.mp3"


def create_test_audio():
    """创建测试音频文件（如果不存在）"""
    if not TEST_AUDIO_PATH.exists():
        # 创建一个简单的测试音频（实际应该使用真实音频文件）
        print(f"⚠️  测试音频不存在：{TEST_AUDIO_PATH}")
        print("   请准备一个 MP3 格式的测试音频文件")
        return False
    return True


def test_health_check():
    """测试 1: 健康检查"""
    print("\n" + "="*60)
    print("测试 1: 健康检查")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/health", timeout=5)
        assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
        print(f"✅ 健康检查通过：{resp.json()}")
        return True
    except Exception as e:
        print(f"❌ 健康检查失败：{e}")
        return False


def test_upload_audio():
    """测试 2: 上传音频文件"""
    print("\n" + "="*60)
    print("测试 2: 上传音频文件")
    print("="*60)
    
    if not create_test_audio():
        return False
    
    try:
        # 上传音频
        with open(TEST_AUDIO_PATH, "rb") as f:
            files = {"file": ("test_audio.mp3", f, "audio/mpeg")}
            resp = requests.post(f"{BACKEND_URL}/api/clone/upload", files=files, timeout=30)
        
        print(f"上传响应状态码：{resp.status_code}")
        print(f"上传响应：{resp.json()}")
        
        if resp.status_code != 200:
            print(f"❌ 上传失败：{resp.status_code}")
            print(f"错误信息：{resp.text}")
            return False
        
        data = resp.json()
        voice_id = data.get("voice_id")
        assert voice_id, "Response missing voice_id"
        
        print(f"✅ 上传成功，voice_id: {voice_id}")
        return voice_id
        
    except Exception as e:
        print(f"❌ 上传异常：{e}")
        return False


def test_clone_voice(voice_id: str):
    """测试 3: 克隆声音"""
    print("\n" + "="*60)
    print("测试 3: 克隆声音")
    print("="*60)
    
    try:
        # 克隆声音
        payload = {
            "voice_name": "test_voice_clone"
        }
        resp = requests.post(
            f"{BACKEND_URL}/api/clone/{voice_id}/register",
            json=payload,
            timeout=60
        )
        
        print(f"克隆响应状态码：{resp.status_code}")
        print(f"克隆响应：{resp.json()}")
        
        if resp.status_code != 200:
            print(f"❌ 克隆失败：{resp.status_code}")
            print(f"错误信息：{resp.text}")
            return False
        
        data = resp.json()
        cloned_voice_id = data.get("voice_id")
        
        if not cloned_voice_id:
            print(f"❌ 克隆成功但未返回 voice_id")
            return False
        
        print(f"✅ 克隆成功，cloned_voice_id: {cloned_voice_id}")
        return cloned_voice_id
        
    except Exception as e:
        print(f"❌ 克隆异常：{e}")
        return False


def test_tts_with_cloned_voice(voice_id: str):
    """测试 4: 使用克隆的声音进行 TTS 合成"""
    print("\n" + "="*60)
    print("测试 4: 使用克隆的声音进行 TTS 合成")
    print("="*60)
    
    try:
        # TTS 合成
        payload = {
            "text": "Hello, this is a test of voice cloning.",
            "voice_id": voice_id,
            "speed": 1.0,
            "volume": 80,
            "pitch": 0
        }
        resp = requests.post(
            f"{BACKEND_URL}/api/tts/synthesize",
            json=payload,
            timeout=60
        )
        
        print(f"TTS 响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ TTS 合成失败：{resp.status_code}")
            print(f"错误信息：{resp.text}")
            return False
        
        # 保存音频文件
        output_path = Path(__file__).parent / "test_output.mp3"
        with open(output_path, "wb") as f:
            f.write(resp.content)
        
        print(f"✅ TTS 合成成功，音频保存到：{output_path}")
        return True
        
    except Exception as e:
        print(f"❌ TTS 合成异常：{e}")
        return False


def test_list_voices():
    """测试 5: 列出所有声音"""
    print("\n" + "="*60)
    print("测试 5: 列出所有声音")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/api/clone/voices", timeout=10)
        
        if resp.status_code != 200:
            print(f"❌ 获取声音列表失败：{resp.status_code}")
            return False
        
        voices = resp.json()
        print(f"✅ 获取到 {len(voices)} 个声音:")
        for voice in voices:
            print(f"   - {voice.get('name')} (ID: {voice.get('id')})")
        
        return True
        
    except Exception as e:
        print(f"❌ 获取声音列表异常：{e}")
        return False


def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始运行声音克隆功能测试")
    print("="*60)
    
    results = {
        "health_check": False,
        "upload": False,
        "clone": False,
        "tts": False,
        "list_voices": False,
    }
    
    # 测试 1: 健康检查
    results["health_check"] = test_health_check()
    if not results["health_check"]:
        print("\n⚠️  后端服务未运行，跳过后续测试")
        return results
    
    # 测试 2: 上传音频
    voice_id = test_upload_audio()
    results["upload"] = bool(voice_id)
    
    if not results["upload"]:
        print("\n⚠️  上传失败，跳过后续测试")
        return results
    
    time.sleep(1)
    
    # 测试 3: 克隆声音
    cloned_voice_id = test_clone_voice(voice_id)
    results["clone"] = bool(cloned_voice_id)
    
    if not results["clone"]:
        print("\n⚠️  克隆失败，跳过后续测试")
        return results
    
    time.sleep(1)
    
    # 测试 4: TTS 合成
    results["tts"] = test_tts_with_cloned_voice(cloned_voice_id)
    
    # 测试 5: 列出声音
    results["list_voices"] = test_list_voices()
    
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
        print("🎉 所有测试通过！")
    else:
        print("⚠️  部分测试失败，请检查日志")


if __name__ == "__main__":
    results = run_all_tests()
    print_summary(results)
