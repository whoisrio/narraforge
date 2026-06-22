# coding=utf-8

import os
import dashscope
from dashscope.audio.tts_v2 import *
from dotenv import load_dotenv

load_dotenv()

# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 若没有配置环境变量，请用百炼API Key将下行替换为：dashscope.api_key = "sk-xxx"
dashscope.api_key = os.environ.get('QWEN_API_KEY')

# 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference
dashscope.base_websocket_api_url='wss://dashscope.aliyuncs.com/api-ws/v1/inference'

# 模型
model = os.environ.get('QWEN_MODEL')
# 音色
#    不同模型版本需要使用对应版本的音色：
#        cosyvoice-v3-flash/cosyvoice-v3-plus：使用longanyang等音色
#        cosyvoice-v2：使用longxiaochun_v2等音色
voice = "longanyang"

# 实例化SpeechSynthesizer，并在构造方法中传入模型（model）、音色（voice）等请求参数
synthesizer = SpeechSynthesizer(model=model, voice=voice)
# 发送待合成文本，获取二进制音频
audio = synthesizer.call("这是一道一元二次方程的求根公式：$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$，请仔细计算。")
# 首次发送文本时需建立 WebSocket 连接，因此首包延迟会包含连接建立的耗时
print('[Metric] requestId为：{}，首包延迟为：{}毫秒'.format(
    synthesizer.get_last_request_id(),
    synthesizer.get_first_package_delay()))

# 将音频保存至本地
with open('backend/output/output.mp3', 'wb') as f:
    f.write(audio)