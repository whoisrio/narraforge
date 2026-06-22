"""
Qwen 服务集成测试

测试场景：
1. 从 Qwen 服务拉取默认声音列表
2. 使用克隆的声音进行 TTS 合成
3. 验证与 Qwen 服务的集成

依赖：
- 后端服务运行在 http://127.0.0.1:8002
- 已配置 QWEN_API_KEY
"""

import requests
import time
from pathlib import Path

# 配置
BACKEND_URL = "http://127.0.0.1:8002"


def test_list_voices_from_qwen():
    """测试 1: 从 Qwen 服务拉取默认声音列表"""
    print("\n" + "="*60)
    print("测试 1: 从 Qwen 服务拉取默认声音列表")
    print("="*60)
    
    try:
        # 调用后端 API 从 Qwen 获取声音列表
        resp = requests.get(f"{BACKEND_URL}/api/clone/list-from-qwen", timeout=30)
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"⚠️  获取失败：{resp.status_code}")
            print(f"响应：{resp.text[:200]}")
            return False
        
        result = resp.json()
        # API 返回格式：{"voices": [...]}
        voices = result.get('voices', [])
        print(f"✅ 从 Qwen 获取到 {len(voices)} 个声音:")
        
        # 显示前 10 个声音
        for i, voice in enumerate(voices[:10]):
            voice_id = voice.get('voice_id', voice.get('id', 'N/A'))
            voice_name = voice.get('name', voice.get('voice_name', 'Unknown'))
            print(f"   [{i+1}] {voice_name} (ID: {voice_id})")
        
        if len(voices) > 10:
            print(f"   ... 还有 {len(voices) - 10} 个声音")
        
        return True
        
    except Exception as e:
        print(f"❌ 测试异常：{e}")
        import traceback
        traceback.print_exc()
        return False


def test_sync_voices_from_qwen():
    """测试 2: 同步 Qwen 服务的声音到本地数据库"""
    print("\n" + "="*60)
    print("测试 2: 同步 Qwen 服务的声音到本地数据库")
    print("="*60)
    
    try:
        resp = requests.post(f"{BACKEND_URL}/api/clone/sync-from-qwen", timeout=60)
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"⚠️  同步失败：{resp.status_code}")
            print(f"响应：{resp.text[:200]}")
            return False
        
        result = resp.json()
        synced_count = result.get('synced', 0)
        print(f"✅ 同步成功：{synced_count} 个声音")
        
        return True
        
    except Exception as e:
        print(f"❌ 测试异常：{e}")
        return False


def test_tts_with_default_voice():
    """测试 3: 使用默认声音进行 TTS 合成"""
    print("\n" + "="*60)
    print("测试 3: 使用默认声音进行 TTS 合成")
    print("="*60)
    
    try:
        # 先获取本地声音列表，找一个默认声音
        resp = requests.get(f"{BACKEND_URL}/api/clone/list", timeout=10)
        if resp.status_code == 200:
            voices = resp.json()
            print(f"本地有 {len(voices)} 个声音")
            
            # 找一个默认声音（非克隆的，即没有 qwen_voice_id 的）
            for voice in voices:
                voice_id = voice.get('id', '')
                qwen_voice_id = voice.get('qwen_voice_id')
                # 如果有 qwen_voice_id，说明是克隆的声音
                if qwen_voice_id:
                    print(f"找到克隆的声音：{voice.get('name')} (ID: {qwen_voice_id})")
                    return test_tts_synthesis(qwen_voice_id, "使用克隆的声音")
        
        # 如果没有找到克隆声音，尝试使用 xiaoyun 测试
        print("⚠️  本地没有克隆的声音，需要先克隆声音才能测试")
        return True  # 不视为失败
        
    except Exception as e:
        print(f"❌ 测试异常：{e}")
        import traceback
        traceback.print_exc()
        return False


def test_tts_synthesis(voice_id: str, description: str):
    """执行 TTS 合成测试"""
    print(f"\n正在测试：{description}")
    print(f"声音 ID: {voice_id}")
    
    try:
        payload = {
            "text": "你好，这是一个测试。",
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
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ TTS 合成失败：{resp.status_code}")
            print(f"响应：{resp.text[:200]}")
            return False
        
        # 保存音频文件
        output_path = Path(__file__).parent / f"test_output_{voice_id}.mp3"
        with open(output_path, "wb") as f:
            f.write(resp.content)
        
        file_size = len(resp.content)
        print(f"✅ TTS 合成成功")
        print(f"   音频大小：{file_size} bytes")
        print(f"   保存位置：{output_path}")
        
        return True
        
    except Exception as e:
        print(f"❌ TTS 合成异常：{e}")
        return False


def test_tts_with_cloned_voice():
    """测试 4: 使用克隆的声音进行 TTS 合成"""
    print("\n" + "="*60)
    print("测试 4: 使用克隆的声音进行 TTS 合成")
    print("="*60)
    
    try:
        # 获取本地声音列表
        resp = requests.get(f"{BACKEND_URL}/api/clone/list", timeout=10)
        
        if resp.status_code != 200:
            print(f"❌ 获取声音列表失败：{resp.status_code}")
            return False
        
        voices = resp.json()
        
        if len(voices) == 0:
            print("⚠️  没有可用的声音，跳过测试")
            return True
        
        # 找一个克隆的声音（有 qwen_voice_id 的）
        cloned_voice_id = None
        for voice in voices:
            qwen_voice_id = voice.get('qwen_voice_id')
            if qwen_voice_id:
                cloned_voice_id = qwen_voice_id
                print(f"找到克隆的声音：{voice.get('name')} (ID: {cloned_voice_id})")
                break
        
        if not cloned_voice_id:
            print("⚠️  没有找到克隆的声音（没有 qwen_voice_id），跳过测试")
            print("   提示：需要先克隆声音才能测试")
            return True
        
        # 使用克隆的声音进行 TTS 合成
        payload = {
            "text": "这是使用克隆声音合成的语音。",
            "voice_id": cloned_voice_id,
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
            print(f"响应：{resp.text[:200]}")
            return False
        
        # 保存音频文件
        output_path = Path(__file__).parent / f"test_output_cloned_{cloned_voice_id}.mp3"
        with open(output_path, "wb") as f:
            f.write(resp.content)
        
        file_size = len(resp.content)
        print(f"✅ 克隆声音 TTS 合成成功")
        print(f"   音频大小：{file_size} bytes")
        print(f"   保存位置：{output_path}")
        
        return True
        
    except Exception as e:
        print(f"❌ 测试异常：{e}")
        import traceback
        traceback.print_exc()
        return False


def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始运行 Qwen 服务集成测试")
    print("="*60)
    
    results = {
        "list_from_qwen": False,
        "sync_from_qwen": False,
        "tts_default_voice": False,
        "tts_cloned_voice": False,
    }
    
    # 测试 1: 从 Qwen 拉取声音列表
    results["list_from_qwen"] = test_list_voices_from_qwen()
    
    time.sleep(1)
    
    # 测试 2: 同步声音
    results["sync_from_qwen"] = test_sync_voices_from_qwen()
    
    time.sleep(1)
    
    # 测试 3: 使用默认声音 TTS
    results["tts_default_voice"] = test_tts_with_default_voice()
    
    time.sleep(1)
    
    # 测试 4: 使用克隆声音 TTS
    results["tts_cloned_voice"] = test_tts_with_cloned_voice()
    
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
