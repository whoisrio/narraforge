"""
直接使用外部 URL 测试 Qwen 声音克隆 API
"""
import requests
import json

BACKEND_URL = "http://127.0.0.1:8002"

# 七牛云音频 URL
AUDIO_URL = "http://tcafk9npq.hd-bkt.clouddn.com/0841505e-e09e-4afb-8df0-60c4d5c8bbb7.mp3?e=1774161913&token=_bvmGYH-r6Q4zotTM5YHlZ-2FUSOtadbXYjBO092:WZCrDIOuBD1myIccDV_wZoz7s4A="

def test_direct_clone():
    """直接使用 URL 进行声音克隆测试"""
    print("\n" + "="*60)
    print("直接 URL 声音克隆测试")
    print("="*60)
    print(f"\n音频 URL: {AUDIO_URL}")
    
    # 步骤 1: 从 URL 上传
    print("\n步骤 1: 从 URL 上传音频文件...")
    try:
        upload_payload = {
            "audio_url": AUDIO_URL,
            "name": "qiniu_voice_test",
            "role": "custom"
        }
        
        upload_resp = requests.post(
            f"{BACKEND_URL}/api/clone/upload-from-url",
            json=upload_payload,
            timeout=60
        )
        
        print(f"上传响应状态码：{upload_resp.status_code}")
        
        if upload_resp.status_code != 200:
            print(f"[ERROR] 上传失败：{upload_resp.status_code}")
            print(f"响应：{upload_resp.text[:500]}")
            return None
        
        upload_result = upload_resp.json()
        voice_id = upload_result.get("id")
        
        print(f"[SUCCESS] 上传成功")
        print(f"   ID: {voice_id}")
        print(f"   Name: {upload_result.get('name')}")
        print(f"   Audio URL: {upload_result.get('audio_url')}")
        print(f"   External URL: {upload_result.get('external_audio_url')}")
        
        return voice_id
        
    except Exception as e:
        print(f"[ERROR] 上传异常：{e}")
        import traceback
        traceback.print_exc()
        return None

def test_create_clone(voice_id):
    """创建声音克隆"""
    if not voice_id:
        return
    
    print("\n" + "="*60)
    print("步骤 2: 创建声音克隆")
    print("="*60)
    
    try:
        clone_payload = {
            "voice_id": voice_id,
            "name": "cloned_qiniu_voice",
            "role": "custom"
        }
        
        clone_resp = requests.post(
            f"{BACKEND_URL}/api/clone/create-clone",
            json=clone_payload,
            timeout=120
        )
        
        print(f"克隆响应状态码：{clone_resp.status_code}")
        
        if clone_resp.status_code != 200:
            print(f"[ERROR] 克隆失败：{clone_resp.status_code}")
            print(f"响应：{clone_resp.text[:500]}")
            return None
        
        clone_result = clone_resp.json()
        qwen_voice_id = clone_result.get("qwen_voice_id")
        
        print(f"[SUCCESS] 克隆成功")
        print(f"   本地 ID: {clone_result.get('id')}")
        print(f"   声音名称：{clone_result.get('name')}")
        print(f"   Qwen Voice ID: {qwen_voice_id}")
        print(f"   Is Cloned: {clone_result.get('is_cloned')}")
        
        return clone_result
        
    except Exception as e:
        print(f"[ERROR] 克隆异常：{e}")
        import traceback
        traceback.print_exc()
        return None

def test_tts_with_cloned_voice(qwen_voice_id):
    """使用克隆的声音进行 TTS 测试"""
    if not qwen_voice_id:
        return
    
    print("\n" + "="*60)
    print("步骤 3: 使用克隆声音进行 TTS 合成")
    print("="*60)
    
    try:
        tts_payload = {
            "text": "你好，这是使用克隆声音的测试。",
            "voice_id": qwen_voice_id,
            "speed": 1.0,
            "volume": 80,
            "pitch": 0
        }
        
        tts_resp = requests.post(
            f"{BACKEND_URL}/api/tts/synthesize",
            json=tts_payload,
            timeout=60
        )
        
        print(f"TTS 响应状态码：{tts_resp.status_code}")
        
        if tts_resp.status_code != 200:
            print(f"[ERROR] TTS 失败：{tts_resp.status_code}")
            print(f"响应：{tts_resp.text[:500]}")
            return
        
        tts_result = tts_resp.json()
        print(f"[SUCCESS] TTS 成功")
        print(f"   Audio ID: {tts_result.get('audio_id')}")
        print(f"   Audio URL: {tts_result.get('audio_url')}")
        
    except Exception as e:
        print(f"[ERROR] TTS 异常：{e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # 检查后端服务
    print("检查后端服务...")
    try:
        health_resp = requests.get(f"{BACKEND_URL}/health", timeout=5)
        if health_resp.status_code == 200:
            print(f"[SUCCESS] 后端服务正常运行")
        else:
            print(f"[WARNING] 后端服务响应异常：{health_resp.status_code}")
    except Exception as e:
        print(f"[ERROR] 后端服务未运行：{e}")
        print("请先启动后端服务：cd backend && .\\.venv\\Scripts\\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8002")
        exit(1)
    
    # 执行测试
    voice_id = test_direct_clone()
    clone_result = test_create_clone(voice_id)
    
    if clone_result:
        qwen_voice_id = clone_result.get("qwen_voice_id")
        test_tts_with_cloned_voice(qwen_voice_id)
    
    print("\n" + "="*60)
    print("测试完成")
    print("="*60)
