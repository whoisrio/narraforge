import os
import time
import dashscope
from dashscope.audio.tts_v2 import VoiceEnrollmentService, SpeechSynthesizer

# 1. 环境准备
# 推荐通过环境变量配置API Key
# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 若没有配置环境变量，请用百炼API Key将下行替换为：dashscope.api_key = "sk-xxx"
dashscope.api_key = os.getenv("TONGYI_API_KEY")
if not dashscope.api_key:
    raise ValueError("DASHSCOPE_API_KEY environment variable not set.")

# 以下为北京地域WebSocket url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference
dashscope.base_websocket_api_url='wss://dashscope.aliyuncs.com/api-ws/v1/inference'
# 以下为北京地域HTTP url，若使用新加坡地域的模型，需将url替换为：https://dashscope-intl.aliyuncs.com/api/v1
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'


# 2. 定义复刻参数
TARGET_MODEL = "cosyvoice-v3.5-plus" 
# 为音色起一个有意义的前缀
VOICE_PREFIX = "myvoice" # 仅允许数字和小写字母，小于十个字符
# 公网可访问音频URL
AUDIO_URL = "http://tcafk9npq.hd-bkt.clouddn.com/0841505e-e09e-4afb-8df0-60c4d5c8bbb7.mp3?e=1774161913&token=_bvmGYH-r6Q4zotTM5YHlZ-2FUSOtadbXYjBO092:WZCrDIOuBD1myIccDV_wZoz7s4A=" # 示例URL，请替换为自己的


service = VoiceEnrollmentService()
# 按前缀筛选，或设为None查询所有
voices = service.list_voices(prefix='myvoice', page_index=0, page_size=10)
print(f"Request ID: {service.get_last_request_id()}")
print(f"Found voices: {voices}")

voice_id = 'cosyvoice-v3.5-plus-myvoice-09626e8be6624f60819981a365c0d703'
# 5. 使用复刻音色进行语音合成
print("\n--- Step 3: Synthesizing speech with the new voice ---")
try:
    synthesizer = SpeechSynthesizer(model=TARGET_MODEL, voice=voice_id,speech_rate=1.35)
    text_to_synthesize = "你必须会使用的Claude 命令: `/insight`，及时更新 Claude.md，保持准确而简洁"
    
    # call()方法返回二进制音频数据
    audio_data = synthesizer.call(text_to_synthesize)
    print(f"Speech synthesis successful. Request ID: {synthesizer.get_last_request_id()}")

    # 6. 保存音频文件
    output_file = "my_custom_voice_output.mp3"
    with open(output_file, "wb") as f:
        f.write(audio_data)
    print(f"Audio saved to {output_file}")

except Exception as e:
    print(f"Error during speech synthesis: {e}")