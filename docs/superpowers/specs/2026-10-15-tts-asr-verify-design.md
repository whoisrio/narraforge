# TTS 语音核对（ASR 回读验收）设计

- 日期：2026-10-15
- 状态：待评审
- 方案：方案一（后端核对接口 + segment 内嵌核对状态），全量核对入口放 Studio 底部工具栏

## 要解决的问题

TTS 合成完成后，只能靠人耳逐段听来确认读得对不对。
一段几十个 segment 的章节，听一遍要很久，而且容易走神漏掉错读、漏读、读成多音字的问题。

思路：用 ASR 把每段 TTS 音频转回文本，和"这段实际应该读的内容"比对，不一致的挑出来，人工只复核这些。
这是 TTS 验收的常用做法（ASR round-trip），本项目后端已有 FunASR（paraformer-zh）和 Whisper 两条现成转写链路，大半能力是复用。

## 两个关键前提（先定死，避免后面返工）

### 前提一：对比基准是"实际朗读文本"，不是显示原文

segment 的显示文本和 TTS 实际读的文本不是同一份：

- 发音映射（`text_transforms.applied_map_ids` 引用全局/项目映射表）
- 拉丁字母小写化（`text_transforms.lowercase_latin` / 项目默认）
- 引擎侧文本清洗（mute_tags、skip_parenthesized、underscore_to_space 等）

拿显示原文做基准，凡是开了变换的 segment 全是误报。
所以基准文本必须用送引擎前的文本：前端用 `resolveSegmentEngineText`（与合成路径共用的统一入口）重算；它是合成的逆过程同源函数，重算结果即实际朗读内容。

### 前提二：不能用字符串相等判定，要归一化 + 相似度

ASR 回读天然和原文有格式差异：中文标点恢复不同、数字读法（"3.14"读成"三点一四"）、英文大小写、全半角。
不做归一化，过滤结果会被误报淹没。

判定分两层：

1. 归一化（去差异）后算相似度，低于阈值报"不一致"；
2. 最终裁决是人——所以 UI 必须把基准和回读并排 diff 展示，人工确认忽略或重新 TTS。

## 总体架构

```
┌─ 前端（编排 + 呈现）────────────────────────────────┐
│ 入口：segment 按钮 / 章节核对 / 全量核对（底部工具栏）  │
│ 取音频 blob（backend: /segmented-projects/../audio   │
│             frontend: IndexedDB getTTSAudioBlob）     │
│ 算基准文本（resolveSegmentEngineText）                 │
│ POST /api/tts-verify/verify ──────────────┐          │
│ 写 segment.verification（绑 audio_key）     │          │
│ 呈现：角标 / 详情 diff / 过滤 / 忽略        │          │
└───────────────────────────────────────────┼──────────┘
                                            ▼
┌─ 后端（一个接口，比对逻辑唯一实现）───────────────────┐
│ FunASRService.transcribe_raw（复用模型缓存+推理锁，    │
│   不写 SRT 文件）→ 回读文本                            │
│ tts_verify_service：归一化 → 相似度 → diff             │
│ 返回结构化结果（不落库，核对状态由前端写回 segment）    │
└──────────────────────────────────────────────────────┘
```

比对逻辑只有后端一份（Python，pytest 好测）；前端只做编排和呈现；两种存储模式走同一条路（音频都由前端上传）。

## 后端设计

### 新增接口：POST /api/tts-verify/verify

请求（multipart）：

- `audio`：音频文件（mp3/wav，前端上传）
- `baseline_text`：实际朗读文本（前端用 resolveSegmentEngineText 算好）
- `threshold`：可选，相似度阈值，默认 0.8
- `engine`：可选，默认 `funasr`（当前唯一实现，字段先留出来）

响应 200：

