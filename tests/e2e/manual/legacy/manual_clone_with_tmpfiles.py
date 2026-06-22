"""
使用 tmpfiles.org 上传音频文件进行克隆测试

tmpfiles.org 是一个免费的临时文件托管服务
- 上传后获得公网 URL
- 文件保留 24 小时
- 无需注册
"""

import requests
import os

# 配置
BACKEND_URL = "http://127.0.0.1:8002"
TMPFILES_API = "https://tmpfiles.org/api/v1/upload"

# 数据库中已有的音频文件路径
AUDIO_FILE_PATH = "E:\\repos\\vcprjs\\voice_clone\\backend\\uploads\\voices\\0841505e-e09e-4afb-8df0-60c4d5c8bbb7.mp3"
VOICE_ID = "0841505e-e09e-4afb-8df0-60c4d5c8bbb7"


def upload_to_tmpfiles(file_path: str):
    """上传文件到 tmpfiles.org"""
    print(f"\n上传文件到 tmpfiles.org: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"❌ 文件不存在：{file_path}")
        return None
    
    try:
        with open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f, "audio/mpeg")}
            resp = requests.post(TMPFILES_API, files=files, timeout=60)
        
        print(f"响应状态码：{resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ 上传失败：{resp.status_code}")
            print(f"响应：{resp.text}")
            return None
        
        result = resp.json()
        
        # tmpfiles.org 返回格式：{"status": 200, "data": {"url": "https://tmpfiles.org/dl/xxxx/file.mp3"}}
        if result.get("status") == 200:
            download_url = result["data"]["url"]
            # 转换为下载链接（替换 /dl/ 为 /dl/download/）
            download_url = download_url.replace("/dl/", "/dl/download/")
            print(f"✅ 上传成功")
            print(f"   下载 URL: {download_url}")
            return download_url
        else:
            print(f"❌ 上传失败：{result}")
            return None
            
    except Exception as e:
        print(f"❌ 上传异常：{e}")
        return None


def test_clone_with_url(audio_url: str, voice_id: str):
    """使用音频 URL 测试克隆（模拟后端配置了 PUBLIC_BASE_URL 的情况）"""
    print("\n" + "="*60)
    print("测试克隆（使用公网 URL）")
    print("="*60)
    
    print(f"音频 URL: {audio_url}")
    print(f"声音 ID: {voice_id}")
    
    # 注意：这个测试需要修改后端代码来直接使用 URL
    # 正常情况下，后端会根据 PUBLIC_BASE_URL 自动构建 URL
    # 这里我们只是演示
    
    print("\n⚠️  注意：")
    print("   这个测试需要配置 PUBLIC_BASE_URL 才能正常工作")
    print("   或者修改后端代码来直接使用外部 URL")
    print("\n   建议使用 ngrok 方案:")
    print("   1. 安装 ngrok: https://ngrok.com/download")
    print("   2. 运行：ngrok http 8002")
    print("   3. 在 backend/.env 中设置：PUBLIC_BASE_URL=https://xxxx.ngrok.io")
    print("   4. 重启后端服务")
    
    return False


def main():
    print("\n" + "="*60)
    print("🚀 使用 tmpfiles.org 测试声音克隆")
    print("="*60)
    
    # 1. 上传音频
    audio_url = upload_to_tmpfiles(AUDIO_FILE_PATH)
    
    if not audio_url:
        print("\n❌ 上传失败，无法继续测试")
        return
    
    # 2. 测试克隆
    test_clone_with_url(audio_url, VOICE_ID)
    
    print("\n" + "="*60)
    print("📝 总结")
    print("="*60)
    print("✅ 音频文件可以上传到公网")
    print("⚠️  需要配置 PUBLIC_BASE_URL 才能完成克隆")
    print("\n💡 推荐方案：使用 ngrok 暴露本地服务")
    print("   优点：")
    print("   - 简单快速，无需修改代码")
    print("   - 后端自动处理音频 URL 构建")
    print("   - 适合开发和测试")


if __name__ == "__main__":
    main()
