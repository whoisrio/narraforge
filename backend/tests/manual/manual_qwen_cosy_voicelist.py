import os
import time
import dashscope
from dashscope.audio.tts_v2 import VoiceEnrollmentService, SpeechSynthesizer
from dotenv import load_dotenv


load_dotenv()
# 1. 环境准备
# 推荐通过环境变量配置API Key
# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 若没有配置环境变量，请用百炼API Key将下行替换为：dashscope.api_key = "sk-xxx"
dashscope.api_key = os.getenv("QWEN_API_KEY")
if not dashscope.api_key:
    raise ValueError("QWEN_API_KEY environment variable not set.")

# # 以下为北京地域WebSocket url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference
# dashscope.base_websocket_api_url='wss://dashscope.aliyuncs.com/api-ws/v1/inference'
# # 以下为北京地域HTTP url，若使用新加坡地域的模型，需将url替换为：https://dashscope-intl.aliyuncs.com/api/v1
# dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

# 3. 创建音色 (异步任务)
print("--- Step 1: Creating voice enrollment ---")
service = VoiceEnrollmentService()


# 按前缀筛选，或设为None查询所有
voices = service.list_voices(prefix='', page_index=0, page_size=10)

print(f"Request ID: {service.get_last_request_id()}")
print(f"Found voices: {voices}")