```json
{
  "asr_text": "FunASR 原始回读文本",
  "normalized_baseline": "归一化后的基准",
  "normalized_asr": "归一化后的回读",
  "similarity": 0.93,
  "match": true,
  "diff": [
    { "op": "equal", "baseline": "保温杯", "asr": "保温杯" },
    { "op": "replace", "baseline": "不锈钢", "asr": "不锈纲" }
  ],
  "engine": "funasr",
  "device": "mps",
  "elapsed_ms": 1200
}
```

diff 的 op 取 difflib opcodes 语义：equal / replace / delete / insert。

错误：400（空音频、缺参数）、503（funasr 不可用，如 Vercel workers 环境）。

### FunASRService 加一个纯转写方法

`transcribe_raw(input_file, device=None) -> str`：

- 复用现有模型缓存和推理锁；
- 用 `MODEL_PRESETS_NO_VAD`（核对对象是短音频，整段识别）；
- 拼接各 result 的 text 返回，不写任何 SRT 文件（现有 `transcribe` 会往 srt_output_dir 落盘，核对场景是垃圾文件）。

### tts_verify_service.py：归一化 + 相似度 + diff

归一化规则（两侧文本都做，顺序固定）：

1. 全角转半角（`ＮＡＳＡ` → `NASA`，`，` → `,`）
2. 去所有空白
3. 去中英文标点
4. 小写化
5. 阿拉伯数字转中文读法（整数和小数，`3.14` → `三点一四`；千分位逗号在第 3 步去标点时已随之消失，无额外处理）

相似度：`difflib.SequenceMatcher(None, a, b).ratio()`，≥ threshold 判 match。

已知边界（不遮掩）：英文音色读数字会是英文单词（"three point one four"），v1 归一化不处理英文数字读法，这类 segment 相似度会偏低。靠阈值 + 人工在详情里看 diff 兜底；真遇到了再加英文数字归一化规则。

### 环境边界

funasr 是本地模型，Vercel workers 上没有。
接口在 funasr 导入失败时返回 503，前端 toast「语音核对仅本地环境可用」。
不做 ASR provider 抽象（YAGNI）；以后真要在部署环境用，再加 API 型 provider。

## 数据模型

### segment 加 verification JSON 字段

前端类型和后端列同构，只保留最近一次核对结果（不做历史）：

```ts
interface SegmentVerification {
  audio_key: string;        // 核对时的音频标识：audio.current?.id ?? audio.current?.path
  status: 'match' | 'mismatch' | 'ignored' | 'error';
  baseline_text: string;    // 实际朗读文本（核对时用的）
  asr_text: string;         // ASR 回读文本（error 时可为空）
  similarity?: number;
  match?: boolean;
  diff?: DiffOp[];
  engine: string;
  error?: string;           // error 状态时的信息
  checked_at: string;       // ISO
}
```

`running` 态不持久化，只在前端内存里（避免中断后 segment 永远卡在"核对中"）。

### audio_key：核对结果与音频版本绑定

- 前端存储模式音频有 id（IndexedDB TTS result id），后端存储模式有 path，key 取 `current.id ?? current.path`；
- 渲染时 `verification.audio_key !== 当前 audio_key` 一律按"未核对"处理（可加"已过期"角标提示）；
- 重新 TTS 后 audio.current 变化 → 旧核对结果和忽略标记自动作废，不会错挂到新音频上；
- 核对结果返回时若 audio_key 已变（核对中途用户重 TTS 了），直接丢弃不写。

### 后端持久化（照 text_transforms 的全链路模式）

- `segmented_project_segments` 加 `verification JSON`（none_as_null=True）列；
- `database.py` 加一组 `ALTER TABLE segmented_project_segments ADD COLUMN verification JSON` 迁移语句（沿用现有 _P2/_P3 ALTER 机制）；
- `SegmentIn` / `project_to_detail` / 整包保存 / patch 接口透传该字段；
- 项目导出/导入 service 透传。

## 前端设计

### 编排：services/ttsVerify.ts

