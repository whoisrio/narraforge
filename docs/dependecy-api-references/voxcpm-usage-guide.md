
# Usage Guide

本页讲解 VoxCPM 2 的生成参数与三种生成模式，并详细说明文本输入、参考音频、质量调参与流式生成等内容。

## Generation Parameters

`generate()` 方法接受以下关键参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `text` | （必填） | 待合成文本。支持 VoxCPM 2 的 30 种语言。 |
| `reference_wav_path` | `None` | 用于声音克隆的参考音频（仅 VoxCPM 2）。模型提取音色，无需转录文本。 |
| `prompt_wav_path` | `None` | 用于续写式克隆的提示音频。必须与 `prompt_text` 配对使用。 |
| `prompt_text` | `None` | `prompt_wav_path` 的精确转录文本。必须与提示音频一同提供。 |
| `cfg_value` | `2.0` | 引导尺度。值越高对条件的遵循越严格；值越低变化越大。典型范围：1.0–3.0。 |
| `inference_timesteps` | `10` | 扩散步数。步数越多，细节与自然度越好，但速度更慢。推荐：4–30。 |
| `normalize` | `False` | 运行文本正则化以展开数字、日期等。适用于原始文本输入。 |
| `denoise` | `False` | 在生成前对提示/参考音频降噪。当参考音频有噪声时有帮助。 |
| `retry_badcase` | `True` | 当生成音频相对文本异常短或长时自动重试。 |

---

## Three Generation Modes

VoxCPM 2 支持三种模式，取决于你对输出声音的控制程度。

### 1. Voice Design（声音设计）

无需参考音频。在文本前以控制指令描述你想要的声音，VoxCPM 从零生成新声音。

```python
from voxcpm import VoxCPM
import soundfile as sf

model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)

wav = model.generate(
    text="(A young woman, gentle and sweet voice)Hello, welcome to VoxCPM!",
    cfg_value=2.0,
    inference_timesteps=10,
)
sf.write("voice_design.wav", wav, model.tts_model.sample_rate)
```

控制指令写在目标文本前的括号内——例如 `(年轻女性,温柔甜美)` 或 `(an excited young man)`。指令支持中文与英文。

### 2. Controllable Voice Cloning（可控声音克隆）

上传参考音频。模型克隆音色，你仍可使用控制指令调整语速、情感或风格。

```python
wav = model.generate(
    text="(slightly faster, cheerful tone)This is a cloned voice with style control.",
    reference_wav_path="speaker.wav",
    cfg_value=2.0,
    inference_timesteps=10,
)
sf.write("controllable_clone.wav", wav, model.tts_model.sample_rate)
```

此模式下，`reference_wav_path` 提供音色，括号内的指令控制风格。无需参考音频的转录文本。

### 3. Hi-Fi Cloning（高保真克隆）

为获得最大声音相似度，同时提供参考音频及其精确转录文本。模型利用转录文本精确对齐提示音频，产生最高的克隆保真度。

```python
wav = model.generate(
    text="This is a high-fidelity cloned voice.",
    prompt_wav_path="speaker.wav",
    prompt_text="The exact transcript of speaker.wav goes here.",
    reference_wav_path="speaker.wav",
    cfg_value=2.0,
    inference_timesteps=10,
)
sf.write("hifi_clone.wav", wav, model.tts_model.sample_rate)
```

> 💡 建议使用 ASR 获取转录文本，而非手动输入。网页演示通过 SenseVoice 自动完成这一步。**启用 Hi-Fi 模式时，控制指令将被忽略。**

---

## Text Input

### Regular text vs. phoneme input

大多数情况下使用常规文本。当你希望 VoxCPM 自动展开数字、日期及类似格式时，保持 `normalize=True`。

仅在需要更精细的发音控制时使用音素输入。此时需禁用文本正则化：

- 中文：使用带声调数字的拼音，如 `{ni3}{hao3}`
- 英文：使用 CMU 字典风格音素，如 `{HH AH0 L OW1}`

