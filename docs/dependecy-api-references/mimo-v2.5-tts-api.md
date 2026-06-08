# MiMo-V2.5-TTS 系列 语音合成 API 文档

> 来源: https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/speech-synthesis-v2.5
> 更新时间: 2026 年 05 月 11 日

## 概述

语音合成（文本转语音）支持将输入的文本自动转换为自然流畅的语音输出。您可通过配置发音风格、音色等参数，生成自然生动的语音内容。

### 核心能力

- **预置音色开箱即用**：内置多种精品音色，无需额外配置即可快速使用。
- **音色设计与克隆**：支持通过文本描述设计音色，或基于音频样本复刻任意音色。
- **多样化发音风格**：支持语速、情绪、角色扮演、方言等多种风格控制，语音表达更生动自然。

## 支持的模型列表

| 模型名称 | Model ID | 功能 | 音色 | 注意事项 |
|---------|----------|------|------|---------|
| MiMo-V2.5-TTS | `mimo-v2.5-tts` | 使用预置精品音色进行语音合成 | 使用预置音色列表中的精品音色 | 支持唱歌模式，不支持音色设计与音色复刻 |
| MiMo-V2.5-TTS-VoiceDesign | `mimo-v2.5-tts-voicedesign` | 通过文本描述定制音色 | 通过文本描述自动生成音色，无需预置或音频样本 | 不支持唱歌模式、预置音色与音色复刻 |
| MiMo-V2.5-TTS-VoiceClone | `mimo-v2.5-tts-voiceclone` | 基于音频样本复刻任意音色 | 通过音频样本精准复刻音色，实现任意声音的语音合成 | 不支持唱歌模式、预置音色与音色设计 |

## 准备工作

获取 API Key 等准备工作，请参考首次调用 API。

## 通用注意事项

### 调用规则

1. 语音合成的目标文本需填写在 `role` 为 `assistant` 的消息中，不可放在 `user` 角色的消息内。
2. `user` 角色的消息为可选参数，可以传入指令来调整语音合成的语气与风格，也可以是对话历史（消息内容不会出现在合成的语音中）。使用 `mimo-v2.5-tts-voicedesign` 模型时，为必填参数。
3. 采用流式调用时，输出音频的格式请指定为 `pcm16`，以便拼接成完整音频。

## 风格控制

### 自然语言控制

通过自然语言描述，让模型理解并生成对应风格的语音。内容放在 messages 中 `role: user` 的 `content` 字段。

示例：
```
用轻快上扬的语调向领导报喜，语速稍快，带着查到成绩后压抑不住的激动与小骄傲，声音明亮有活力。
```

#### 导演模式

支持更复杂精细的导演模式——像给演员写剧本一样，从角色、场景、指导三个维度全方位刻画人物与声线：

- **【角色】** 写清人物的身份、性格底色、外形气质与说话习惯。
- **【场景】** 交代此刻发生了什么、和谁说话、情绪处在什么位置。
- **【指导】** 像导演给演员下达演绎要领：语速、气息、停顿、重音、共鸣位置、音色质感、情绪起伏。

### 音频标签控制

通过在文本中嵌入风格标签与音频标签，直接对语音进行精细控制。所有标签控制内容放在 messages 中 `role: assistant` 的 `content` 字段。

格式示例：`(风格1 风格2)待合成内容`

#### 支持的括号格式
可使用半角 `()`、全角 `（）` 或 `[]`。

#### 风格类型

| 风格类型 | 风格示例 |
|---------|---------|
| 基础情绪 | 开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠 |
| 复合情绪 | 怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情 |
| 整体语调 | 温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉 |
| 音色定位 | 磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑/醇雅 |
| 人设腔调 | 夹子音/御姐音/正太音/大叔音/台湾腔 |
| 方言 | 东北话/四川话/河南话/粤语 |
| 角色扮演 | 孙悟空/林黛玉 |
| 唱歌 | 唱歌 |

#### 音频标签

可在文本中任意位置插入 `[音频标签]`，对声音进行细粒度控制：