- `verifyOne(project, segment)`：
  1. 取音频 blob（backend 模式 fetch `/segmented-projects/{pid}/audio/{cid}/{sid}`；frontend 模式 `getTTSAudioBlob(audioId)`，两条路径播放功能已在用）；
  2. 算基准文本（`resolveSegmentEngineText`，与合成同源）；
  3. 调 verify 接口；
  4. 写回 `segment.verification`（写前校验 audio_key 未变）。
- `verifyBatch(segments, { onProgress, signal })`：串行循环调 verifyOne。
  FunASR 后端推理锁本来就是串行，前端并发只会堆请求；进度回调（done/total），支持 abort。
- 单个失败标 error 继续下一个，不中断整批。

### 入口（三个层级）

1. **segment 级**：segment 操作区（重新生成/播放旁边）加"核对"按钮（无音频时禁用）。
2. **章节级 + 项目级**：Studio 底部工具栏（sourceProductionBar 的 productionActions，批量合成菜单旁）加"语音核对"下拉：
   - 核对本章
   - 全量核对（项目所有章节）
   - 核对进行中显示进度 pill「核对中 3/28」，可取消。
3. **自动重核**：`project.configs.auto_verify_after_tts`（默认关），开启后单段重新 TTS 成功（GENERATE_SUCCESS）自动触发该段核对；设置入口放项目设置面板。

### 呈现

- **segment 角标**：核对状态角标（✓ 一致 / ✗ 不一致 / ⊘ 已忽略 / ！出错 / – 未核对），点击打开核对详情。列表视图（SegmentRow）和 Studio 对话视图（ChatBubble/NarrationBlock）都要有。
- **全局过滤**：productionRight 加 pill 开关「只看不一致」，开启后列表只显示有效状态为 mismatch 的 segment。角标作废逻辑（audio_key 不匹配）在过滤判定里同样生效。
- **核对详情**（弹层）：基准文本 vs 回读文本并排、diff 高亮、相似度数值；操作三个——忽略不一致（status 置 ignored，保留 asr_text 供追溯）/ 重新核对 / 重新 TTS（走现有重生成流程，完成后按设置决定是否自动重核）。

### 状态判定汇总（渲染层统一函数）

```
有效状态 =
  无 verification                        → 未核对
  verification.audio_key ≠ 当前 audio_key → 未核对（可显示"已过期"）
  否则                                    → verification.status
```

## 错误处理

| 场景 | 行为 |
|---|---|
| funasr 不可用（workers 部署） | 接口 503，前端 toast「语音核对仅本地环境可用」 |
| ASR 回读为空（静音/坏音频） | similarity 0 判 mismatch，详情明示「回读为空」 |
| 批量核对中单段失败 | 该段标 error，继续下一段 |
| 核对中途用户重新 TTS | 结果回来时 audio_key 已变，丢弃不写 |
| 音频文件丢失（file_exists=false） | 前端取 blob 失败，该段标 error |
| 用户中断批量核对 | 已完成的保留，未处理的回到未核对 |

## 测试策略

- **后端 pytest**：归一化各规则（全角/标点/大小写/数字/千分位）、相似度阈值边界、diff 结构、verify 接口（monkeypatch transcribe_raw）、503 分支。
- **前端 vitest**：verifyOne/verifyBatch 编排（mock api）、audio_key 作废与丢弃写入、过滤逻辑、角标状态映射。
- **E2E（Playwright，沿用 API+SQLite 双校验）**：后端加测试专用 stub——环境变量 `TTS_VERIFY_STUB=1` 时 transcribe_raw 返回可控文本；用例覆盖 合成 → 全量核对 → 出现不一致 → 过滤只看不一致 → 忽略 → 重新 TTS → 旧忽略作废。

## 明确不做（YAGNI）

- 不做 ASR provider 抽象（本地 FunASR 一种；要接 API 型时再加）
- 不存回读音频，不做核对历史（segment 上只留最近一次）
- 不做韵律/停顿/语速层面的质量评估（只对文本内容）
- 不做后端全托管核对（frontend 存储模式下音频不在服务端，这套白写）
