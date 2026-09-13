阅读 docs/dependecy-api-references/voice-style-tags.md
# workflow 拆分segment的时，自动写入tag
tag需要映射建立到mimo和voxcpm的映射，在workflow拆分的时候需要询问使用哪种模型来进行tts；

tts的时候，不支持tag的模型，要自动去除tag；
导出字幕的时候也需要自动去除tag；

voxcpm的tag，在clone的场景可支持，ultimate-clone不支持tag和style(instruction)
mimo tts 和 clone 都可以支持，但是clone场景下应用tag效果不好，要在UI上支持主动mute tag ?

voxcpm的tag，要在指定的位置添加；
mimo的tag只能加在开头；

# 手工添加tag

# clone和tts的时候，注意模型是否支持
voxcpm的tag
mimo的tag
edge-tts不支持tag和instruction


btw. emotion tag之前的设计是不同的颜色呈现的，这个能力不知什么时候弄丢了

---

## 落地状态（2026-07-22 ✅ 已实现）

- ✅ workflow 拆分时引擎询问：`select_tts_engine` interrupt（默认值 + 前端 120s 倒计时自动下发），drawer 支持 fork 指定节点重跑
- ✅ tag 双端规则表：`backend/app/services/engine_capabilities.py` ↔ `frontend/src/services/styleTags.ts`
- ✅ 位置 tag（[laughing] 等）内联 seg.text，仅 voxcpm；开头风格由 emotion 派生，与 style 同括号 `,` 拼接（`(开心,磁性)`）
- ✅ 合成时按引擎 strip/注入（prepare_text_for_engine）；ultimate 全 strip；mute_tags 章节开关
- ✅ 字幕导出（前端 ExportDialog 三出口 + 后端 srt_service）统一 strip
- ✅ 手工插 tag：SegmentEditPanel 的 StyleTagInserter
- ✅ emotion 彩色恢复：compact 行彩色 chip + 情绪底色修复 + WorkflowDrawer fsEmotion 上色