| 风格类型 | 风格示例 |
|---------|---------|
| 语速与节奏 | 吸气/深呼吸/叹气/长叹一口气/喘息/屏息 |
| 情绪状态 | 紧张/害怕/激动/疲惫/委屈/撒娇/心虚/震惊/不耐烦 |
| 语音特征 | 颤抖/声音颤抖/变调/破音/鼻音/气声/沙哑 |
| 哭笑表达 | 笑/轻笑/大笑/冷笑/抽泣/呜咽/哽咽/嚎啕大哭 |

## 使用预置音色进行语音合成

内置多种精品音色，无需额外配置即可直接使用。当前仅支持 `mimo-v2.5-tts` 模型。

### 预置音色列表

| 音色名 | Voice ID | 语言 | 性别 |
|-------|----------|------|------|
| MiMo-默认 | `mimo_default` | 因部署集群而异，中国集群默认为冰糖，其他集群默认为 Mia | - |
| 冰糖 | `冰糖` | 中文 | 女性 |
| 茉莉 | `茉莉` | 中文 | 女性 |
| 苏打 | `苏打` | 中文 | 男性 |
| 白桦 | `白桦` | 中文 | 男性 |
| Mia | `Mia` | 英文 | 女性 |
| Chloe | `Chloe` | 英文 | 女性 |
| Milo | `Milo` | 英文 | 男性 |
| Dean | `Dean` | 英文 | 男性 |

### API 调用示例

#### 非流式调用 - Curl

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header 'Content-Type: application/json' \
--data-raw '{
    "model": "mimo-v2.5-tts",
    "messages": [
        {
            "role": "user",
            "content": "Bright, bouncy, slightly sing-song tone — like you are bursting with good news you can barely hold in. Fast pace, rising pitch at the end."
        },
        {
            "role": "assistant",
            "content": "Hey boss — guess what, guess what? I just got the results back and I actually passed! Not just passed, I got a distinction! I know, I know — you told me I was cutting it close, but hey, here we are. Drinks are on me tonight, okay?"
        }
    ],
    "audio": {
        "format": "wav",
        "voice": "Chloe"
    }
}'
```

#### 非流式调用 - Python

```python
import os
from openai import OpenAI
import base64

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2.5-tts",
    messages=[
        {
            "role": "user",
            "content": "Bright, bouncy, slightly sing-song tone — like you're bursting with good news you can barely hold in. Fast pace, rising pitch at the end."
        },
        {
            "role": "assistant",
            "content": "Hey boss — guess what, guess what? I just got the results back and I actually passed! Not just passed, I got a distinction! I know, I know — you told me I was cutting it close, but hey, here we are. Drinks are on me tonight, okay?"
        }
    ],
    audio={
        "format": "wav",
        "voice": "Chloe"
    }
)

message = completion.choices[0].message
audio_bytes = base64.b64decode(message.audio.data)
with open("audio_file.wav", "wb") as f:
    f.write(audio_bytes)
```

#### 流式调用 - Python

```python
import base64
import os
import numpy as np
import soundfile as sf
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2.5-tts",
    messages=[
        {
            "role": "user",
            "content": "Bright, bouncy, slightly sing-song tone — like you're bursting with good news you can barely hold in. Fast pace, rising pitch at the end."
        },
        {
            "role": "assistant",
            "content": "Hey boss — guess what, guess what? I just got the results back and I actually passed! Not just passed, I got a distinction! I know, I know — you told me I was cutting it close, but hey, here we are. Drinks are on me tonight, okay?"
        }
    ],
    audio={
        "format": "pcm16",
        "voice": "Chloe"
    },
    stream=True
)

# 24kHz PCM16LE mono audio
collected_chunks: np.ndarray = np.array([], dtype=np.float32)

for chunk in completion:
    if not chunk.choices:
        continue
    delta = chunk.choices[0].delta
    audio = getattr(delta, "audio", None)

    if audio is not None:
        assert isinstance(audio, dict), f"Expected audio to be a dict, got {type(audio)}"
        pcm_bytes = base64.b64decode(audio["data"])
        np_pcm = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        collected_chunks = np.concatenate((collected_chunks, np_pcm))
        print(f"Received audio chunk of size {len(pcm_bytes)} bytes")

