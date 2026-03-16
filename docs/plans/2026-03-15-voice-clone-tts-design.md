# 语音克隆与文字转语音配音应用设计

## 1. 项目概述

**项目名称**: Voice Clone Studio
**项目类型**: Web 应用（全栈）
**核心功能**: 声音克隆 + 文本转语音，支持视频时间轴对齐
**目标用户**: 视频创作者、配音爱好者、内容创作者

## 2. 功能需求

### 2.1 声音克隆
- **音频文件上传**: 支持上传 MP3/WAV 格式音频进行克隆
- **实时录音**: 支持浏览器实时录音进行克隆
- **声音管理**: 列出已克隆的声音，支持删除和重命名

### 2.2 文本转语音 (TTS)
- **基础参数**:
  - 语速 (speed): 0.5-2.0
  - 音量 (volume): 0-100
  - 音调 (pitch): -12 到 +12
  - 情感 (emotion): happy/sad/neutral/excited
- **模型可配置**: 支持切换不同语音模型，默认对接千问
- **模型列表**: 支持配置多个模型服务商

### 2.3 时间轴对齐
- **视频上传**: 支持上传视频文件作为参考
- **时间轴标记**: 在视频时间轴上标记需要配音的段落
- **分段合成**: 为每个时间段生成对应文本的语音
- **预览播放**: 对齐视频播放配音结果

## 3. 技术架构

### 3.1 技术栈
- **后端**: Python FastAPI
- **前端**: React + TypeScript
- **数据库**: SQLite（轻量级，无需额外部署）
- **AI 模型**: 千问语音模型（可扩展其他厂商）

### 3.2 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
├─────────────────────────────────────────────────────────────┤
│  - 声音克隆模块 (上传/录音)                                  │
│  - TTS 控制面板 (参数调节/模型选择)                          │
│  - 视频时间轴 (视频播放/段落标记/配音预览)                    │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│                      后端 (FastAPI)                          │
├─────────────────────────────────────────────────────────────┤
│  /api/clone    - 声音克隆接口                                │
│  /api/tts      - 文本转语音接口                              │
│  /api/timeline - 时间轴管理接口                              │
│  /api/config   - 模型配置接口                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     千问语音模型 API                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 目录结构

```
voice_clone/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── api/            # API 路由
│   │   ├── core/           # 核心配置
│   │   ├── models/         # 数据模型
│   │   └── services/       # 业务逻辑
│   ├── main.py
│   └── requirements.txt
├── frontend/               # React 前端
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── services/      # API 服务
│   │   └── types/         # TypeScript 类型
│   ├── package.json
│   └── vite.config.ts
└── docs/plans/            # 设计文档
```

## 4. API 设计

### 4.1 声音克隆
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/clone/upload` | POST | 上传音频文件进行克隆 |
| `/api/clone/record` | POST | 实时录音数据克隆 |
| `/api/clone/list` | GET | 获取已克隆声音列表 |
| `/api/clone/:id` | DELETE | 删除克隆声音 |

### 4.2 文本转语音
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/tts/synthesize` | POST | 合成语音 |
| `/api/tts/models` | GET | 获取可用模型列表 |
| `/api/tts/batch` | POST | 批量合成（时间轴用） |

### 4.3 时间轴
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/timeline` | GET | 获取项目时间轴 |
| `/api/timeline` | POST | 创建时间轴项目 |
| `/api/timeline/:id/segment` | POST | 添加时间段落 |

### 4.4 配置
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/config/models` | GET | 获取模型配置 |
| `/api/config/models` | PUT | 更新模型配置 |

## 5. 数据模型

### VoiceProfile
```python
class VoiceProfile:
    id: str           # UUID
    name: str         # 声音名称
    audio_path: str   # 音频文件路径
    created_at: datetime
```

### TTSConfig
```python
class TTSConfig:
    model_provider: str   # "qwen"
    model_name: str       # 模型名称
    speed: float          # 0.5-2.0
    volume: float         # 0-100
    pitch: int            # -12 到 +12
    emotion: str          # "happy"/"sad"/"neutral"/"excited"
```

### TimelineSegment
```python
class TimelineSegment:
    id: str
    text: str             # 要配音的文本
    start_time: float     # 开始时间（秒）
    end_time: float       # 结束时间（秒）
    audio_url: str        # 生成的音频 URL
```

## 6. 部署方式

- **开发环境**: 本地运行前后端
- **生产环境**: Docker Compose 部署

## 7. 验证方式

1. 前端能正常启动并访问
2. 声音克隆功能正常工作
3. TTS 参数调节生效
4. 视频时间轴对齐功能正常
5. 模型可配置切换