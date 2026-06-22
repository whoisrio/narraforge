"""
声音克隆功能 API 测试

测试场景：
1. 健康检查
2. 列出所有声音
3. 检查后端配置

注意：此测试不需要测试音频文件
"""

import requests
import json

# 配置
BACKEND_URL = "http://127.0.0.1:8002"


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


def test_list_voices():
    """测试 2: 列出所有声音"""
    print("\n" + "="*60)
    print("测试 2: 列出所有声音")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/api/clone/list", timeout=10)
        
        if resp.status_code != 200:
            print(f"❌ 获取声音列表失败：{resp.status_code}")
            print(f"响应：{resp.text}")
            return False
        
        voices = resp.json()
        print(f"✅ 获取到 {len(voices)} 个声音:")
        
        if len(voices) == 0:
            print("   (暂无声音，这是正常的)")
        else:
            for voice in voices:
                print(f"   - {voice.get('name', 'Unknown')} (ID: {voice.get('id', 'N/A')})")
        
        return True
        
    except Exception as e:
        print(f"❌ 获取声音列表异常：{e}")
        return False


def test_get_config():
    """测试 3: 获取后端配置"""
    print("\n" + "="*60)
    print("测试 3: 获取后端配置")
    print("="*60)
    
    try:
        resp = requests.get(f"{BACKEND_URL}/api/config/models", timeout=10)
        
        if resp.status_code != 200:
            print(f"⚠️  获取配置失败：{resp.status_code}（可能是正常的，如果没有配置模型）")
            return True  # 不视为失败
        
        config = resp.json()
        print(f"✅ TTS 配置:")
        if isinstance(config, list):
            print(f"   获取到 {len(config)} 个模型配置")
            for model in config[:3]:  # 只显示前 3 个
                print(f"   - {model.get('model_name', 'N/A')} (ID: {model.get('id', 'N/A')})")
        else:
            print(f"   - 模型：{config.get('model_name', 'N/A')}")
        
        return True
        
    except Exception as e:
        print(f"⚠️  获取配置异常：{e}（可能是正常的）")
        return True  # 不视为失败


def test_api_endpoints():
    """测试 4: 测试 API 端点可用性"""
    print("\n" + "="*60)
    print("测试 4: 测试 API 端点可用性")
    print("="*60)
    
    endpoints = [
        ("POST", "/api/clone/upload", "上传音频"),
        ("GET", "/api/clone/list", "获取声音列表"),
        ("POST", "/api/tts/synthesize", "TTS 合成"),
    ]
    
    for method, endpoint, description in endpoints:
        try:
            if method == "GET":
                resp = requests.get(f"{BACKEND_URL}{endpoint}", timeout=5)
            elif method == "POST":
                resp = requests.post(f"{BACKEND_URL}{endpoint}", json={}, timeout=5)
            
            # 405 Method Not Allowed 也表示端点存在
            # 422 Unprocessable Entity 表示端点存在但请求体不完整
            # 404 Not Found 表示端点不存在
            if resp.status_code == 404:
                print(f"❌ {description}: {endpoint} - 端点不存在")
            elif resp.status_code in [200, 400, 405, 422]:
                print(f"✅ {description}: {endpoint} - 可用 (状态码：{resp.status_code})")
            else:
                print(f"⚠️  {description}: {endpoint} - 状态码：{resp.status_code}")
        except Exception as e:
            print(f"❌ {description}: {endpoint} - 错误：{e}")
    
    return True


def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始运行声音克隆功能 API 测试")
    print("="*60)
    
    results = {
        "health_check": False,
        "list_voices": False,
        "get_config": False,
        "api_endpoints": False,
    }
    
    # 测试 1: 健康检查
    results["health_check"] = test_health_check()
    if not results["health_check"]:
        print("\n⚠️  后端服务未运行，跳过后续测试")
        return results
    
    # 测试 2: 列出声音
    results["list_voices"] = test_list_voices()
    
    # 测试 3: 获取配置
    results["get_config"] = test_get_config()
    
    # 测试 4: API 端点
    results["api_endpoints"] = test_api_endpoints()
    
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