如果数字被逐位读出，请启用文本正则化。

> ⚠️ 文本正则化可能无法完美处理所有边界情况。例如，某些模型名或产品名可能需要人工预处理。

### Punctuation as prosody cue

VoxCPM 使用标点符号作为韵律提示：

- 句号与问号通常会产生更清晰的句末停顿
- 逗号通常产生较短的停顿
- 省略号可产生犹豫或拖尾效果

如果需要更强的停顿，请将文本拆分为更短的句子，而非仅依赖标点。

### Short inputs

极短的输入（如 `"Hello"` 或 `"好的"`）可能听起来微弱，因为模型训练时的最小音频长度约为 1 秒。实际上，能够自然产生至少几秒语音的输入更为稳定。

### Dialect text

要生成特定方言的语音，需使用该方言自身的词汇和表达，而非标准普通话：

✅ 粤语：`(广东话,中年男性)伙計,唔該一個A餐,凍奶茶少甜!`

❌ 粤语：`(广东话,中年男性)伙计,麻烦来一个A餐,冻奶茶少甜!`（标准普通话）

如果不确定如何编写地道的方言文本，可先用 DeepSeek 或 Doubao 等 LLM 从普通话翻译。

---

## Reference Audio Guidelines

- **时长**：5 到 30 秒是实用范围
- **格式**：torchaudio 支持的任何格式，包括 WAV、FLAC 和 MP3
- **质量**：更干净的音频通常能更好地保留音色
- **语言**：VoxCPM 2 支持 30 种语言

### Ensuring a consistent voice

如果不提供参考音频，VoxCPM 每次都会生成随机声音。模型仍能从文本推断适当的说话风格，但音色在多次调用间不会保持一致。

**解决方法**：每次重复使用相同的参考音频。在可控声音克隆模式下使用 `reference_wav_path` 可获得稳定的音色。

> 📌 VoxCPM 1.x 需要 `prompt_wav_path` + `prompt_text` 进行克隆，不支持 `reference_wav_path`。1.x 特定用法请参阅 VoxCPM 1.5。

---

## Quality Tuning

### cfg_value

| 数值 | 效果 |
|---|---|
| 1.0–2.0 | 更松弛自然，但可能略微偏离目标文本 |
| 2.0 | 平衡默认值 |
| 2.0–3.0 | 对文本的遵循更强，但在困难输入上出现噪声或伪影的风险更高 |

如果长文本输出变得嘈杂或有嗡嗡声，将 `cfg_value` 向 1.5–1.6 降低通常更稳定。

### Long text handling

长文本最容易引发不稳定行为，包括：

- 逐渐加速或产生嗡嗡声
- KV 缓存增长导致的显存溢出
- 永不停止的生成

实际解决方案是将长文本拆分为较短的片段，并拼接生成的波形。

### Handling extra sounds

如果听到生成音频开头或结尾有多余声音：

- **VoxCPM 1.x**：检查 `prompt_text` 是否与参考音频精确匹配——转录不匹配是最常见的成因
- 其他尝试：
  - 启用 `retry_badcase=True`
  - 降低 `cfg_value`
  - 如有需要在输出后进行裁剪

---

## Denoise Parameter

`denoise` 参数改善的是提示音频，而非生成输出本身：

- `denoise=True`：当参考音频有噪声时有用
- `denoise=False`：当提示已经干净且希望保留原始声音特征时更佳

> ⚠️ 降噪器在 16kHz 流水线中运行，可能轻微改变声音特征。如果克隆质量变差，请尝试关闭它。

---

## Streaming

VoxCPM 通过 `generate_streaming()` 支持流式音频输出。对于交互式应用，**句子级方法**通常比尝试流式处理不断增长的文本输入更稳定：

1. 将输入文本拆分为句子
2. 为每个句子调用 `generate_streaming()`
3. 按顺序播放或缓冲每个音频块

双向流式（文本逐个 token 到达的同时生成音频）目前不支持。

---

如需特定版本的详细特性与迁移说明，请参阅 Models 下的各页面。