# Save the collected audio to a file
os.makedirs("tmp", exist_ok=True)
sf.write("tmp/output.wav", collected_chunks, samplerate=24000)
print("Audio saved to tmp/output.wav")
```

## 使用文本设计音色进行语音合成

无需提供音频文件，只需在角色为 `user` 的消息中添加音色描述文本，即可生成定制化的语音音色。当前仅支持 `mimo-v2.5-tts-voicedesign` 模型。

### 如何写好音色描述（voice design prompt）

#### 关键维度

| 维度 | 示例 |
|------|------|
| 性别与年龄 | "young woman in her mid-20s"、"五十多岁的中年男性" |
| 音色/质感 | "deep and gravelly"、"丝滑醇厚、带着磁性" |
| 情绪/语气 | "warm and confident"、"温柔但带着一丝疲惫" |
| 语速/节奏 | "slow and deliberate"、"语速极快，像连珠炮" |

#### 写法建议

1. **简洁描述型** -- 用关键词或一句话快速勾勒声音轮廓
2. **专业描述型** -- 通过场景、人设或多维度细节立体刻画声音

#### 注意事项

- 长度：1-4 句即可
- 避免冲突：不要同时要求矛盾的特征
- 避免音质效果词：不要写混响、回声、EQ、压缩等后期处理相关描述
- 避免模糊词：不要用"普通的""正常的""外国的"等缺乏具体指向的描述
- 中英文均可

### API 调用示例

`mimo-v2.5-tts-voicedesign` 可通过可选参数 `optimize_text_preview` 控制是否对目标播报文本进行智能润色；设为 `true` 时，可无需传入 assistant 消息。

#### 非流式调用 - Python

```python
import os
from openai import OpenAI
import base64

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2.5-tts-voicedesign",
    messages=[
        {
            "role": "user",
            "content": "Give me a young male tone."
        },
        {
            "role": "assistant",
            "content": "Yes, I had a sandwich."
        }
    ],
    audio={
        "format": "wav",
        "optimize_text_preview": True
    }
)

message = completion.choices[0].message
audio_bytes = base64.b64decode(message.audio.data)
with open("audio_file.wav", "wb") as f:
    f.write(audio_bytes)
```

## 使用音色复刻进行语音合成

通过传入音频样本，即可精准复刻目标音色并生成语音。当前仅支持 `mimo-v2.5-tts-voiceclone` 模型。

### 注意事项

- 将音频文件样本转换为 Base64 编码字符串后传入
- 转换后的 Base64 编码的字符串大小不能超过 10 MB
- 目前仅支持传入 mp3 和 wav 格式的音频样本文件
- 请在 Base64 编码前携带前缀：`data:{MIME_TYPE};base64,$BASE64_AUDIO`
  - `{MIME_TYPE}`: 音频的 MIME 类型，取值可以为 `audio/mpeg`（或 `audio/mp3`）、`audio/wav`
  - `$BASE64_AUDIO`: 音频文件的纯 Base64 编码字符串

### API 调用示例

#### 非流式调用 - Python

```python
import base64
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1",
)

with open("voice.mp3", "rb") as f:
    voice_bytes = f.read()
voice_base64 = base64.b64encode(voice_bytes).decode("utf-8")

completion = client.chat.completions.create(
    model="mimo-v2.5-tts-voiceclone",
    messages=[
        {
            "role": "user",
            "content": ""
        },
        {
            "role": "assistant", 
            "content": "Yes, I had a sandwich."
        }
    ],
    audio={
        "format": "wav",
        "voice": f"data:audio/mpeg;base64,{voice_base64}"
    }
)

message = completion.choices[0].message
audio_bytes = base64.b64decode(message.audio.data)
with open("audio_file.wav", "wb") as f:
    f.write(audio_bytes)
```

## 计费说明

- 计费：限时免费。
- 查看账单：您可以在控制台的账单明细页面查看用量。

## API 基础信息

- **Base URL**: `https://api.xiaomimimo.com/v1`
- **认证方式**: Header `api-key: $MIMO_API_KEY`
- **接口路径**: `POST /chat/completions` (兼容 OpenAI API 格式)
- **音频采样率**: 24kHz PCM16LE mono
- **返回格式**: Base64 编码的音频数据在 `choices[0].message.audio.data` 字段中
