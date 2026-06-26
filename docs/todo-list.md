# NarraForge TODO

详见总路线图：[`docs/roadmap.md`](roadmap.md)

## P0：项目制语音工作台

- [x] 删除单段模式
- [x] 默认进入草稿项目 `__scratchpad__`
- [x] 项目管理改为可收缩侧栏
- [x] 项目/章节/分段 UI 收敛
- [x] 清理旧的 `SynthesisHistory` / `TTSResult` 链路
- [x] 后端 audio_path 保留 + TTS 真实引擎 + duration 探测
- [x] 前端播放错误 toast（不再静默 catch）

## P1：配置引导 / 模型能力中心（推迟到 P2 之后补完整版，P2 内会内嵌必要的检测）

- [ ] 首次使用向导
- [ ] 外部模型 API 配置
- [ ] 本地模型配置说明
- [ ] FFmpeg 可用性检测
- [ ] ASR 模型状态检测
- [ ] 本地硬件资源评估：架构、内存、磁盘、GPU/Metal
- [ ] 功能可用性面板

## P2：输入源统一

- [ ] 文本输入
- [ ] 音频上传 + ASR
- [ ] 视频上传 + FFmpeg 抽音频 + ASR
- [ ] 明确视频不做画面理解
- [ ] `SourceDocument` 数据模型

## P3：原始文档到口播文稿

- [ ] 清理 Markdown / URL / 表格 / 脚注
- [ ] 事实、术语、数字锁定
- [ ] 口播化改写
- [ ] 风格和长度控制
- [ ] 质量检查：事实、TTS 友好、AI 腔
- [ ] 应用到当前章节
- [ ] 应用并智能拆分

## P4：分段语音体验精修

- [ ] 智能拆分增强
- [ ] 情感标注增强
- [ ] 长段/短段/空段提示
- [ ] 批量生成策略增强
- [ ] 全部播放体验增强
- [ ] 导出前检查

## P5：音色管理增强

- [ ] 统一 `VoiceAsset` 模型
- [ ] 音色库页面
- [ ] 系统音色 / 克隆音色 / MiMo 预设统一展示
- [ ] 搜索、标签、收藏
- [ ] 试听
- [ ] 设为项目/章节/段落音色
- [ ] 克隆状态管理

## P6：导出增强

- [ ] 整章音频
- [ ] 分段音频 ZIP
- [ ] SRT / ASS / 纯文本字幕
- [ ] Segment manifest JSON
- [ ] 项目备份 JSON

## P7：视觉制作 Brief

- [ ] 整体视觉风格生成
- [ ] 每段视觉呈现要求
- [ ] Remotion 动画规格
- [ ] B-roll / 图表 / 截图 / Logo 制作建议
- [ ] Markdown / JSON / Remotion contract 导出

## P8：可选回导合成

- [ ] 按 segment_id 匹配外部动画片段
- [ ] 校验时长
- [ ] 叠字幕
- [ ] 合成旁白
- [ ] 导出完整视频



---
### VoxCPM
VoxCPM的文本合成是完全随机的，在工作室界面不提供这个功能；
VoxCPM的音色设计，只在角色语音设计提供；
VoxCPM的声音克隆也要支持克隆所有角色的音色，极致克隆同理；

MiMO 的音色复刻，要支持选择角色设计的音色，无论哪个模型；
视频MiMO的design API；

---
在项目角色音色设计中，采用类似全局音色设计的形式，分为 模型预制声音 | 克隆音色 | 设计新音色，
模型预制音色，呈现的模型就是 Edge-TTS和Mimo-TTS的预制音色；
克隆音色，可选cosyvoice、mimo(mimo-tts-voiceclone) 和 voxcpm， cosyvoice只提供语音公网地址，用户填入地址确认后，后端要执行提交qwen服务克隆和下载音频的操作(后端应该已经支持了）；此外，mimo-tts在这里要改成mimo-tts-voiceclone, mimo-tts-voiceclone和voxcpm，提供实时录制和上传文件的方式克隆，不需要有其他参数；mimo和voxcpm克隆时，使用上传或者录制音色，根据 试听文本 生成合成语音，voxcpm 是支持极致克隆和克隆两种模式，克隆时支持设置声音描述，极致克隆时必须要填入录制或上传的语音的文本，声音克隆的角色需要保存原始的声音和克隆试听的声音，克隆的时候始终选择原始声音作为克隆参考；
设计新音色，只有mimo(mimo-tts-voicedesign)和voxcpm支持；设计新音色要支持填入声音描述和试听文本；

全局和项目的角色，不光是音色，声音的参数也必须要保留下来；
---
mimo-tts-voicedesign，optimize_text_preview 默认设置为false，严格要求使用传入的文本朗读；声音描述填在user里，合成文本填在assistant里；
mimo-tts-voicedesign，应该是不支持表现强度和稳定性这两个参数的；
---
在工作室中，当处于旁白模式，通过模型选择音色时，
cosyvoice只能选择上传到 cosyvoice克隆过的声音，以及设置对应的合成参数；
edge-tts则可以选择系统默认音色和合成参数；
mimo可以选择系统声音音色以及参数 ，以及选择mimo-tts-clone，clone的音色则来自项目中或者全局通过mimo-clone或者voxcpm设计的角色音色，以及对应的参数；
voxcpm可以选择通过voxcpm 设计的角色声音以及参数,voxcpm声音克隆可以选择风格指令，极致克隆只能选择克隆的声音(且克隆的声音必须包含声音内容(不是音色)的文本描述)；
voxcpm和mimo均不能选择cosyvoice的克隆音色(cosyvoice的克隆音色可能是在远端，找不到)