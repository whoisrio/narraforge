"""
使用指定音频 URL 测试声音克隆功能
"""
import requests
import json
import os

BACKEND_URL = "http://127.0.0.1:8002"

# 音频 URL
AUDIO_URL = "http://tcafk9npq.hd-bkt.clouddn.com/0841505e-e09e-4afb-8df0-60c4d5c8bbb7.mp3?e=1774161913&token=_bvmGYH-r6Q4zotTM5YHlZ-2FUSOtadbXYjBO092:WZCrDIOuBD1myIccDV_wZoz7s4A="

def test_clone_with_url():
    """测试使用外部音频 URL 进行声音克隆 - 使用新的 /upload-from-url 接口"""
    print("\n" + "="*60)
    print("声音克隆测试 - 使用外部音频 URL")
    print("="*60)
    print(f"\n音频 URL: {AUDIO_URL}")
    
    # 步骤 1: 使用新接口直接从 URL 上传
    print("\n步骤 1: 从 URL 上传音频文件...")
    try:
        upload_payload = {
            "audio_url": AUDIO_URL,
            "name": "test_voice_from_url",
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
            print(f"响应：{upload_resp.text[:300]}")
            return
        
        upload_result = upload_resp.json()
        voice_id = upload_result.get("id")
        
        print(f"[SUCCESS] 上传成功")
        print(f"   ID: {voice_id}")
        print(f"   Name: {upload_result.get('name')}")
        print(f"   Audio URL: {upload_result.get('audio_url')}")
        print(f"   External URL: {upload_result.get('external_audio_url')}")
        
    except Exception as e:
        print(f"[ERROR] 上传异常：{e}")
        import traceback
        traceback.print_exc()
        return
    
    # 步骤 2: 创建克隆
    print("\n步骤 2: 创建声音克隆...")
    try:
        clone_payload = {
            "voice_id": voice_id,
            "name": "cloned_voice_001",
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
            print(f"响应：{clone_resp.text[:300]}")
            return
        
        clone_result = clone_resp.json()
        qwen_voice_id = clone_result.get("qwen_voice_id")
        
        print(f"[SUCCESS] 克隆成功")
        print(f"   本地 ID: {clone_result.get('id')}")
        print(f"   声音名称：{clone_result.get('name')}")
        print(f"   Qwen Voice ID: {qwen_voice_id}")
        print(f"   角色：{clone_result.get('role')}")
        print(f"   已克隆：{clone_result.get('is_cloned')}")
        
        # 步骤 4: 测试语音合成
        print("\n步骤 4: 测试语音合成...")
        tts_payload = {
            "text": "你好，这是使用克隆声音进行的测试。",
            "voice_id": clone_result.get("id"),
            "model_id": "cosyvoice-v3.5-flash"
        }
        
        tts_resp = requests.post(
            f"{BACKEND_URL}/api/tts/synthesize",
            json=tts_payload,
            timeout=60
        )
        
        print(f"TTS 响应状态码：{tts_resp.status_code}")
        
        if tts_resp.status_code == 200:
            print(f"[SUCCESS] 语音合成成功")
            print(f"   输出文件：{tts_resp.json().get('output_file')}")
        else:
            print(f"[ERROR] 语音合成失败：{tts_resp.status_code}")
            print(f"响应：{tts_resp.text[:300]}")
        
    except Exception as e:
        print(f"[ERROR] 克隆异常：{e}")
        import traceback
        traceback.print_exc()
    
    # 清理临时文件
    try:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
            print(f"\n已清理临时文件：{temp_audio_path}")
    except:
        pass

if __name__ == "__main__":
    test_clone_with_url()
