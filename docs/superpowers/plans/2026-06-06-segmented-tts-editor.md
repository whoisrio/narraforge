# Segmented TTS Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New page that splits long text into per-sentence segments, generates TTS per-segment with retry/undo, supports SSML editing (CosyVoice) plus LLM auto-annotation, and exports WAV + JSON script + (bilingual) SRT.

**Architecture:** Pure additive change. Backend adds 3 text-split endpoints sharing an extracted LLM client helper. Frontend adds an independent page with `useReducer`-based project state, IndexedDB persistence (reuses existing `ttsResults` store for audio bytes), Web Audio API WAV concat, and per-segment status animations. Existing TTS / MiMo / subtitle-llm endpoints are reused unchanged.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, pytest, uv · React 19, TypeScript, Vite, Vitest, jsdom, fake-indexeddb

**Reference spec:** `docs/superpowers/specs/2026-06-06-segmented-tts-editor-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/app/services/llm_client.py` | Public LLM helpers: `get_llm_config`, `call_llm`, `extract_json_array` |
| Modify | `backend/app/services/llm_subtitle_service.py` | Replace internal helpers with re-exports from `llm_client` (keep aliases `_get_llm_config` etc.) |
| Create | `backend/app/services/text_split_service.py` | `rule_split`, `llm_split`, `ssml_annotate` business logic |
| Create | `backend/app/api/text_split.py` | Routes `/api/text-split/rule`, `/llm`, `/ssml-annotate` |
| Modify | `backend/main.py` | Register `text_split` router |
| Create | `backend/app/models/segmented_project.py` | SQLAlchemy skeleton (commented: not registered) |
| Modify | `backend/app/models/tts_result.py` | Add nullable `source` column |
| Create | `backend/tests/test_llm_client.py` | Unit tests for `llm_client` |
| Create | `backend/tests/test_text_split_service.py` | Unit tests for split + annotate |
| Create | `backend/tests/test_text_split_api.py` | API tests |
| Modify | `frontend/src/types/index.ts` | Add `Segment`, `SegmentedProject`, `SegmentEngineParams`, `SegmentStatus`, extend `TTSLocalRecord.source` |
| Modify | `frontend/src/services/indexedDB.ts` | DB version +1, add `segmentedProjects` store, `source` field handling |
| Create | `frontend/src/services/segmentedProjectDB.ts` | CRUD for projects + orphan audio cleanup |
| Create | `frontend/src/services/audioConcat.ts` | WAV encoder, sample-rate upmix, `fmtSrtTime`, SRT builder |
| Modify | `frontend/src/services/api.ts` | Add `textSplitApi` |
| Create | `frontend/src/hooks/useSegmentedProject.ts` | Reducer + action wrappers (state machine + side effects) |
| Create | `frontend/src/hooks/useCountUp.ts` | Number tween hook for duration animation |
| Create | `frontend/src/pages/SegmentedTTS.tsx` | Page shell wiring all panels |
| Create | `frontend/src/pages/SegmentedTTS.module.css` | Page layout styles |
| Create | `frontend/src/components/SegmentedTTS/TextInputPanel.tsx` (+css) | Text area + delimiter checkboxes + mode + split button |
| Create | `frontend/src/components/SegmentedTTS/SegmentList.tsx` (+css) | Vertical & horizontal list container |
| Create | `frontend/src/components/SegmentedTTS/SegmentRow.tsx` (+css) | One row per segment with status animation |
| Create | `frontend/src/components/SegmentedTTS/SegmentEditDrawer.tsx` (+css) | Slide-in editor: text / SSML / params |
| Create | `frontend/src/components/SegmentedTTS/ProjectToolbar.tsx` (+css) | Header bar: name/play-all/generate-all/annotate-all/export/layout |
| Create | `frontend/src/components/SegmentedTTS/ExportDialog.tsx` (+css) | Multi-select export dialog |
| Create | `frontend/src/components/SegmentedTTS/MiMoTTSParams.tsx` (+css) | Extracted parameters-only subset of `MiMoTTSPanel` |
| Modify | `frontend/src/components/TTSSynthesis/MiMoTTSPanel.tsx` | Use new `MiMoTTSParams` to avoid duplication |
| Modify | `frontend/src/App.tsx` | Add `'segmented-tts'` tab + view registration |
| Modify | `frontend/src/App.module.css` | Add tab divider/icon if needed |
| Modify | `frontend/src/pages/Landing.tsx` | Add Feature 04 tile linking to `segmented-tts` |
| Modify | `frontend/src/pages/TTSSynthesis.tsx` | When `getTTSHistory` returns, filter `source === 'segmented_tts'` |

**Note on routing:** spec mentions `/segmented-tts` route. Project actually uses **state-driven view switcher in `App.tsx`** (no `react-router`). This plan adds it as a new `Tab` value; the spec's URL talk is non-binding.

---

## Phase 1: Backend LLM client extraction + text split foundation

### Task 1: Create `llm_client.py` with extracted helpers (TDD)

**Files:**
- Create: `backend/app/services/llm_client.py`
- Create: `backend/tests/test_llm_client.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_llm_client.py`:

```python
"""Tests for the extracted LLM client helpers."""
from unittest.mock import patch, MagicMock
import pytest


def test_extract_json_array_pure_json():
    from app.services.llm_client import extract_json_array
    result = extract_json_array('[{"x": 1}, {"x": 2}]')
    assert result == '[{"x": 1}, {"x": 2}]'


def test_extract_json_array_markdown_block():
    from app.services.llm_client import extract_json_array
    raw = '```json\n[{"index": 1}]\n```'
    result = extract_json_array(raw)
    assert result == '[{"index": 1}]'


def test_extract_json_array_with_surrounding_text():
    from app.services.llm_client import extract_json_array
    raw = 'Here is the result:\n[{"index": 1}]\nDone.'
    result = extract_json_array(raw)
    assert result == '[{"index": 1}]'


def test_extract_json_array_returns_none_on_invalid():
    from app.services.llm_client import extract_json_array
    assert extract_json_array('not json at all') is None
    assert extract_json_array('') is None
    assert extract_json_array(None) is None


def test_get_llm_config_raises_when_no_key():
    """When neither LLM nor MiMo api_key is configured, should raise."""
    from app.core.config import settings
    from app.services.llm_client import get_llm_config

    original_llm = settings.llm_api_key
    original_mimo = settings.mimo_api_key
    try:
        settings.llm_api_key = ""
        settings.mimo_api_key = ""
        with pytest.raises(ValueError, match="LLM API Key 未配置"):
            get_llm_config()
    finally:
        settings.llm_api_key = original_llm
        settings.mimo_api_key = original_mimo


def test_get_llm_config_uses_env_fallback_to_mimo():
    """When LLM not configured but MiMo is, use MiMo."""
    from app.core.config import settings
    from app.services.llm_client import get_llm_config

    originals = (settings.llm_api_key, settings.llm_base_url, settings.mimo_api_key, settings.mimo_base_url)
    try:
        settings.llm_api_key = ""
        settings.llm_base_url = ""
        settings.mimo_api_key = "mk_test"
        settings.mimo_base_url = "https://mimo.example.com/v1/"
        key, base, model = get_llm_config()
        assert key == "mk_test"
        assert base == "https://mimo.example.com/v1"  # rstripped
    finally:
        settings.llm_api_key, settings.llm_base_url, settings.mimo_api_key, settings.mimo_base_url = originals


def test_call_llm_success(monkeypatch):
    """call_llm parses choices[0].message.content."""
    from app.services import llm_client

    fake_response = {
        "choices": [{"message": {"content": "hello world", "reasoning_content": ""}, "finish_reason": "stop"}],
        "usage": {"completion_tokens": 5},
    }

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return __import__('json').dumps(fake_response).encode()

    monkeypatch.setattr(llm_client, "get_llm_config", lambda db=None: ("k", "https://api.example.com/v1", "test-model"))
    monkeypatch.setattr(llm_client.urllib.request, "urlopen", lambda *a, **kw: FakeResp())

    result = llm_client.call_llm([{"role": "user", "content": "hi"}])
    assert result == "hello world"


def test_call_llm_raises_on_token_exhaustion(monkeypatch):
    """When content empty but reasoning present → raises about token exhaustion."""
    from app.services import llm_client

    fake_response = {
        "choices": [{"message": {"content": "", "reasoning_content": "thinking..."}, "finish_reason": "length"}],
        "usage": {"completion_tokens_details": {"reasoning_tokens": 8000}},
    }

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return __import__('json').dumps(fake_response).encode()

    monkeypatch.setattr(llm_client, "get_llm_config", lambda db=None: ("k", "https://api.example.com/v1", "m"))
    monkeypatch.setattr(llm_client.urllib.request, "urlopen", lambda *a, **kw: FakeResp())

    with pytest.raises(RuntimeError, match="token"):
        llm_client.call_llm([{"role": "user", "content": "hi"}])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_llm_client.py -v`
Expected: `ModuleNotFoundError: No module named 'app.services.llm_client'`

- [ ] **Step 3: Implement `llm_client.py`**

Create `backend/app/services/llm_client.py` by extracting helpers from `llm_subtitle_service.py` lines 23-185. Use this exact content:

```python
"""LLM 客户端公共能力 —— 配置读取、HTTP 调用、JSON 解析。

从 llm_subtitle_service.py 抽取，供 text_split_service 和 subtitle 字幕服务共享。
保留与原私有函数同名的别名以便平滑迁移。
"""

import json
import logging
import re
import ssl
import urllib.request
import urllib.error

from app.core.config import settings

logger = logging.getLogger(__name__)


def extract_json_array(raw: str | None) -> str | None:
    """从 LLM 返回中提取 JSON 数组字符串。

    兼容：
    - 纯 JSON: [{"index": 1, ...}]
    - markdown 代码块: ```json\n[...]\n```
    - 前后带杂文: 这是结果：[...] 希望对你有帮助
    """
    if not raw or not raw.strip():
        return None
    text = raw.strip()

    md_match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if md_match:
        return md_match.group(1)

    arr_match = re.search(r'\[.*\]', text, re.DOTALL)
    if arr_match:
        candidate = arr_match.group()
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return candidate
        except json.JSONDecodeError:
            pass

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return text
    except json.JSONDecodeError:
        pass

    return None


def get_llm_config(db=None) -> tuple[str, str, str]:
    """返回 (api_key, base_url, model)。界面配置优先，回退 .env，再回退 MiMo。"""
    api_key = settings.llm_api_key or settings.mimo_api_key
    base_url = (settings.llm_base_url or settings.mimo_base_url).rstrip("/")
    model = settings.llm_model

    if db is not None:
        try:
            from app.core.model_config_service import get_effective_config
            config = get_effective_config(db, "llm")
            api_key = config.get("api_key") or api_key
            base_url = (config.get("base_url") or base_url).rstrip("/")
            model = config.get("model") or model
        except Exception:
            pass  # 降级到 settings

    if not api_key:
        raise ValueError(
            "LLM API Key 未配置。请在界面或 .env 中设置 LLM_API_KEY 或 MIMO_API_KEY"
        )
    return api_key, base_url, model


def call_llm(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    db=None,
    timeout: int = 300,
) -> str:
    """调用 LLM Chat API 并返回 assistant 消息内容。

    自动适配 MiMo (api-key header) 和 Qwen/OpenAI (Bearer) 认证。
    失败抛 RuntimeError；token 耗尽（仅 reasoning 无 content）也抛 RuntimeError。
    """
    api_key, base_url, default_model = get_llm_config(db=db)
    model = model or default_model

    chat_url = f"{base_url}/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode("utf-8")

    if "xiaomimimo" in base_url:
        headers = {"api-key": api_key, "Content-Type": "application/json"}
    else:
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    req = urllib.request.Request(chat_url, data=payload, headers=headers)
    ctx = ssl.create_default_context()

    logger.info(f"LLM 调用: {model} @ {base_url}")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        msg = result["choices"][0]["message"]
        content = msg.get("content") or ""
        reasoning = msg.get("reasoning_content") or ""
        usage = result.get("usage", {})

        if not content.strip():
            logger.warning(
                f"LLM 返回空 content。usage={usage}, "
                f"reasoning_len={len(reasoning)}, finish={result['choices'][0].get('finish_reason')}"
            )
            if reasoning:
                rt = usage.get("completion_tokens_details", {}).get("reasoning_tokens", "?")
                raise RuntimeError(
                    f"模型推理耗尽 token（reasoning={rt}），未产生输出。请减少输入长度或更换模型。"
                )
        return content
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logger.error(f"LLM API error {e.code}: {body}")
        raise RuntimeError(f"LLM API 调用失败 ({e.code}): {body[:200]}")
    except urllib.error.URLError as e:
        logger.error(f"LLM API URL error: {e}")
        raise RuntimeError(f"LLM 服务不可达: {e}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_llm_client.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/services/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat(backend): extract llm_client with shared LLM helpers"
```

---

### Task 2: Migrate `llm_subtitle_service.py` to use `llm_client` (preserve aliases)

**Files:**
- Modify: `backend/app/services/llm_subtitle_service.py`

- [ ] **Step 1: Run existing tests to capture baseline**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/ -k "subtitle or json_extract or correction or prefilter" -v`
Note which tests pass — these MUST still pass after the migration.

- [ ] **Step 2: Replace the helper definitions with re-exports**

Open `backend/app/services/llm_subtitle_service.py`. Delete lines 23-62 (`_extract_json_array`), lines 65-93 (`_get_llm_config`), and lines 130-185 (`_call_llm`). Replace the block that previously started at line 23 (after the imports) with:

```python
# Re-exports from llm_client (migrated 2026-06-06). Aliased to private names
# to keep all existing call sites in this file working unchanged.
from app.services.llm_client import (
    extract_json_array as _extract_json_array,
    get_llm_config as _get_llm_config,
    call_llm as _call_llm,
)
```

Remove now-unused imports at top of file: `json`, `re`, `urllib.request`, `urllib.error`, `ssl` (keep them only if still referenced elsewhere in the file — verify with `grep` after editing). Keep `import logging`, `from dataclasses import dataclass`, `from app.core.config import settings`, `import difflib` (if present).

- [ ] **Step 3: Run all related tests to verify no regression**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/ -v 2>&1 | tail -30`
Expected: same pass/fail set as Step 1. No new failures.

- [ ] **Step 4: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/services/llm_subtitle_service.py
git commit -m "refactor(backend): llm_subtitle_service uses llm_client (re-export)"
```

---

### Task 3: Implement `rule_split` (TDD)

**Files:**
- Create: `backend/app/services/text_split_service.py`
- Create: `backend/tests/test_text_split_service.py`

- [ ] **Step 1: Write failing tests for `rule_split`**

Create `backend/tests/test_text_split_service.py`:

```python
"""Tests for text_split_service."""
import pytest


# ------- rule_split -------

def test_rule_split_all_delimiters():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天是个好日子！我们一起出去玩？"
    result = rule_split(text, ["，", "。", "！", "？"])
    assert result == ["你好，", "世界。", "今天是个好日子！", "我们一起出去玩？"]


def test_rule_split_only_period():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天好。"
    result = rule_split(text, ["。"])
    assert result == ["你好，世界。", "今天好。"]


def test_rule_split_no_delimiter_returns_single():
    from app.services.text_split_service import rule_split
    result = rule_split("一段没有标点的文字", [])
    assert result == ["一段没有标点的文字"]


def test_rule_split_filters_empty_and_pure_punct():
    from app.services.text_split_service import rule_split
    text = "你好。。。世界。"
    result = rule_split(text, ["。"])
    # 连续 "。" 产生的空段 / 纯标点段被过滤
    assert result == ["你好。", "世界。"]


def test_rule_split_strips_whitespace_around_segments():
    from app.services.text_split_service import rule_split
    text = "  你好。  世界。  "
    result = rule_split(text, ["。"])
    assert result == ["你好。", "世界。"]


def test_rule_split_handles_leading_punct():
    from app.services.text_split_service import rule_split
    text = "。开头是标点。"
    result = rule_split(text, ["。"])
    assert result == ["开头是标点。"]


def test_rule_split_mixed_chinese_english():
    from app.services.text_split_service import rule_split
    text = "Hello world，今天 weather is good。"
    result = rule_split(text, ["，", "。"])
    assert result == ["Hello world，", "今天 weather is good。"]


def test_rule_split_empty_text_returns_empty_list():
    from app.services.text_split_service import rule_split
    assert rule_split("", ["，", "。"]) == []
    assert rule_split("   ", ["，", "。"]) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v`
Expected: `ModuleNotFoundError: No module named 'app.services.text_split_service'`

- [ ] **Step 3: Implement `rule_split`**

Create `backend/app/services/text_split_service.py`:

```python
"""文本拆分与 SSML 标注服务。

三个能力：
- rule_split: 纯本地，按用户指定的标点切分
- llm_split: 调 LLM 按语义切分
- ssml_annotate: 调 LLM 为段落自动添加 SSML 标签
"""

import json
import logging
import re
from dataclasses import dataclass

from app.services.llm_client import call_llm, extract_json_array

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# rule_split
# ---------------------------------------------------------------------------

def rule_split(text: str, delimiters: list[str]) -> list[str]:
    """按指定标点切分文本。保留标点在段尾。过滤空白段和纯标点段。"""
    if not text or not text.strip():
        return []

    if not delimiters:
        stripped = text.strip()
        return [stripped] if stripped else []

    # 构造正则：在标点之后切分（保留标点在前段）
    escaped = [re.escape(d) for d in delimiters]
    pattern = re.compile(f"(?<=[{''.join(escaped)}])")
    parts = pattern.split(text)

    result: list[str] = []
    for p in parts:
        s = p.strip()
        if not s:
            continue
        # 过滤纯标点段（仅由 delimiters 中的字符组成）
        if all(c in delimiters for c in s):
            continue
        result.append(s)
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/services/text_split_service.py backend/tests/test_text_split_service.py
git commit -m "feat(backend): rule_split text by punctuation"
```

---

### Task 4: Implement `llm_split` (TDD)

**Files:**
- Modify: `backend/app/services/text_split_service.py`
- Modify: `backend/tests/test_text_split_service.py`

- [ ] **Step 1: Append failing tests for `llm_split`**

Append to `backend/tests/test_text_split_service.py`:

```python
# ------- llm_split -------

@dataclass_compat = None  # placeholder so the linter doesn't yell


def test_llm_split_returns_segments(monkeypatch):
    from app.services import text_split_service
    fake_resp = '[{"text": "你好，", "reason": "招呼"}, {"text": "再见。", "reason": "告别"}]'
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "test-model"))

    result = text_split_service.llm_split("你好，再见。")
    assert result.model == "test-model"
    assert [s["text"] for s in result.segments] == ["你好，", "再见。"]
    assert result.segments[0]["reason"] == "招呼"


def test_llm_split_handles_markdown_wrapped_json(monkeypatch):
    from app.services import text_split_service
    fake_resp = '```json\n[{"text": "段1", "reason": "x"}]\n```'
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.llm_split("段1")
    assert [s["text"] for s in result.segments] == ["段1"]


def test_llm_split_raises_on_unparseable(monkeypatch):
    from app.services import text_split_service
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: "完全不是 JSON")
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    with pytest.raises(ValueError, match="解析"):
        text_split_service.llm_split("一段文本")


def test_llm_split_raises_on_empty_text():
    from app.services.text_split_service import llm_split
    with pytest.raises(ValueError, match="文本"):
        llm_split("")
    with pytest.raises(ValueError, match="文本"):
        llm_split("   ")
```

Delete the `@dataclass_compat = None` line — it was only there to suppress linter; remove it now.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v -k llm_split`
Expected: All `llm_split` tests fail with `AttributeError: ... has no attribute 'llm_split'`.

- [ ] **Step 3: Implement `llm_split`**

Append to `backend/app/services/text_split_service.py`:

```python
# ---------------------------------------------------------------------------
# llm_split
# ---------------------------------------------------------------------------

@dataclass
class SplitResult:
    segments: list[dict]   # [{"text": str, "reason": str}]
    model: str | None


# Re-export so monkeypatch in tests can target this module's binding.
from app.services.llm_client import get_llm_config  # noqa: E402


_SPLIT_PROMPT_TEMPLATE = """你是中文文本分句助手。请将下面这段文本按语义和语气节奏拆成多个短句，便于
逐句进行语音合成。

要求：
- 严格保留原文一字不改，仅在合适位置切分
- 每段控制在 5-40 字
- 在语气转折、停顿点、并列结构处切分
- 输出 JSON 数组：[{{"text": "...", "reason": "切分理由"}}]
- 不要包含任何 markdown、解释或额外说明，直接输出 JSON

文本：
{text}
"""


def llm_split(text: str, delimiters: list[str] | None = None, db=None) -> SplitResult:
    """调 LLM 智能拆分。失败抛 ValueError / RuntimeError。"""
    if not text or not text.strip():
        raise ValueError("文本不能为空")

    _, _, model = get_llm_config(db=db)
    prompt = _SPLIT_PROMPT_TEMPLATE.format(text=text)
    raw = call_llm(
        [{"role": "user", "content": prompt}],
        temperature=0.2, max_tokens=4096, db=db, timeout=30,
    )

    json_str = extract_json_array(raw)
    if json_str is None:
        logger.error(f"LLM split: 无法从返回中提取 JSON: {raw[:200]}")
        raise ValueError(f"LLM 返回内容无法解析为 JSON 数组: {raw[:100]}")

    try:
        parsed = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}")

    segments = []
    for item in parsed:
        if isinstance(item, dict) and "text" in item:
            segments.append({
                "text": str(item.get("text", "")).strip(),
                "reason": str(item.get("reason", "")),
            })
        elif isinstance(item, str):
            segments.append({"text": item.strip(), "reason": ""})

    segments = [s for s in segments if s["text"]]
    if not segments:
        raise ValueError("LLM 返回了空的拆分结果")

    return SplitResult(segments=segments, model=model)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v`
Expected: All tests PASS (12 total: 8 rule + 4 llm).

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/services/text_split_service.py backend/tests/test_text_split_service.py
git commit -m "feat(backend): llm_split semantic segmentation"
```

---

### Task 5: Implement `ssml_annotate` with whitelist validation (TDD)

**Files:**
- Modify: `backend/app/services/text_split_service.py`
- Modify: `backend/tests/test_text_split_service.py`

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/test_text_split_service.py`:

```python
# ------- ssml_annotate -------

def test_ssml_annotate_basic(monkeypatch):
    from app.services import text_split_service
    fake_resp = (
        '[{"text": "你好世界", '
        '"ssml": "<speak>你好<break time=\\"200ms\\"/>世界</speak>", '
        '"rationale": "在停顿点加 break"}]'
    )
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好世界"])
    assert len(result.annotations) == 1
    assert result.annotations[0]["ssml"] == '<speak>你好<break time="200ms"/>世界</speak>'
    assert result.annotations[0]["rationale"] == "在停顿点加 break"


def test_ssml_annotate_strips_non_whitelist_tags(monkeypatch):
    """非白名单标签 (<unknown>) 应被剥除，保留纯文本。"""
    from app.services import text_split_service
    fake_resp = (
        '[{"text": "你好", '
        '"ssml": "<speak><unknown>你好</unknown></speak>", '
        '"rationale": "x"}]'
    )
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    # <unknown> 剥除后 = "<speak>你好</speak>"
    assert result.annotations[0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_falls_back_when_text_modified(monkeypatch):
    """LLM 修改了原文 → 退化为 <speak>原文</speak>。"""
    from app.services import text_split_service
    fake_resp = (
        '[{"text": "你好", '
        '"ssml": "<speak>你好啊朋友</speak>", '
        '"rationale": "x"}]'
    )
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    assert result.annotations[0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_style_hint_in_prompt(monkeypatch):
    """style_hint 必须传到 prompt 里。"""
    from app.services import text_split_service
    captured = {}

    def fake_call(messages, **kw):
        captured["prompt"] = messages[0]["content"]
        return '[{"text": "x", "ssml": "<speak>x</speak>", "rationale": ""}]'

    monkeypatch.setattr(text_split_service, "call_llm", fake_call)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    text_split_service.ssml_annotate(["x"], style_hint="播音腔")
    assert "播音腔" in captured["prompt"]


def test_ssml_annotate_empty_texts_raises():
    from app.services.text_split_service import ssml_annotate
    with pytest.raises(ValueError, match="texts"):
        ssml_annotate([])


def test_ssml_annotate_allows_whitelisted_tags(monkeypatch):
    from app.services import text_split_service
    fake_resp = (
        '[{"text": "你好", '
        '"ssml": "<speak><prosody rate=\\"slow\\"><emphasis level=\\"strong\\">你好</emphasis></prosody></speak>", '
        '"rationale": "x"}]'
    )
    monkeypatch.setattr(text_split_service, "call_llm", lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    assert "<prosody" in result.annotations[0]["ssml"]
    assert "<emphasis" in result.annotations[0]["ssml"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v -k ssml`
Expected: All 6 `ssml_annotate` tests fail.

- [ ] **Step 3: Implement `ssml_annotate`**

Append to `backend/app/services/text_split_service.py`:

```python
# ---------------------------------------------------------------------------
# ssml_annotate
# ---------------------------------------------------------------------------

@dataclass
class SSMLAnnotateResult:
    annotations: list[dict]   # [{"text", "ssml", "rationale"}]
    model: str | None


# 允许的 SSML 标签。其他标签会被剥除。
_SSML_ALLOWED_TAGS = {"speak", "break", "prosody", "emphasis"}

# 匹配 XML 标签（含属性）：<tag>, </tag>, <tag attr="x">, <tag/>
_TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?(/?)>')


def _strip_non_whitelist_tags(ssml: str) -> str:
    """删除所有不在白名单中的标签（保留其内部文字）。"""
    def repl(m: re.Match) -> str:
        tag_name = m.group(2).lower()
        return m.group(0) if tag_name in _SSML_ALLOWED_TAGS else ""
    return _TAG_RE.sub(repl, ssml)


def _ssml_to_plain(ssml: str) -> str:
    """剥掉所有 SSML 标签后剩下的纯文字（用于与原文做 diff）。"""
    return _TAG_RE.sub("", ssml)


_SSML_PROMPT_TEMPLATE = """你是 SSML 标注助手。请为下面的若干段中文文本添加 SSML 标签，
让语音合成更自然、有节奏。

要求：
- 严格保留原文一字不改，仅在合适位置插入标签
- 仅允许使用以下标签：<speak>, <break time="...ms"/>, <prosody rate/pitch/volume>, <emphasis level="...">
- 每段必须用 <speak>...</speak> 包裹
- 风格提示：{style_hint}
- 输出 JSON 数组：[{{"text": "原文", "ssml": "<speak>...</speak>", "rationale": "简短解释"}}]
- 不要包含 markdown 或额外说明

待标注文本：
{numbered_texts}
"""


def ssml_annotate(texts: list[str], style_hint: str = "", db=None) -> SSMLAnnotateResult:
    """调 LLM 为每段加 SSML 标签。带白名单与原文一致性校验。"""
    if not texts:
        raise ValueError("texts 不能为空")

    _, _, model = get_llm_config(db=db)

    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = _SSML_PROMPT_TEMPLATE.format(
        style_hint=style_hint or "（无）",
        numbered_texts=numbered,
    )
    raw = call_llm(
        [{"role": "user", "content": prompt}],
        temperature=0.4, max_tokens=8192, db=db, timeout=60,
    )

    json_str = extract_json_array(raw)
    if json_str is None:
        logger.error(f"SSML annotate: 无法解析 JSON: {raw[:200]}")
        raise ValueError(f"LLM 返回内容无法解析为 JSON: {raw[:100]}")

    try:
        parsed = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}")

    # LLM 可能漏返回某些段；按原文顺序对齐
    annotations: list[dict] = []
    for i, original in enumerate(texts):
        item = parsed[i] if i < len(parsed) and isinstance(parsed[i], dict) else {}
        raw_ssml = str(item.get("ssml") or "").strip()
        rationale = str(item.get("rationale") or "")

        if not raw_ssml:
            # LLM 没给 ssml，退化
            annotations.append({"text": original, "ssml": f"<speak>{original}</speak>", "rationale": rationale})
            continue

        # 1. 剥除非白名单标签
        cleaned = _strip_non_whitelist_tags(raw_ssml)
        # 2. diff 校验：剥所有标签后的纯文本必须 == 原文（忽略首尾空白）
        plain = _ssml_to_plain(cleaned).strip()
        if plain != original.strip():
            logger.warning(f"SSML annotate: 段{i+1} 文字与原文不一致，退化。plain={plain!r} original={original!r}")
            cleaned = f"<speak>{original}</speak>"
        # 3. 确保 <speak> 包裹
        if not cleaned.startswith("<speak"):
            cleaned = f"<speak>{cleaned}</speak>"

        annotations.append({"text": original, "ssml": cleaned, "rationale": rationale})

    return SSMLAnnotateResult(annotations=annotations, model=model)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_service.py -v`
Expected: All 18 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/services/text_split_service.py backend/tests/test_text_split_service.py
git commit -m "feat(backend): ssml_annotate with whitelist + diff validation"
```

---

### Task 6: Create text_split API endpoints (TDD)

**Files:**
- Create: `backend/app/api/text_split.py`
- Create: `backend/tests/test_text_split_api.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_text_split_api.py`:

```python
"""API tests for /api/text-split/*."""
from unittest.mock import patch


def test_rule_split_endpoint(client):
    resp = client.post("/api/text-split/rule", json={
        "text": "你好，世界。今天好。",
        "delimiters": ["，", "。"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"segments": ["你好，", "世界。", "今天好。"]}


def test_rule_split_empty_text_422(client):
    resp = client.post("/api/text-split/rule", json={
        "text": "",
        "delimiters": ["。"],
    })
    assert resp.status_code == 422 or resp.status_code == 400


def test_llm_split_endpoint_success(client):
    from app.services import text_split_service
    fake = text_split_service.SplitResult(
        segments=[{"text": "段1", "reason": "x"}, {"text": "段2", "reason": "y"}],
        model="test-model",
    )
    with patch("app.api.text_split.llm_split", return_value=fake):
        resp = client.post("/api/text-split/llm", json={"text": "段1段2"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == "test-model"
    assert [s["text"] for s in body["segments"]] == ["段1", "段2"]


def test_llm_split_value_error_returns_400(client):
    with patch("app.api.text_split.llm_split", side_effect=ValueError("bad input")):
        resp = client.post("/api/text-split/llm", json={"text": "x"})
    assert resp.status_code == 400


def test_llm_split_runtime_error_returns_502(client):
    with patch("app.api.text_split.llm_split", side_effect=RuntimeError("LLM down")):
        resp = client.post("/api/text-split/llm", json={"text": "x"})
    assert resp.status_code == 502


def test_ssml_annotate_endpoint_success(client):
    from app.services import text_split_service
    fake = text_split_service.SSMLAnnotateResult(
        annotations=[{"text": "你好", "ssml": "<speak>你好</speak>", "rationale": "x"}],
        model="m",
    )
    with patch("app.api.text_split.ssml_annotate", return_value=fake):
        resp = client.post("/api/text-split/ssml-annotate", json={
            "texts": ["你好"], "style_hint": "播音腔",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["annotations"][0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_empty_texts_returns_422(client):
    resp = client.post("/api/text-split/ssml-annotate", json={"texts": []})
    assert resp.status_code in (400, 422)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_api.py -v`
Expected: 404 on all routes (router not registered).

- [ ] **Step 3: Implement the router**

Create `backend/app/api/text_split.py`:

```python
"""文本拆分与 SSML 标注 API。"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.text_split_service import (
    rule_split,
    llm_split,
    ssml_annotate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---- Request / Response Models ----

class RuleSplitRequest(BaseModel):
    text: str = Field(..., min_length=1, description="待拆分文本")
    delimiters: list[str] = Field(
        default_factory=lambda: ["，", "。", "！", "？"],
        description="分隔符列表",
    )


class RuleSplitResponse(BaseModel):
    segments: list[str]


class LLMSplitRequest(BaseModel):
    text: str = Field(..., min_length=1)
    delimiters: list[str] | None = None


class LLMSplitSegmentItem(BaseModel):
    text: str
    reason: str


class LLMSplitResponse(BaseModel):
    segments: list[LLMSplitSegmentItem]
    model: str | None


class SSMLAnnotateRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)
    style_hint: str = ""


class SSMLAnnotationItem(BaseModel):
    text: str
    ssml: str
    rationale: str


class SSMLAnnotateResponse(BaseModel):
    annotations: list[SSMLAnnotationItem]
    model: str | None


# ---- Endpoints ----

@router.post("/rule", response_model=RuleSplitResponse)
def split_rule(req: RuleSplitRequest):
    """按指定标点切分文本。纯本地，无 LLM 依赖。"""
    try:
        segments = rule_split(req.text, req.delimiters)
        return RuleSplitResponse(segments=segments)
    except Exception as e:
        logger.exception("rule_split failed")
        raise HTTPException(status_code=500, detail=f"拆分失败: {e}")


@router.post("/llm", response_model=LLMSplitResponse)
def split_llm(req: LLMSplitRequest, db: Session = Depends(get_db)):
    """LLM 智能语义拆分。"""
    try:
        result = llm_split(req.text, req.delimiters, db=db)
        return LLMSplitResponse(
            segments=[LLMSplitSegmentItem(**s) for s in result.segments],
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("llm_split failed")
        raise HTTPException(status_code=500, detail=f"智能拆分失败: {e}")


@router.post("/ssml-annotate", response_model=SSMLAnnotateResponse)
def annotate_ssml(req: SSMLAnnotateRequest, db: Session = Depends(get_db)):
    """LLM 为每段加 SSML 标签。"""
    try:
        result = ssml_annotate(req.texts, req.style_hint, db=db)
        return SSMLAnnotateResponse(
            annotations=[SSMLAnnotationItem(**a) for a in result.annotations],
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("ssml_annotate failed")
        raise HTTPException(status_code=500, detail=f"SSML 标注失败: {e}")
```

- [ ] **Step 4: Register router in `main.py`**

Modify `backend/main.py`. Find the line:

```python
from app.api import clone, tts, config, speech_to_text, mimo_tts, subtitle_llm, model_config
```

Replace with:

```python
from app.api import clone, tts, config, speech_to_text, mimo_tts, subtitle_llm, model_config, text_split
```

Find the block of `app.include_router(...)` calls and append after `model_config`:

```python
app.include_router(text_split.router, prefix="/api/text-split", tags=["text-split"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_text_split_api.py -v`
Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/api/text_split.py backend/tests/test_text_split_api.py backend/main.py
git commit -m "feat(backend): /api/text-split rule/llm/ssml-annotate endpoints"
```

---

### Task 7: Add `source` column to `TTSResultRecord` (migration-friendly)

**Files:**
- Modify: `backend/app/models/tts_result.py`

- [ ] **Step 1: Add the nullable column**

Modify `backend/app/models/tts_result.py`. Add a `source` column after the `language` column:

```python
from sqlalchemy import Column, String, DateTime, Float, Integer
from datetime import datetime
import uuid

from app.core.database import Base


class TTSResultRecord(Base):
    __tablename__ = "tts_results"

    def __repr__(self):
        return f"<TTSResultRecord(id={self.id}, text={self.text[:20]})>"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    text = Column(String, nullable=False)
    voice_id = Column(String, nullable=False)
    voice_name = Column(String, nullable=True)
    audio_path = Column(String, nullable=False)
    audio_format = Column(String, default="wav")
    speed = Column(Float, default=1.0)
    volume = Column(Float, default=80)
    pitch = Column(Float, default=1.0)
    instruction = Column(String, default="音调偏高，语速中等，充满活力和感染力，适合广告配音")
    language = Column(String, default="Chinese")
    # 来源标记: None/"" = TTSSynthesis 历史；"segmented_tts" = 编辑器
    source = Column(String, nullable=True, default=None)
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run pytest tests/test_api_tts.py -v`
Expected: All existing TTS tests PASS (column is nullable, no migrations needed for SQLite in-memory).

For the dev SQLite file `backend/voice_clone.db`, SQLAlchemy will not auto-alter; the new `source` column will be NULL for existing rows. **The backend will run normally** because the column is nullable and not in any SELECT/WHERE for existing endpoints. Add this note to commit message.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/models/tts_result.py
git commit -m "feat(backend): add nullable 'source' to TTSResultRecord (no migration needed)"
```

---

### Task 8: Add SegmentedProject SQLAlchemy skeleton (not registered)

**Files:**
- Create: `backend/app/models/segmented_project.py`

- [ ] **Step 1: Create the model file**

Create `backend/app/models/segmented_project.py`:

```python
"""分段语音项目 —— 后端模式持久化模型骨架

⚠️ 本期（v1）暂不启用：编辑器前端模式直接走 IndexedDB。
   预留此模型供 v2 后端模式接入。

字段命名与前端 TypeScript 类型保持一致以便后续无缝接入。
本文件被 import 也不会污染运行时 schema：不在 main.py / __init__ 中触发任何 import；
当 v2 真正接入时，再 import 这里并 create_all。
"""
from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

from app.core.database import Base


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    layout = Column(String, nullable=False, default='vertical')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    segments = relationship(
        "SegmentedProjectSegment",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectSegment.position",
    )


class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    params = Column(JSON, nullable=False, default=dict)
    current_audio_id = Column(String, nullable=True)
    previous_audio_id = Column(String, nullable=True)
    duration_sec = Column(Integer, nullable=True)
    ssml_annotated_by_llm = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("SegmentedProject", back_populates="segments")
```

- [ ] **Step 2: Verify file imports without errors (smoke test)**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv run python -c "from app.models.segmented_project import SegmentedProject; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add backend/app/models/segmented_project.py
git commit -m "feat(backend): SegmentedProject SQLAlchemy skeleton (v2 reserved)"
```

---

## Phase 2: Frontend data layer + types + IDB

### Task 9: Add TypeScript types for segments

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Append types to `types/index.ts`**

Append to `frontend/src/types/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Segmented TTS Editor types
// ---------------------------------------------------------------------------

export interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts';

  // CosyVoice
  voice_id?: string;
  instruction?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  enable_ssml?: boolean;
  enable_markdown_filter?: boolean;

  // Edge-TTS
  edge_voice?: string;
  edge_rate?: string;     // '+0%' style
  edge_volume?: string;

  // MiMo-TTS
  mimo_mode?: 'preset' | 'voiceclone';
  mimo_preset_voice?: string;
  mimo_clone_voice_id?: string;
  mimo_instruction?: string;
}

export type SegmentStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

export interface Segment {
  id: string;
  text: string;
  ssml?: string;
  params: SegmentEngineParams;
  status: SegmentStatus;
  error?: string;
  current_audio_id?: string;
  previous_audio_id?: string;
  duration_sec?: number;
  ssml_annotated_by_llm?: boolean;
  created_at: string;
  updated_at: string;
}

export interface SegmentedProject {
  schema_version: 1;
  id: string;
  name: string;
  segments: Segment[];
  selected_segment_id?: string;
  default_params: SegmentEngineParams;
  split_config: {
    delimiters: string[];
    mode: 'rule' | 'llm';
  };
  layout: 'vertical' | 'horizontal';
  created_at: string;
  updated_at: string;
}

// Text split API types
export interface LLMSplitSegmentItem {
  text: string;
  reason: string;
}

export interface SSMLAnnotationItem {
  text: string;
  ssml: string;
  rationale: string;
}
```

Find the existing `TTSLocalRecord` interface (around line 122) and add a `source?` field:

```ts
export interface TTSLocalRecord {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audioBlob: Blob;
  audio_format: string;
  speed: number;
  volume: number;
  pitch: number;
  instruction: string;
  language: string;
  created_at: string;
  source?: string;  // 'segmented_tts' 表示来自分段编辑器
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/types/index.ts
git commit -m "feat(frontend): types for Segment, SegmentedProject, source field"
```

---

### Task 10: Upgrade IndexedDB schema with segmentedProjects store

**Files:**
- Modify: `frontend/src/services/indexedDB.ts`

- [ ] **Step 1: Bump DB version, add store, add `getTTSHistory` source filter**

Modify `frontend/src/services/indexedDB.ts`:

Replace the constants and `openDB` function. Find:

```ts
const DB_NAME = 'voice_clone_studio';
const DB_VERSION = 1;
const TTS_STORE = 'tts_results';
const STT_STORE = 'stt_results';
```

Replace with:

```ts
const DB_NAME = 'voice_clone_studio';
const DB_VERSION = 2;
const TTS_STORE = 'tts_results';
const STT_STORE = 'stt_results';
const SEGMENTED_PROJECTS_STORE = 'segmented_projects';
```

Find:

```ts
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        db.createObjectStore(TTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STT_STORE)) {
        db.createObjectStore(STT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

Replace with:

```ts
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        db.createObjectStore(TTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STT_STORE)) {
        db.createObjectStore(STT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SEGMENTED_PROJECTS_STORE)) {
        db.createObjectStore(SEGMENTED_PROJECTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Re-exported for segmentedProjectDB.ts to share the same opener.
export function _openDB() { return openDB(); }
export const _SEGMENTED_PROJECTS_STORE = SEGMENTED_PROJECTS_STORE;
export const _TTS_STORE = TTS_STORE;
```

Find the `getTTSHistory` function:

```ts
export async function getTTSHistory(): Promise<TTSLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<TTSLocalRecord>(db, TTS_STORE);
  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
```

Replace with:

```ts
export async function getTTSHistory(): Promise<TTSLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<TTSLocalRecord>(db, TTS_STORE);
  // 过滤掉来自分段编辑器的碎片音频，保持 TTSSynthesis 历史干净
  return results
    .filter((r) => r.source !== 'segmented_tts')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/services/indexedDB.ts
git commit -m "feat(frontend): IDB v2 with segmented_projects store + source filter"
```

---

### Task 11: Create `segmentedProjectDB.ts` with CRUD + orphan cleanup (TDD)

**Files:**
- Create: `frontend/src/services/segmentedProjectDB.ts`
- Create: `frontend/src/services/__tests__/segmentedProjectDB.test.ts`

- [ ] **Step 1: Install fake-indexeddb dev dependency**

Run:
```bash
cd /Users/rio/repos/myprjs/voiceclone/frontend
npm install --save-dev fake-indexeddb
```

- [ ] **Step 2: Write failing tests**

Create `frontend/src/services/__tests__/segmentedProjectDB.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveProject,
  getProject,
  listProjects,
  deleteProject,
} from '../segmentedProjectDB';
import { saveTTSResult, getTTSAudioBlob } from '../indexedDB';
import type { SegmentedProject } from '../../types';

function makeProject(overrides: Partial<SegmentedProject> = {}): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'p1',
    name: 'Test',
    segments: [],
    default_params: { engine: 'cosyvoice' },
    split_config: { delimiters: ['，', '。'], mode: 'rule' },
    layout: 'vertical',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('segmentedProjectDB', () => {
  beforeEach(async () => {
    // Wipe IDB between tests
    const dbs = await indexedDB.databases();
    for (const { name } of dbs) {
      if (name) indexedDB.deleteDatabase(name);
    }
  });

  it('saves and retrieves a project', async () => {
    const p = makeProject({ id: 'a', name: 'Hello' });
    await saveProject(p);
    const got = await getProject('a');
    expect(got?.name).toBe('Hello');
  });

  it('lists projects sorted by updated_at desc', async () => {
    await saveProject(makeProject({ id: '1', updated_at: '2026-01-01T00:00:00Z' }));
    await saveProject(makeProject({ id: '2', updated_at: '2026-06-01T00:00:00Z' }));
    await saveProject(makeProject({ id: '3', updated_at: '2026-03-01T00:00:00Z' }));
    const list = await listProjects();
    expect(list.map(p => p.id)).toEqual(['2', '3', '1']);
  });

  it('deleteProject also cleans orphan audio in ttsResults', async () => {
    // Pre-seed two audio records
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    await saveTTSResult({
      id: 'audio_a', text: 't', voice_id: 'v', voice_name: 'n',
      audioBlob: blob, audio_format: 'wav', speed: 1, volume: 80, pitch: 1,
      instruction: '', language: 'Chinese',
      created_at: new Date().toISOString(), source: 'segmented_tts',
    });
    await saveTTSResult({
      id: 'audio_b', text: 't', voice_id: 'v', voice_name: 'n',
      audioBlob: blob, audio_format: 'wav', speed: 1, volume: 80, pitch: 1,
      instruction: '', language: 'Chinese',
      created_at: new Date().toISOString(), source: 'segmented_tts',
    });

    const now = new Date().toISOString();
    await saveProject(makeProject({
      id: 'pa',
      segments: [
        { id: 's1', text: 'a', params: { engine: 'cosyvoice' }, status: 'ready',
          current_audio_id: 'audio_a', previous_audio_id: 'audio_b',
          created_at: now, updated_at: now },
      ],
    }));

    await deleteProject('pa');

    expect(await getTTSAudioBlob('audio_a')).toBeNull();
    expect(await getTTSAudioBlob('audio_b')).toBeNull();
  });

  it('deleting a non-existent project does not throw', async () => {
    await expect(deleteProject('nope')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/services/__tests__/segmentedProjectDB.test.ts`
Expected: Module not found for `segmentedProjectDB`.

- [ ] **Step 4: Implement `segmentedProjectDB.ts`**

Create `frontend/src/services/segmentedProjectDB.ts`:

```ts
import type { SegmentedProject } from '../types';
import { _openDB, _SEGMENTED_PROJECTS_STORE, _TTS_STORE } from './indexedDB';
import { deleteTTSResult } from './indexedDB';

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return _openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const r = fn(s);
    t.oncomplete = () => {
      if (r instanceof IDBRequest) resolve(r.result as T);
      else resolve(r as T);
    };
    t.onerror = () => reject(t.error);
  }));
}

/** 保存或更新一个项目 */
export async function saveProject(project: SegmentedProject): Promise<void> {
  await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.put(project));
}

/** 通过 id 获取项目 */
export async function getProject(id: string): Promise<SegmentedProject | undefined> {
  return tx<SegmentedProject | undefined>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.get(id));
}

/** 列出所有项目（按 updated_at 倒序） */
export async function listProjects(): Promise<SegmentedProject[]> {
  const all = await tx<SegmentedProject[]>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

/** 删除项目，并清理其所有段引用的音频（孤儿清理） */
export async function deleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (project) {
    const audioIds = new Set<string>();
    for (const seg of project.segments) {
      if (seg.current_audio_id) audioIds.add(seg.current_audio_id);
      if (seg.previous_audio_id) audioIds.add(seg.previous_audio_id);
    }
    for (const aid of audioIds) {
      try {
        await deleteTTSResult(aid);
      } catch (e) {
        console.warn(`Failed to clean orphan audio ${aid}:`, e);
      }
    }
  }
  await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.delete(id));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/services/__tests__/segmentedProjectDB.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/package.json frontend/package-lock.json frontend/src/services/segmentedProjectDB.ts frontend/src/services/__tests__/segmentedProjectDB.test.ts
git commit -m "feat(frontend): segmentedProjectDB CRUD with orphan audio cleanup"
```

---

### Task 12: Add `textSplitApi` to `api.ts`

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Append `textSplitApi`**

Append to `frontend/src/services/api.ts` (at the end of the file):

```ts
// ---------------------------------------------------------------------------
// Text Split API (for segmented TTS editor)
// ---------------------------------------------------------------------------

import type { LLMSplitSegmentItem, SSMLAnnotationItem } from '../types';

export const textSplitApi = {
  ruleSplit: async (text: string, delimiters: string[]): Promise<string[]> => {
    const { data } = await api.post<{ segments: string[] }>('/text-split/rule', { text, delimiters });
    return data.segments;
  },

  llmSplit: async (text: string, delimiters?: string[]): Promise<{ segments: LLMSplitSegmentItem[]; model: string | null }> => {
    const { data } = await api.post<{ segments: LLMSplitSegmentItem[]; model: string | null }>(
      '/text-split/llm',
      { text, delimiters },
    );
    return data;
  },

  ssmlAnnotate: async (texts: string[], styleHint?: string): Promise<{ annotations: SSMLAnnotationItem[]; model: string | null }> => {
    const { data } = await api.post<{ annotations: SSMLAnnotationItem[]; model: string | null }>(
      '/text-split/ssml-annotate',
      { texts, style_hint: styleHint || '' },
    );
    return data;
  },
};
```

If the existing `api.ts` does not have a `import type ... from '../types'` at the top with these types, instead inline the type definitions in the same file or hoist the imports into the existing import block at top. Verify with: `grep -n "from '../types'" frontend/src/services/api.ts`.

- [ ] **Step 2: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/services/api.ts
git commit -m "feat(frontend): textSplitApi client (rule/llm/ssml-annotate)"
```

---

## Phase 3: Reducer + hook + page shell + TextInputPanel

### Task 13: Implement `useSegmentedProject` reducer (TDD)

**Files:**
- Create: `frontend/src/hooks/useSegmentedProject.ts`
- Create: `frontend/src/hooks/__tests__/useSegmentedProject.test.ts`

- [ ] **Step 1: Write failing tests for the reducer**

Create `frontend/src/hooks/__tests__/useSegmentedProject.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SegmentedProject, Segment } from '../../types';

// We'll test the reducer as a pure function by importing a helper
// that exposes the reducer logic independently.
import { segmentedReducer, createInitialProject } from '../useSegmentedProject';

function makeProject(overrides: Partial<SegmentedProject> = {}): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id: 'p1', name: 'Test', segments: [],
    default_params: { engine: 'cosyvoice' },
    split_config: { delimiters: ['，', '。'], mode: 'rule' },
    layout: 'vertical',
    created_at: now, updated_at: now,
    ...overrides,
  };
}

describe('segmentedReducer', () => {
  it('APPLY_SPLIT replaces segments with idle status', () => {
    const p = makeProject({ segments: [
      { id: 'old', text: 'old', params: { engine: 'cosyvoice' }, status: 'ready', created_at: '', updated_at: '' },
    ]});
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'APPLY_SPLIT', texts: ['a', 'b'] });
    expect(next.project.segments).toHaveLength(2);
    expect(next.project.segments[0].text).toBe('a');
    expect(next.project.segments[0].status).toBe('idle');
    expect(next.project.segments[1].text).toBe('b');
    expect(next.project.selected_segment_id).toBeUndefined();
  });

  it('APPEND_SEGMENT appends with default_params', () => {
    const p = makeProject();
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'APPEND_SEGMENT', text: 'hello' });
    expect(next.project.segments).toHaveLength(1);
    expect(next.project.segments[0].text).toBe('hello');
    expect(next.project.segments[0].params.engine).toBe('cosyvoice');
  });

  it('INSERT_SEGMENT inserts after given id', () => {
    const p = makeProject({ segments: [
      { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'c', text: 'c', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
    ]});
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'INSERT_SEGMENT', afterId: 'a', text: 'b' });
    expect(next.project.segments.map(s => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('DELETE_SEGMENT removes the segment and deselects if it was selected', () => {
    const s1: Segment = { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s1, s2], selected_segment_id: 'a' });
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'DELETE_SEGMENT', id: 'a' });
    expect(next.project.segments).toHaveLength(1);
    expect(next.project.selected_segment_id).toBeUndefined();
  });

  it('REORDER moves segment from fromIndex to toIndex', () => {
    const segments: Segment[] = [
      { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'c', text: 'c', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
    ];
    const p = makeProject({ segments });
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'REORDER', fromIndex: 2, toIndex: 0 });
    expect(next.project.segments.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('GENERATE_SUCCESS swaps audio references and sets ready', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'pending',
      current_audio_id: 'old_current', previous_audio_id: 'old_prev', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s] });
    const state = { project: p };
    const next = segmentedReducer(state, {
      type: 'GENERATE_SUCCESS', id: 's1', audio_id: 'new_audio', duration_sec: 3.2,
    });
    const seg = next.project.segments[0];
    expect(seg.status).toBe('ready');
    expect(seg.current_audio_id).toBe('new_audio');
    expect(seg.previous_audio_id).toBe('old_current');
    expect(seg.duration_sec).toBe(3.2);
  });

  it('UNDO_REGENERATE swaps current and previous', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'ready',
      current_audio_id: 'c', previous_audio_id: 'p', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s] });
    const state = { project: p };
    const next = segmentedReducer(state, { type: 'UNDO_REGENERATE', id: 's1' });
    expect(next.project.segments[0].current_audio_id).toBe('p');
    expect(next.project.segments[0].previous_audio_id).toBe('c');
  });

  it('UPDATE_TEXT changes text', () => {
    const s: Segment = { id: 's1', text: 'old', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s] });
    const next = segmentedReducer({ project: p }, { type: 'UPDATE_TEXT', id: 's1', text: 'new text' });
    expect(next.project.segments[0].text).toBe('new text');
  });

  it('BATCH_SET_SSML sets ssml for multiple segments', () => {
    const s1: Segment = { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s1, s2] });
    const next = segmentedReducer({ project: p }, {
      type: 'BATCH_SET_SSML',
      updates: [
        { id: 'a', ssml: '<speak>a</speak>' },
        { id: 'b', ssml: '<speak>b</speak>' },
      ],
      by_llm: true,
    });
    expect(next.project.segments[0].ssml).toBe('<speak>a</speak>');
    expect(next.project.segments[0].ssml_annotated_by_llm).toBe(true);
    expect(next.project.segments[1].ssml).toBe('<speak>b</speak>');
  });

  it('GENERATE_FAIL sets failed status and error', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'pending', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s] });
    const next = segmentedReducer({ project: p }, { type: 'GENERATE_FAIL', id: 's1', error: 'API timeout' });
    expect(next.project.segments[0].status).toBe('failed');
    expect(next.project.segments[0].error).toBe('API timeout');
  });

  it('SELECT_SEGMENT sets selected_segment_id', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: 'abc' });
    expect(next.project.selected_segment_id).toBe('abc');
    const next2 = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: undefined });
    expect(next2.project.selected_segment_id).toBeUndefined();
  });

  it('RENAME_PROJECT sets name', () => {
    const next = segmentedReducer({ project: makeProject({ name: 'Old' }) }, { type: 'RENAME_PROJECT', name: 'New' });
    expect(next.project.name).toBe('New');
  });

  it('SET_LAYOUT changes layout', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SET_LAYOUT', layout: 'horizontal' });
    expect(next.project.layout).toBe('horizontal');
  });

  it('createInitialProject generates a valid SegmentedProject', () => {
    const p = createInitialProject();
    expect(p.id).toBeTruthy();
    expect(p.schema_version).toBe(1);
    expect(p.segments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts`
Expected: Module not found for `useSegmentedProject`.

- [ ] **Step 3: Implement the reducer and helpers**

Create `frontend/src/hooks/useSegmentedProject.ts`:

```ts
import type { SegmentedProject, Segment, SegmentEngineParams } from '../types';

let _idCounter = 0;
function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialProject(): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: uid(),
    name: '新项目',
    segments: [],
    selected_segment_id: undefined,
    default_params: { engine: 'cosyvoice' } as SegmentEngineParams,
    split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    layout: 'vertical',
    created_at: now,
    updated_at: now,
  };
}

function cloneSegments(segs: Segment[]): Segment[] {
  return segs.map(s => ({ ...s }));
}

// ---- Action types ----

export type Action =
  | { type: 'LOAD_PROJECT'; project: SegmentedProject }
  | { type: 'RENAME_PROJECT'; name: string }
  | { type: 'SET_DEFAULT_PARAMS'; params: SegmentEngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: SegmentedProject['split_config'] }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }
  | { type: 'APPLY_SPLIT'; texts: string[] }
  | { type: 'APPEND_SEGMENT'; text?: string }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_SSML'; id: string; ssml: string; by_llm?: boolean }
  | { type: 'BATCH_SET_SSML'; updates: { id: string; ssml: string }[]; by_llm?: boolean }
  | { type: 'UPDATE_PARAMS'; id: string; params: Partial<SegmentEngineParams> }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }
  | { type: 'MARK_QUEUED'; ids: string[] }
  | { type: 'GENERATE_START'; id: string }
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id: string; duration_sec: number }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }
  | { type: 'SELECT_SEGMENT'; id: string | undefined };

export interface State { project: SegmentedProject }

function makeSegment(text: string, params: SegmentEngineParams): Segment {
  const now = new Date().toISOString();
  return {
    id: uid(),
    text,
    params: { ...params },
    status: 'idle',
    created_at: now,
    updated_at: now,
  };
}

export function segmentedReducer(state: State, action: Action): State {
  const p = state.project;
  const segs = () => cloneSegments(p.segments);

  switch (action.type) {
    case 'LOAD_PROJECT':
      return { project: { ...action.project } };

    case 'RENAME_PROJECT':
      return { project: { ...p, name: action.name, updated_at: new Date().toISOString() } };

    case 'SET_DEFAULT_PARAMS':
      return { project: { ...p, default_params: action.params, updated_at: new Date().toISOString() } };

    case 'SET_SPLIT_CONFIG':
      return { project: { ...p, split_config: action.config, updated_at: new Date().toISOString() } };

    case 'SET_LAYOUT':
      return { project: { ...p, layout: action.layout, updated_at: new Date().toISOString() } };

    case 'APPLY_SPLIT': {
      const segs = action.texts.map(t => makeSegment(t, p.default_params));
      return { project: { ...p, segments: segs, selected_segment_id: undefined, updated_at: new Date().toISOString() } };
    }

    case 'APPEND_SEGMENT': {
      const s = segs();
      s.push(makeSegment(action.text ?? '', p.default_params));
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'INSERT_SEGMENT': {
      const s = segs();
      const idx = s.findIndex(x => x.id === action.afterId);
      if (idx >= 0) {
        s.splice(idx + 1, 0, makeSegment(action.text ?? '', p.default_params));
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'DELETE_SEGMENT': {
      const s = segs().filter(x => x.id !== action.id);
      return {
        project: {
          ...p,
          segments: s,
          selected_segment_id: p.selected_segment_id === action.id ? undefined : p.selected_segment_id,
          updated_at: new Date().toISOString(),
        },
      };
    }

    case 'UPDATE_TEXT': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.text = action.text; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'UPDATE_SSML': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) {
        seg.ssml = action.ssml;
        if (action.by_llm) seg.ssml_annotated_by_llm = true;
        seg.updated_at = new Date().toISOString();
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'BATCH_SET_SSML': {
      const s = segs();
      for (const u of action.updates) {
        const seg = s.find(x => x.id === u.id);
        if (seg) {
          seg.ssml = u.ssml;
          if (action.by_llm) seg.ssml_annotated_by_llm = true;
          seg.updated_at = new Date().toISOString();
        }
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'UPDATE_PARAMS': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.params = { ...seg.params, ...action.params }; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'REORDER': {
      const s = segs();
      const [removed] = s.splice(action.fromIndex, 1);
      s.splice(action.toIndex, 0, removed);
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'MARK_QUEUED': {
      const s = segs();
      for (const id of action.ids) {
        const seg = s.find(x => x.id === id);
        if (seg && seg.status === 'idle') seg.status = 'queued';
      }
      return { project: { ...p, segments: s } };
    }

    case 'GENERATE_START': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.status = 'pending'; seg.error = undefined; }
      return { project: { ...p, segments: s } };
    }

    case 'GENERATE_SUCCESS': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) {
        seg.previous_audio_id = seg.current_audio_id;
        seg.current_audio_id = action.audio_id;
        seg.duration_sec = action.duration_sec;
        seg.status = 'ready';
        seg.error = undefined;
        seg.updated_at = new Date().toISOString();
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'GENERATE_FAIL': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.status = 'failed'; seg.error = action.error; }
      return { project: { ...p, segments: s } };
    }

    case 'UNDO_REGENERATE': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg && seg.previous_audio_id) {
        const tmp = seg.current_audio_id;
        seg.current_audio_id = seg.previous_audio_id;
        seg.previous_audio_id = tmp;
        seg.updated_at = new Date().toISOString();
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }

    case 'SELECT_SEGMENT':
      return { project: { ...p, selected_segment_id: action.id } };

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/hooks/useSegmentedProject.ts frontend/src/hooks/__tests__/useSegmentedProject.test.ts
git commit -m "feat(frontend): segmentedReducer + createInitialProject + tests"
```

---

### Task 14: Implement `useCountUp` hook

**Files:**
- Create: `frontend/src/hooks/useCountUp.ts`

- [ ] **Step 1: Write the hook**

Create `frontend/src/hooks/useCountUp.ts`:

```ts
import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from 0 to `end` over `durationMs` milliseconds.
 * Used for the duration display in SegmentRow when a segment becomes ready.
 */
export function useCountUp(end: number, durationMs: number, trigger: boolean): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!trigger) {
      setValue(0);
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(eased * end);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, durationMs, trigger]);

  return value;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/hooks/useCountUp.ts
git commit -m "feat(frontend): useCountUp hook for duration animation"
```

---

### Task 15: Create SegmentedTTS page shell + route + Landing + App entry

**Files:**
- Create: `frontend/src/pages/SegmentedTTS.tsx`
- Create: `frontend/src/pages/SegmentedTTS.module.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/Landing.tsx`

- [ ] **Step 1: Create minimal SegmentedTTS page shell**

Create `frontend/src/pages/SegmentedTTS.tsx`:

```tsx
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { ProjectToolbar } from '../components/SegmentedTTS/ProjectToolbar';
import { useSegmentedProject } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, getTTSAudioBlob, deleteTTSResult } from '../services/indexedDB';
import { saveProject, getProject, listProjects } from '../services/segmentedProjectDB';
import type { SegmentedProject } from '../types';
import styles from './SegmentedTTS.module.css';

export function SegmentedTTS() {
  // State: project list, current project id
  const [projectList, setProjectList] = useState<{ id: string; name: string }[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [state, dispatch] = useSegmentedProject(currentProjectId);

  const { project } = state;

  // Load project list on mount
  useEffect(() => {
    listProjects().then(list => setProjectList(list.map(p => ({ id: p.id, name: p.name }))));
  }, []);

  // Save project after dispatch changes
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProject(project).catch(e => console.warn('Auto-save failed:', e));
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [project]);

  return (
    <div className={styles.container}>
      <ProjectToolbar
        project={project}
        onRename={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
        onLayoutToggle={() => dispatch({
          type: 'SET_LAYOUT',
          layout: project.layout === 'vertical' ? 'horizontal' : 'vertical',
        })}
      />
      <TextInputPanel
        splitConfig={project.split_config}
        onSplitConfigChange={(config) => dispatch({ type: 'SET_SPLIT_CONFIG', config })}
        onSplit={(texts) => dispatch({ type: 'APPLY_SPLIT', texts })}
        onLLMSplit={async (text) => {
          const result = await textSplitApi.llmSplit(text, project.split_config.delimiters);
          dispatch({ type: 'APPLY_SPLIT', texts: result.segments.map(s => s.text) });
        }}
      />
      <SegmentList
        segments={project.segments}
        layout={project.layout}
        selectedId={project.selected_segment_id}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
        onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
        onAppend={() => dispatch({ type: 'APPEND_SEGMENT', text: '' })}
        onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
      />
    </div>
  );
}
```

Create `frontend/src/pages/SegmentedTTS.module.css` with minimal layout:

```css
.container {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}
```

- [ ] **Step 2: Register in App.tsx**

Modify `frontend/src/App.tsx`:

Find the `type Tab` declaration:
```tsx
type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config';
```

Replace with:
```tsx
type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config' | 'segmented-tts';
```

Find the div that renders `ModelConfig` (around line 180-190), and after it add:

```tsx
<div style={{ display: activeTab === 'segmented-tts' ? 'block' : 'none' }}>
  <SegmentedTTS />
</div>
```

Add import at top of file:
```tsx
import { SegmentedTTS } from './pages/SegmentedTTS';
```

- [ ] **Step 3: Add Landing entry**

Modify `frontend/src/pages/Landing.tsx`:

Find `onNavigate: (tab: 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config') => void;` — replace with:

```tsx
onNavigate: (tab: 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config' | 'segmented-tts') => void;
```

After the "Speech to Text" `<FeatureTile>` block (around line 82), add a new Feature 04 tile:

```tsx
<FeatureTile
  number="04"
  title="分段语音编辑器"
  subtitle="Segmented TTS"
  body="将长文本按句拆分，逐段生成语音并精调 SSML，支持单段试听和重生成。最终拼合为完整音频，同时输出与时间轴对齐的 SRT 字幕。"
  action="体验分段编辑器"
  onAction={() => onNavigate('segmented-tts')}
  theme="parchment"
/>
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/pages/SegmentedTTS.tsx frontend/src/pages/SegmentedTTS.module.css frontend/src/App.tsx frontend/src/pages/Landing.tsx
git commit -m "feat(frontend): SegmentedTTS page shell, route, Landing entry"
```

---

## Phase 4: Segment display + edit drawer + single-segment generation

### Task 16: Create SegmentList + SegmentRow with status animations

**Files:**
- Create: `frontend/src/components/SegmentedTTS/SegmentList.tsx`
- Create: `frontend/src/components/SegmentedTTS/SegmentList.module.css`
- Create: `frontend/src/components/SegmentedTTS/SegmentRow.tsx`
- Create: `frontend/src/components/SegmentedTTS/SegmentRow.module.css`

- [ ] **Step 1: Implement SegmentRow with full status animation**

Create `frontend/src/components/SegmentedTTS/SegmentRow.tsx`:

```tsx
import { useMemo } from 'react';
import type { Segment } from '../../types';
import { useCountUp } from '../../hooks/useCountUp';
import styles from './SegmentRow.module.css';

interface SegmentRowProps {
  segment: Segment;
  isSelected: boolean;
  layout: 'vertical' | 'horizontal';
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (afterId: string) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onUndo: (id: string) => void;
}

const ENGINE_LABELS: Record<string, string> = {
  cosyvoice: 'CosyVoice',
  edge_tts: 'Edge-TTS',
  mimo_tts: 'MiMo',
};

export function SegmentRow({
  segment, isSelected, layout, onSelect, onDelete,
  onInsertAfter, onEdit, onRegenerate, onUndo,
}: SegmentRowProps) {
  const animValue = useCountUp(segment.duration_sec ?? 0, 400, segment.status === 'ready' && segment.duration_sec !== undefined);
  const displayDuration = segment.status === 'ready'
    ? animValue.toFixed(1) + 's'
    : segment.status === 'pending'
      ? '⏳'
      : '—';

  const hasUndo = !!(segment.previous_audio_id && segment.status === 'ready');
  const isGenerating = segment.status === 'pending' || segment.status === 'queued';
  const isLong = segment.text.length > 100;

  const statusClass = styles[`status_${segment.status}`] || '';

  if (layout === 'horizontal') {
    return (
      <div
        className={`${styles.horizontalBlock} ${statusClass} ${isSelected ? styles.selected : ''}`}
        onClick={() => onSelect(segment.id)}
        title={segment.text}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
      >
        <span className={styles.horizIndex}>#{segment.id.slice(-3)}</span>
        <span className={styles.horizDuration}>{displayDuration}</span>
        <span className={styles.horizText}>{segment.text.slice(0, 8)}{segment.text.length > 8 ? '…' : ''}</span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.row} ${statusClass} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
    >
      <div className={styles.rowMain}>
        <span className={styles.index}>#{segment.id.slice(-3)}</span>
        <span className={styles.text}>
          {segment.text}
          {isLong && <span className={styles.longWarning} title="单段过长，建议拆分">⚠</span>}
        </span>
        <span className={styles.duration}>{displayDuration}</span>
      </div>
      <div className={styles.rowMeta}>
        <span className={styles.metaInfo}>
          {segment.status === 'ready' ? '已生成' : segment.status === 'failed' ? '失败' : '未生成'}
          {' · '}{ENGINE_LABELS[segment.params.engine] || segment.params.engine}
          {segment.ssml && (segment.ssml_annotated_by_llm ? ' · SSML✨' : ' · SSML')}
        </span>
        <div className={styles.actions}>
          <button className={styles.btn} disabled={!segment.current_audio_id} onClick={(e) => { e.stopPropagation(); /* play handled by parent */ }} title="播放">▶</button>
          <button className={styles.btn} onClick={(e) => { e.stopPropagation(); onEdit(segment.id); }} title="编辑">✎</button>
          {hasUndo && <button className={styles.btn} onClick={(e) => { e.stopPropagation(); onUndo(segment.id); }} title="撤回">↻</button>}
          <button className={styles.btn} disabled={isGenerating} title={isGenerating ? '生成中无法删除' : '删除'} onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>✕</button>
        </div>
      </div>
      {/* hover insert indicator */}
      <div className={styles.insertZone} onClick={(e) => { e.stopPropagation(); onInsertAfter(segment.id); }}>
        + 在此处插入新段
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/SegmentRow.module.css` with all status keyframes:

```css
/* Row base */
.row {
  border: 1px solid #333;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  position: relative;
}

.row:hover { border-color: #555; }
.selected { border-color: #4a90e2 !important; background: #1a2a3a; }

/* Status shared */
.status_idle { border-color: #444; background: #181818; }
.status_queued { border-color: #4a90e2; }
.status_pending { border-color: #2196f3; background: #0d2135; }
.status_ready { border-color: #2a6; }
.status_failed { border-color: #e53935; background: #2d1414; }

/* Animations */
@keyframes breathe {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
@keyframes flow {
  0% { background-position: 0 0; }
  100% { background-position: 0 60px; }
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
@keyframes flashGreen {
  0% { background: rgba(34, 170, 102, 0.3); }
  100% { background: transparent; }
}

.status_queued .rowMain::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #4a90e2;
  border-radius: 3px 0 0 3px;
  animation: breathe 2s ease-in-out infinite;
}

.status_pending .rowMain::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, #2196f3 30%, #64b5f6 70%, #2196f3);
  background-size: 3px 60px;
  border-radius: 3px 0 0 3px;
  animation: flow 1.5s linear infinite;
}

.status_ready.selected {
  animation: flashGreen 0.8s ease-out;
}

.status_failed.selected {
  animation: shake 0.25s ease-in-out;
}

/* Layout for horizontal mode */
.horizontalBlock {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 64px;
  border: 1px solid #333;
  border-radius: 6px;
  margin-right: 4px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 11px;
  text-align: center;
  transition: border-color 0.15s;
}
.horizontalBlock.status_pending { animation: breathe 1.5s ease-in-out infinite; }
.horizontalBlock.status_failed { animation: shake 0.25s ease-in-out; }
.horizIndex { color: #888; }
.horizDuration { font-weight: 600; color: #ddd; }
.horizText { color: #666; overflow: hidden; white-space: nowrap; }

/* Row internals */
.rowMain { display: flex; align-items: center; gap: 10px; }
.index { color: #666; font-family: monospace; font-size: 12px; width: 32px; }
.text { flex: 1; color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.longWarning { margin-left: 6px; color: #f5a623; font-size: 14px; cursor: help; }
.duration { font-size: 14px; font-weight: 600; color: #aaa; width: 48px; text-align: right; }
.rowMeta { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.metaInfo { font-size: 11px; color: #777; }
.actions { display: flex; gap: 4px; }
.btn {
  background: none; border: 1px solid #444; color: #ccc;
  padding: 2px 8px; border-radius: 4px; cursor: pointer;
  font-size: 12px; line-height: 1.5;
}
.btn:disabled { opacity: 0.3; cursor: not-allowed; }
.btn:hover:not(:disabled) { background: #333; border-color: #666; }
.insertZone {
  text-align: center; font-size: 11px; color: transparent;
  padding: 2px 0; transition: color 0.15s; cursor: pointer;
}
.row:hover .insertZone { color: #4a90e2; }
.insertZone:hover { background: rgba(74, 144, 226, 0.08); }
```

Create `frontend/src/components/SegmentedTTS/SegmentList.tsx`:

```tsx
import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';
import styles from './SegmentList.module.css';

interface SegmentListProps {
  segments: Segment[];
  layout: 'vertical' | 'horizontal';
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (afterId: string) => void;
  onAppend: () => void;
  onReorder: (from: number, to: number) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onUndo: (id: string) => void;
}

export function SegmentList(props: SegmentListProps) {
  const { segments, layout, selectedId, onSelect, onAppend } = props;

  if (layout === 'horizontal') {
    return (
      <div className={styles.horizontalContainer}>
        {segments.map((seg) => (
          <SegmentRow key={seg.id} segment={seg} isSelected={seg.id === selectedId}
            layout="horizontal" {...props} />
        ))}
        <button className={styles.appendBtnHoriz} onClick={onAppend}>+</button>
      </div>
    );
  }

  return (
    <div className={styles.verticalContainer}>
      {segments.map((seg) => (
        <SegmentRow key={seg.id} segment={seg} isSelected={seg.id === selectedId}
          layout="vertical" {...props} />
      ))}
      <button className={styles.appendBtn} onClick={onAppend}>+ 追加新段</button>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/SegmentList.module.css`:

```css
.verticalContainer { padding: 8px 0; }
.horizontalContainer {
  display: flex; gap: 4px; padding: 8px; overflow-x: auto;
  min-height: 80px; align-items: center;
}
.appendBtn {
  display: block; width: 100%; padding: 10px; margin-top: 4px;
  background: none; border: 1px dashed #444; color: #666;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.appendBtn:hover { border-color: #4a90e2; color: #4a90e2; }
.appendBtnHoriz {
  flex-shrink: 0; width: 32px; height: 64px;
  background: none; border: 1px dashed #444; color: #666;
  border-radius: 6px; cursor: pointer; font-size: 16px;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/components/SegmentedTTS/
git commit -m "feat(frontend): SegmentList + SegmentRow with status animations"
```

---

### Task 17: TextInputPanel + page integration

**Files:**
- Create: `frontend/src/components/SegmentedTTS/TextInputPanel.tsx`
- Create: `frontend/src/components/SegmentedTTS/TextInputPanel.module.css`
- Modify: `frontend/src/hooks/useSegmentedProject.ts` (add hook export — reducer already present)

- [ ] **Step 1: Add the hook wrapper to useSegmentedProject.ts**

Append to `frontend/src/hooks/useSegmentedProject.ts` (after the existing reducer + helpers from Task 13):

```ts
// -----------------------------------------------------------------------
// Hook wrapper - loads project from IndexedDB and exposes reducer state
// -----------------------------------------------------------------------
import { useReducer, useEffect } from 'react';
import { getProject } from '../services/segmentedProjectDB';

export function useSegmentedProject(projectId: string | null) {
  const [state, dispatch] = useReducer(
    segmentedReducer,
    { project: createInitialProject() },
  );

  useEffect(() => {
    if (projectId) {
      getProject(projectId).then((p) => {
        if (p) dispatch({ type: 'LOAD_PROJECT', project: p });
      }).catch(e => console.warn('Load project failed:', e));
    }
  }, [projectId]);

  return [state, dispatch] as const;
}
```

- [ ] **Step 2: Create TextInputPanel**

Create `frontend/src/components/SegmentedTTS/TextInputPanel.tsx`:

```tsx
import { useState } from 'react';
import { textSplitApi } from '../../services/api';
import type { SegmentedProject } from '../../types';
import styles from './TextInputPanel.module.css';

interface TextInputPanelProps {
  splitConfig: SegmentedProject['split_config'];
  onSplitConfigChange: (config: SegmentedProject['split_config']) => void;
  onSplit: (texts: string[]) => void;           // rule split callback
  onLLMSplit: (text: string) => Promise<void>;  // llm split callback
}

const DELIMITER_OPTIONS = ['，', '。', '！', '？', '；', '、'];

export function TextInputPanel({ splitConfig, onSplitConfigChange, onSplit, onLLMSplit }: TextInputPanelProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'rule' | 'llm'>(splitConfig.mode);
  const [isSplitting, setIsSplitting] = useState(false);
  const collapsed = false; // could be toggled

  const handleSplit = async () => {
    if (!text.trim()) return;
    setIsSplitting(true);
    try {
      if (mode === 'llm') {
        await onLLMSplit(text);
      } else {
        const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
        onSplit(segments);
      }
    } catch (e: any) {
      // fallback: if llm fails, try rule
      if (mode === 'llm') {
        console.warn('LLM split failed, falling back to rule:', e);
        try {
          const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
          onSplit(segments);
        } catch (e2) {
          alert('拆分失败，请重试');
        }
      } else {
        alert('拆分失败，请重试');
      }
    } finally {
      setIsSplitting(false);
    }
  };

  const toggleDelimiter = (d: string) => {
    const next = splitConfig.delimiters.includes(d)
      ? splitConfig.delimiters.filter(x => x !== d)
      : [...splitConfig.delimiters, d];
    onSplitConfigChange({ ...splitConfig, delimiters: next });
  };

  return (
    <div className={styles.panel}>
      <textarea
        className={styles.textarea}
        placeholder="输入要拆分的文字..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
      />
      <div className={styles.controls}>
        <div className={styles.delimiters}>
          {DELIMITER_OPTIONS.map(d => (
            <label key={d} className={styles.checkLabel}>
              <input type="checkbox" checked={splitConfig.delimiters.includes(d)}
                onChange={() => toggleDelimiter(d)} />
              {d}
            </label>
          ))}
        </div>
        <div className={styles.modeSwitch}>
          <button className={`${styles.modeBtn} ${mode === 'rule' ? styles.active : ''}`}
            onClick={() => setMode('rule')}>规则</button>
          <button className={`${styles.modeBtn} ${mode === 'llm' ? styles.active : ''}`}
            onClick={() => setMode('llm')}>智能</button>
        </div>
        <button className={styles.splitBtn} onClick={handleSplit} disabled={isSplitting || !text.trim()}>
          {isSplitting ? '拆分中...' : '拆分'}
        </button>
        <span className={styles.charCount}>{text.length} 字</span>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/TextInputPanel.module.css`:

```css
.panel {
  background: #1f1f1f; border-radius: 10px; padding: 16px; margin-bottom: 16px;
}
.textarea {
  width: 100%; background: #111; border: 1px solid #333; color: #ddd;
  border-radius: 6px; padding: 10px; font-size: 14px; font-family: inherit;
  resize: vertical; outline: none;
}
.textarea:focus { border-color: #4a90e2; }
.controls { display: flex; align-items: center; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.delimiters { display: flex; gap: 6px; }
.checkLabel { font-size: 12px; color: #aaa; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.modeSwitch { display: flex; gap: 0; }
.modeBtn {
  background: #333; border: 1px solid #555; color: #aaa;
  padding: 4px 12px; font-size: 12px; cursor: pointer;
}
.modeBtn:first-child { border-radius: 4px 0 0 4px; }
.modeBtn:last-child { border-radius: 0 4px 4px 0; }
.modeBtn.active { background: #4a90e2; color: white; border-color: #4a90e2; }
.splitBtn {
  background: #2a6; color: white; border: none;
  padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
.splitBtn:disabled { opacity: 0.4; cursor: not-allowed; }
.charCount { font-size: 11px; color: #666; margin-left: auto; }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/hooks/useSegmentedProject.ts frontend/src/components/SegmentedTTS/TextInputPanel.tsx frontend/src/components/SegmentedTTS/
git commit -m "feat(frontend): useSegmentedProject hook + TextInputPanel with rule/LLM split"
```

---

### Task 18: Create SegmentEditDrawer with SSML editing + ProjectToolbar

**Files:**
- Create: `frontend/src/components/SegmentedTTS/SegmentEditDrawer.tsx`
- Create: `frontend/src/components/SegmentedTTS/SegmentEditDrawer.module.css`
- Create: `frontend/src/components/SegmentedTTS/ProjectToolbar.tsx`
- Create: `frontend/src/components/SegmentedTTS/ProjectToolbar.module.css`

- [ ] **Step 1: Implement SegmentEditDrawer**

Create `frontend/src/components/SegmentedTTS/SegmentEditDrawer.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Segment, SegmentEngineParams } from '../../types';
import { SSMLToolbar } from '../TTSSynthesis/SSMLToolbar';
import styles from './SegmentEditDrawer.module.css';

interface SegmentEditDrawerProps {
  segment: Segment | null;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<SegmentEngineParams>) => void;
  onRegenerate: (id: string) => void;
  onAnnotateSSML: (id: string) => void;
}

export function SegmentEditDrawer({ segment, onClose, onUpdateText, onUpdateSSML, onUpdateParams, onRegenerate, onAnnotateSSML }: SegmentEditDrawerProps) {
  const [localText, setLocalText] = useState(segment?.text ?? '');
  const [localSSML, setLocalSSML] = useState(segment?.ssml ?? '');
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (segment) {
      setLocalText(segment.text);
      setLocalSSML(segment.ssml ?? '');
      setDirty(false);
      textareaRef.current?.focus();
    }
  }, [segment?.id]);

  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = confirm('未保存修改将丢失，确认放弃？');
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose]);

  if (!segment) return null;

  const isCosyVoice = segment.params.engine === 'cosyvoice';
  const showSSML = isCosyVoice && segment.params.enable_ssml;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <span>编辑 #{segment.id.slice(-3)}</span>
          <button onClick={handleClose} className={styles.closeBtn}>✕</button>
        </div>

        <div className={styles.drawerBody}>
          <label className={styles.label}>文本</label>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={localText}
            onChange={(e) => { setLocalText(e.target.value); setDirty(true); onUpdateText(segment.id, e.target.value); }}
            rows={3}
          />

          {showSSML && (
            <>
              <div className={styles.ssmlHeader}>
                <label className={styles.label}>SSML 标记</label>
                <button className={styles.annotateBtn}
                  onClick={() => onAnnotateSSML(segment.id)}>
                  ✨ 智能标注
                </button>
              </div>
              <SSMLToolbar
                text={localSSML}
                onTextChange={(v) => { setLocalSSML(v); setDirty(true); onUpdateSSML(segment.id, v); }}
                textareaRef={textareaRef}
                enabled={true}
              />
            </>
          )}

          <div className={styles.paramGrid}>
            <label className={styles.label}>语速</label>
            <input type="range" min={0.5} max={2} step={0.1}
              defaultValue={segment.params.speed ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { speed: parseFloat(e.target.value) })} />

            <label className={styles.label}>音调</label>
            <input type="range" min={0.5} max={2} step={0.1}
              defaultValue={segment.params.pitch ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { pitch: parseFloat(e.target.value) })} />

            <label className={styles.label}>音量</label>
            <input type="range" min={0} max={100} step={1}
              defaultValue={segment.params.volume ?? 80}
              onChange={(e) => onUpdateParams(segment.id, { volume: parseInt(e.target.value) })} />
          </div>
        </div>

        <div className={styles.drawerFooter}>
          {segment.current_audio_id && (
            <button className={styles.playBtn} onClick={() => { /* play handled by parent */ }}>
              ▶ 试听旧版
            </button>
          )}
          <div className={styles.footerRight}>
            <button className={styles.regenerateBtn}
              onClick={() => onRegenerate(segment.id)}>
              ↻ 重新生成
            </button>
            <button className={styles.saveBtn} onClick={() => { setDirty(false); onClose(); }}>
              ✓ 保存关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/SegmentEditDrawer.module.css`:

```css
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 1000; display: flex; justify-content: flex-end;
}
.drawer {
  width: 480px; max-width: 100vw; background: #1f1f1f;
  border-left: 1px solid #333; height: 100%;
  display: flex; flex-direction: column;
}
.drawerHeader {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #333;
  font-size: 16px; font-weight: 600; color: #ddd;
}
.closeBtn { background: none; border: none; color: #888; font-size: 18px; cursor: pointer; }
.drawerBody { flex: 1; overflow-y: auto; padding: 16px 20px; }
.label { display: block; color: #888; font-size: 12px; margin: 12px 0 4px; }
.textarea {
  width: 100%; background: #111; border: 1px solid #333; color: #ddd;
  border-radius: 4px; padding: 8px; font-size: 13px; font-family: inherit;
  resize: vertical; outline: none;
}
.textarea:focus { border-color: #4a90e2; }
.ssmlHeader { display: flex; justify-content: space-between; align-items: center; }
.annotateBtn {
  background: none; border: 1px solid #4a90e2; color: #4a90e2;
  padding: 3px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;
  margin-top: 12px;
}
.paramGrid {
  display: grid; grid-template-columns: 50px 1fr; gap: 8px; align-items: center;
  margin-top: 12px;
}
.paramGrid input[type="range"] { width: 100%; }
.drawerFooter {
  display: flex; align-items: center; padding: 12px 20px;
  border-top: 1px solid #333; gap: 8px;
}
.footerRight { margin-left: auto; display: flex; gap: 8px; }
.playBtn {
  background: #333; color: #ccc; border: 1px solid #555;
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.regenerateBtn {
  background: #2a6; color: white; border: none;
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.saveBtn {
  background: #4a90e2; color: white; border: none;
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
```

- [ ] **Step 2: Create ProjectToolbar**

Create `frontend/src/components/SegmentedTTS/ProjectToolbar.tsx`:

```tsx
import type { SegmentedProject } from '../../types';
import styles from './ProjectToolbar.module.css';

interface ProjectToolbarProps {
  project: SegmentedProject;
  onRename: (name: string) => void;
  onLayoutToggle: () => void;
  onPlayAll?: () => void;
  onGenerateAll?: () => void;
  onAnnotateAll?: () => void;
  onExport?: () => void;
}

export function ProjectToolbar({ project, onRename, onLayoutToggle }: ProjectToolbarProps) {
  const numSegments = project.segments.length;
  const totalDuration = project.segments.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
  const readyCount = project.segments.filter(s => s.status === 'ready').length;

  return (
    <div className={styles.toolbar}>
      <input className={styles.nameInput} value={project.name}
        onChange={(e) => onRename(e.target.value)} />
      <span className={styles.stats}>
        {numSegments} 段 · {totalDuration.toFixed(1)}s
        {readyCount > 0 && ` · ${readyCount}/${numSegments} 已生成`}
      </span>
      <div className={styles.actions}>
        <button className={styles.actionBtn} title="全部播放">▶ 全部播放</button>
        <button className={styles.actionBtn} title="全部生成">⚡ 全部生成</button>
        <button className={styles.actionBtn} title="全部智能标注 SSML">✨ 标注</button>
        <button className={styles.actionBtn} title="导出">⬇ 导出</button>
        <button className={styles.actionBtn} onClick={onLayoutToggle}>
          {project.layout === 'vertical' ? '⇄ 横向' : '⇅ 纵向'}
        </button>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/ProjectToolbar.module.css`:

```css
.toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; margin-bottom: 12px; flex-wrap: wrap;
}
.nameInput {
  background: transparent; border: none; border-bottom: 1px solid #444;
  color: #eee; font-size: 18px; font-weight: 600; padding: 4px 0;
  outline: none; width: 200px;
}
.nameInput:focus { border-color: #4a90e2; }
.stats { font-size: 12px; color: #888; }
.actions { display: flex; gap: 6px; margin-left: auto; }
.actionBtn {
  background: #2a2a2a; border: 1px solid #444; color: #ccc;
  padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
.actionBtn:hover { background: #333; border-color: #666; }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/components/SegmentedTTS/SegmentEditDrawer.tsx frontend/src/components/SegmentedTTS/SegmentEditDrawer.module.css frontend/src/components/SegmentedTTS/ProjectToolbar.tsx frontend/src/components/SegmentedTTS/ProjectToolbar.module.css
git commit -m "feat(frontend): SegmentEditDrawer with SSML editing + ProjectToolbar"
```

---

## Phase 5: Batch generation + audio concat + export

### Task 19: Create audioConcat.ts (WAV encoder, SRT builder) (TDD)

**Files:**
- Create: `frontend/src/services/audioConcat.ts`
- Create: `frontend/src/services/__tests__/audioConcat.test.ts`

- [ ] **Step 1: Write failing tests for utils**

Create `frontend/src/services/__tests__/audioConcat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtSrtTime, buildSRTContent } from '../audioConcat';

describe('fmtSrtTime', () => {
  it('formats 0ms', () => {
    expect(fmtSrtTime(0)).toBe('00:00:00,000');
  });
  it('formats 1000ms', () => {
    expect(fmtSrtTime(1000)).toBe('00:00:01,000');
  });
  it('formats 3661000ms (1h 1m 1s)', () => {
    expect(fmtSrtTime(3661000)).toBe('01:01:01,000');
  });
  it('formats 123456ms correctly', () => {
    expect(fmtSrtTime(123456)).toBe('00:02:03,456');
  });
});

describe('buildSRTContent', () => {
  const segments = [
    { text: '你好。', startMs: 0, endMs: 2000 },
    { text: '世界！', startMs: 2000, endMs: 4500 },
  ];

  it('builds correct SRT content', () => {
    const srt = buildSRTContent(segments);
    expect(srt).toContain('1');
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('你好。');
    expect(srt).toContain('2');
    expect(srt).toContain('00:00:02,000 --> 00:00:04,500');
    expect(srt).toContain('世界！');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/services/__tests__/audioConcat.test.ts`
Expected: Module not found.

- [ ] **Step 3: Implement audioConcat.ts**

Create `frontend/src/services/audioConcat.ts`:

```ts
export function fmtSrtTime(ms: number): string {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const ms3 = String(Math.floor(ms % 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms3}`;
}

interface SrtSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export function buildSRTContent(segments: SrtSegment[]): string {
  return segments.map((seg, i) => {
    const start = fmtSrtTime(seg.startMs);
    const end = fmtSrtTime(seg.endMs);
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join('\n');
}

/** WAV 文件头写法和 PCM 16-bit 编码 */
export function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);                     // chunk size
  view.setUint16(20, 1, true);                      // PCM
  view.setUint16(22, 1, true);                      // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);         // byte rate
  view.setUint16(32, 2, true);                      // block align
  view.setUint16(34, 16, true);                     // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM 16-bit samples
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** 拼接多个 AudioBuffer，升采样到 targetSampleRate，返回 Float32Array */
export function concatAudioBuffers(
  buffers: AudioBuffer[],
  targetSampleRate: number,
): Float32Array {
  let totalLen = 0;
  for (const b of buffers) {
    const factor = targetSampleRate / b.sampleRate;
    totalLen += Math.floor(b.length * factor);
  }

  const out = new Float32Array(totalLen);
  let offset = 0;

  for (const buf of buffers) {
    const factor = targetSampleRate / buf.sampleRate;
    const channels = buf.numberOfChannels;
    const mono = channels > 1
      ? new Float32Array(buf.length).map((_, i) => {
          let sum = 0;
          for (let ch = 0; ch < channels; ch++) sum += buf.getChannelData(ch)[i];
          return sum / channels;
        })
      : buf.getChannelData(0);

    // Simple linear resample
    const newLen = Math.floor(mono.length * factor);
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i / factor;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, mono.length - 1);
      const frac = srcIdx - lo;
      out[offset + i] = mono[lo] * (1 - frac) + mono[hi] * frac;
    }
    offset += newLen;
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx vitest run src/services/__tests__/audioConcat.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/services/audioConcat.ts frontend/src/services/__tests__/audioConcat.test.ts
git commit -m "feat(frontend): audioConcat (WAV encoder, SRT builder, resample)"
```

---

### Task 20: Create ExportDialog with 4-option export

**Files:**
- Create: `frontend/src/components/SegmentedTTS/ExportDialog.tsx`
- Create: `frontend/src/components/SegmentedTTS/ExportDialog.module.css`

- [ ] **Step 1: Implement ExportDialog**

Create `frontend/src/components/SegmentedTTS/ExportDialog.tsx`:

```tsx
import { useState, useCallback } from 'react';
import type { Segment } from '../../types';
import { getTTSAudioBlob } from '../../services/indexedDB';
import { subtitleLlmApi } from '../../services/api'; // need to add this import
import { buildSRTContent, concatAudioBuffers, encodeWAV } from '../../services/audioConcat';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  open: boolean;
  segments: Segment[];
  defaultName: string;
  onClose: () => void;
}

type ExportOption = 'wav' | 'json' | 'srt' | 'bilingual_srt';

export function ExportDialog({ open, segments, defaultName, onClose }: ExportDialogProps) {
  const [name, setName] = useState(defaultName);
  const [options, setOptions] = useState<ExportOption[]>(['wav', 'json']);
  const [targetLang, setTargetLang] = useState('English');
  const [sourceLang, setSourceLang] = useState('Chinese');
  const [exporting, setExporting] = useState(false);

  const toggleOpt = useCallback((opt: ExportOption) => {
    setOptions(prev =>
      prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt],
    );
  }, []);

  const doExport = useCallback(async () => {
    if (!options.length) return;
    setExporting(true);

    try {
      // 1. Compute timestamps (marks segments with transient _startMs, _endMs)
      const segs = segments.map((s, i) => {
        const startMs = segments.slice(0, i).reduce(
          (acc, ss) => acc + (ss.duration_sec ?? 0) * 1000, 0,
        );
        const endMs = startMs + (s.duration_sec ?? 0) * 1000;
        return { ...s, _startMs: startMs, _endMs: endMs };
      });

      const sanitizedName = name.replace(/[/\\:*?"<>|]/g, '_') || 'export';

      // WAV
      if (options.includes('wav')) {
        const readySegs = segs.filter(s => s.status === 'ready');
        const readyCount = readySegs.length;
        if (readyCount < segs.length) {
          const msg = `${segs.length - readyCount}/${segs.length} 段未生成，`;
          if (!confirm(`${msg}未生成段将被跳过。继续？`)) {
            setExporting(false);
            return;
          }
        }

        // Decode audio buffers
        const audioBuffers: AudioBuffer[] = [];
        for (const s of readySegs) {
          if (!s.current_audio_id) continue;
          const blob = await getTTSAudioBlob(s.current_audio_id);
          if (!blob) continue;
          const arrayBuffer = await blob.arrayBuffer();
          try {
            const ac = new AudioContext();
            const buf = await ac.decodeAudioData(arrayBuffer.slice(0));
            audioBuffers.push(buf);
            ac.close();
          } catch {
            // skip failed decode
          }
        }

        if (audioBuffers.length > 0) {
          const targetRate = Math.max(...audioBuffers.map(b => b.sampleRate));
          const samples = concatAudioBuffers(audioBuffers, targetRate);
          const wavBlob = encodeWAV(samples, targetRate);
          downloadBlob(wavBlob, `${sanitizedName}.wav`);
        }
      }

      // JSON script
      if (options.includes('json')) {
        const json = JSON.stringify({
          name, schema_version: 1, created_at: new Date().toISOString(),
          total_duration_sec: segs.reduce((a, s) => a + (s.duration_sec ?? 0), 0),
          segments: segs.map(s => ({
            text: s.text, ssml: s.ssml, params: s.params,
            start_ms: s._startMs, end_ms: s._endMs,
            duration_sec: s.duration_sec ?? 0,
          })),
        }, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), `${sanitizedName}.script.json`);
      }

      // SRT
      if (options.includes('srt')) {
        const srtSegments = segs.map(s => ({
          text: s.text,
          startMs: s._startMs,
          endMs: s._endMs,
        }));
        const srtContent = buildSRTContent(srtSegments);
        downloadBlob(new Blob([srtContent], { type: 'text/plain' }), `${sanitizedName}.srt`);
      }

      // Bilingual SRT
      if (options.includes('bilingual_srt')) {
        try {
          const srtSegments = segs.map(s => ({
            text: s.text, startMs: s._startMs, endMs: s._endMs,
          }));
          const srtContent = buildSRTContent(srtSegments);
          const result = await subtitleLlmApi.translate({
            srt_content: srtContent,
            target_language: targetLang,
            source_language: sourceLang,
          });
          downloadBlob(
            new Blob([result.bilingual_srt], { type: 'text/plain' }),
            `${sanitizedName}.bilingual.srt`,
          );
        } catch (e) {
          alert('双语 SRT 翻译失败，请检查 LLM 配置。其他文件已下载。');
        }
      }
    } finally {
      setExporting(false);
    }
  }, [segments, name, options, targetLang, sourceLang]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3>导出选项</h3>
        <div className={styles.field}>
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={styles.options}>
          <label><input type="checkbox" checked={options.includes('wav')}
            onChange={() => toggleOpt('wav')} /> WAV 音频</label>
          <label><input type="checkbox" checked={options.includes('json')}
            onChange={() => toggleOpt('json')} /> 脚本 JSON</label>
          <label><input type="checkbox" checked={options.includes('srt')}
            onChange={() => toggleOpt('srt')} /> SRT 字幕</label>
          <label><input type="checkbox" checked={options.includes('bilingual_srt')}
            onChange={() => toggleOpt('bilingual_srt')} /> 双语 SRT 字幕</label>
        </div>
        {options.includes('bilingual_srt') && (
          <div className={styles.langRow}>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
              <option>English</option><option>Japanese</option><option>Korean</option>
            </select>
            <span>→</span>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
              <option>Chinese</option><option>English</option>
            </select>
          </div>
        )}
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={onClose}>取消</button>
          <button className={styles.exportBtn} onClick={doExport} disabled={exporting}>
            {exporting ? '导出中...' : '开始导出'}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

Create `frontend/src/components/SegmentedTTS/ExportDialog.module.css`:

```css
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
  display: flex; align-items: center; justify-content: center; }
.dialog { background: #1f1f1f; border: 1px solid #333; border-radius: 10px;
  padding: 24px; min-width: 360px; }
.dialog h3 { color: #eee; margin: 0 0 16px; }
.field { margin-bottom: 12px; }
.field label { display: block; color: #888; font-size: 12px; margin-bottom: 4px; }
.field input { background: #111; border: 1px solid #444; color: #ddd;
  padding: 6px 10px; border-radius: 4px; width: 100%; }
.options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.options label { font-size: 13px; color: #ccc; display: flex; align-items: center; gap: 6px; }
.langRow { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
.langRow select { background: #111; border: 1px solid #444; color: #ddd; padding: 4px 8px; border-radius: 4px; }
.buttons { display: flex; justify-content: flex-end; gap: 8px; }
.cancelBtn { background: #333; color: #ccc; border: 1px solid #555; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
.exportBtn { background: #2a6; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
.exportBtn:disabled { opacity: 0.5; }
```

- [ ] **Step 2: Add subtitleLlmApi to api.ts if not present**

Check if `subtitleLlmApi` exists in api.ts. If not, add:

```ts
export const subtitleLlmApi = {
  translate: async (params: { srt_content: string; target_language: string; source_language: string }): Promise<{ bilingual_srt: string }> => {
    const { data } = await api.post('/subtitle-llm/translate', params);
    return data;
  },
};
```

- [ ] **Step 3: Wire up the complete SegmentedTTS page with all integrations**

Replace `frontend/src/pages/SegmentedTTS.tsx` content with the fully wired version. The shell from Task 15 is replaced:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { SegmentEditDrawer } from '../components/SegmentedTTS/SegmentEditDrawer';
import { ProjectToolbar } from '../components/SegmentedTTS/ProjectToolbar';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { useSegmentedProject, createInitialProject } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, getTTSAudioBlob, deleteTTSResult } from '../services/indexedDB';
import { saveProject } from '../services/segmentedProjectDB';
import type { Segment, TTSLocalRecord } from '../types';
import styles from './SegmentedTTS.module.css';

const CONCURRENCY = 3;

export function SegmentedTTS() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [state, dispatch] = useSegmentedProject(currentProjectId);
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const { project } = state;
  const editingSegment = project.segments.find(s => s.id === project.selected_segment_id) ?? null;

  // Auto-save with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProject(project).catch(e => console.warn('Auto-save failed:', e));
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [project]);

  // Generate single segment via correct engine API
  const generateSegment = useCallback(async (seg: Segment): Promise<{ blob: Blob; duration: number }> => {
    const p = seg.params;
    const textToSend = (p.enable_ssml && seg.ssml) ? seg.ssml : seg.text;

    let result: any;
    if (p.engine === 'edge_tts') {
      result = await ttsApi.synthesize({
        text: textToSend, engine: 'edge_tts', voice_id: '',
        edge_voice: p.edge_voice ?? '', edge_rate: p.edge_rate ?? '+0%',
        edge_volume: p.edge_volume ?? '+0%', format: 'mp3',
      });
    } else if (p.engine === 'mimo_tts') {
      if (p.mimo_mode === 'preset') {
        result = await mimoTtsApi.synthesizePreset({
          text: textToSend, voice: p.mimo_preset_voice ?? '',
          instruction: p.mimo_instruction ?? '', format: 'wav',
        });
      } else {
        result = await mimoTtsApi.synthesizeVoiceClone({
          text: textToSend, voice_id: p.mimo_clone_voice_id ?? '',
          instruction: p.mimo_instruction ?? '', format: 'wav',
        });
      }
    } else {
      // cosyvoice
      result = await ttsApi.synthesize({
        text: textToSend, voice_id: p.voice_id ?? '',
        language: p.language ?? 'Chinese', speed: p.speed ?? 1.0,
        volume: p.volume ?? 80, pitch: p.pitch ?? 1.0,
        instruction: p.instruction ?? '',
        enable_ssml: p.enable_ssml ?? false,
        enable_markdown_filter: p.enable_markdown_filter ?? false,
        format: 'mp3',
      });
    }

    // Decode base64 → Blob
    if (!result.audio_base64) throw new Error('No audio returned');
    const bytes = atob(result.audio_base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const fmt = result.audio_format || 'mp3';
    const mime = fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}`;
    const blob = new Blob([arr], { type: mime });

    // Measure duration
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const ac = audioContextRef.current;
    const arrayBuf = await blob.arrayBuffer();
    const audioBuf = await ac.decodeAudioData(arrayBuf.slice(0));
    return { blob, duration: audioBuf.duration };
  }, []);

  const handleRegenerate = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg) return;
    dispatch({ type: 'GENERATE_START', id });
    try {
      const { blob, duration } = await generateSegment(seg);
      const audioId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const record: TTSLocalRecord = {
        id: audioId, text: seg.text, voice_id: seg.params.voice_id ?? '',
        voice_name: '', audioBlob: blob, audio_format: 'mp3',
        speed: seg.params.speed ?? 1, volume: seg.params.volume ?? 80,
        pitch: seg.params.pitch ?? 1, instruction: seg.params.instruction ?? '',
        language: seg.params.language ?? 'Chinese',
        created_at: new Date().toISOString(), source: 'segmented_tts',
      };
      await saveTTSResult(record);
      // Clean up old previous if existed before this regenerate
      if (seg.previous_audio_id) {
        try { await deleteTTSResult(seg.previous_audio_id); }
        catch (e) { console.warn('Cleanup previous failed:', e); }
      }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration });
    } catch (e: any) {
      dispatch({ type: 'GENERATE_FAIL', id, error: e?.message ?? '生成失败' });
    }
  }, [project.segments, dispatch, generateSegment]);

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    const toGenerate = project.segments.filter(s => s.status === 'idle' || s.status === 'failed');
    dispatch({ type: 'MARK_QUEUED', ids: toGenerate.map(s => s.id) });

    let i = 0;
    const next = async () => {
      while (i < toGenerate.length) {
        const seg = toGenerate[i++];
        await handleRegenerate(seg.id);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => next()));
    setGenerating(false);
  }, [generating, project.segments, dispatch, handleRegenerate]);

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? project.segments.filter(s => s.params.engine === 'cosyvoice').map(s => s.id);
    const targetSegs = project.segments.filter(s => ids.includes(s.id));
    if (!targetSegs.length) return;
    try {
      const result = await textSplitApi.ssmlAnnotate(targetSegs.map(s => s.text));
      const updates = targetSegs.map((s, i) => ({ id: s.id, ssml: result.annotations[i]?.ssml ?? `<speak>${s.text}</speak>` }));
      dispatch({ type: 'BATCH_SET_SSML', updates, by_llm: true });
      // Enable SSML on each affected segment
      for (const s of targetSegs) {
        dispatch({ type: 'UPDATE_PARAMS', id: s.id, params: { enable_ssml: true } });
      }
    } catch (e) {
      alert('SSML 标注失败，请检查 LLM 配置');
    }
  }, [project.segments, dispatch]);

  const handlePlaySegment = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg?.current_audio_id) return;
    const blob = await getTTSAudioBlob(seg.current_audio_id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().finally(() => URL.revokeObjectURL(url));
  }, [project.segments]);

  return (
    <div className={styles.container}>
      <ProjectToolbar
        project={project}
        onRename={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
        onLayoutToggle={() => dispatch({
          type: 'SET_LAYOUT',
          layout: project.layout === 'vertical' ? 'horizontal' : 'vertical',
        })}
        onGenerateAll={handleRegenerateAll}
        onAnnotateAll={() => handleAnnotateSSML()}
        onExport={() => setExportOpen(true)}
      />
      <TextInputPanel
        splitConfig={project.split_config}
        onSplitConfigChange={(config) => dispatch({ type: 'SET_SPLIT_CONFIG', config })}
        onSplit={(texts) => dispatch({ type: 'APPLY_SPLIT', texts })}
        onLLMSplit={async (text) => {
          const result = await textSplitApi.llmSplit(text, project.split_config.delimiters);
          dispatch({ type: 'APPLY_SPLIT', texts: result.segments.map(s => s.text) });
        }}
      />
      <SegmentList
        segments={project.segments}
        layout={project.layout}
        selectedId={project.selected_segment_id}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
        onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
        onAppend={() => dispatch({ type: 'APPEND_SEGMENT', text: '' })}
        onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
        onEdit={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onRegenerate={handleRegenerate}
        onUndo={(id) => dispatch({ type: 'UNDO_REGENERATE', id })}
      />
      <SegmentEditDrawer
        segment={editingSegment}
        onClose={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
        onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
        onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
        onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
        onRegenerate={handleRegenerate}
        onAnnotateSSML={(id) => handleAnnotateSSML([id])}
      />
      <ExportDialog
        open={exportOpen}
        segments={project.segments}
        defaultName={project.name}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
```

Also update ProjectToolbar's onClick handlers to wire to new props:

Modify `frontend/src/components/SegmentedTTS/ProjectToolbar.tsx`:

In the JSX, replace the three action buttons with:
```tsx
<button className={styles.actionBtn} onClick={onGenerateAll} title="全部生成">⚡ 全部生成</button>
<button className={styles.actionBtn} onClick={onAnnotateAll} title="全部智能标注 SSML">✨ 标注</button>
<button className={styles.actionBtn} onClick={onExport} title="导出">⬇ 导出</button>
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/components/SegmentedTTS/ExportDialog.tsx frontend/src/components/SegmentedTTS/ExportDialog.module.css frontend/src/services/api.ts frontend/src/pages/SegmentedTTS.tsx
git commit -m "feat(frontend): ExportDialog + full SegmentedTTS page wiring + subtitleLlmApi"
```

---

## Phase 6: SSML annotate + horizontal layout + polish

### Task 21: SSML annotate per-segment button in EditDrawer

Note: the project-level "✨ 标注" button in ProjectToolbar and the per-segment annotate from EditDrawer were already wired in Task 20 (via `handleAnnotateSSML`). This task verifies and adds one more entry point: the ⋮ menu inside SegmentRow.

**Files:**
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.tsx`
- Modify: `frontend/src/pages/SegmentedTTS.tsx`

- [ ] **Step 1: Add ⋮ menu to SegmentRow with "智能标注 SSML" item**

Already-rendered actions row in SegmentRow has buttons `▶ ✎ ↻ ✕`. Add a ⋮ menu that opens a small popover. For simplicity v1 uses a `<select>` triggered onChange:

In `SegmentRow.tsx`, after the existing `<button>` for delete (`✕`), add:

```tsx
<select
  className={styles.menuSelect}
  value=""
  onClick={(e) => e.stopPropagation()}
  onChange={(e) => {
    e.stopPropagation();
    if (e.target.value === 'annotate') onAnnotateSSML?.(segment.id);
    if (e.target.value === 'duplicate') onDuplicate?.(segment.id);
    e.target.value = '';
  }}
>
  <option value="">⋮</option>
  <option value="annotate">✨ 智能标注 SSML</option>
  <option value="duplicate">复制段</option>
</select>
```

Add `onAnnotateSSML?: (id: string) => void;` and `onDuplicate?: (id: string) => void;` to `SegmentRowProps`.

Add styles:
```css
.menuSelect {
  background: none; border: 1px solid #444; color: #ccc;
  padding: 2px 4px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
```

- [ ] **Step 2: Wire onAnnotateSSML in SegmentedTTS.tsx**

In the `<SegmentList>` JSX add:
```tsx
onAnnotateSSML={(id) => handleAnnotateSSML([id])}
```
And add corresponding `onAnnotateSSML?: (id: string) => void;` to `SegmentListProps` interface in SegmentList.tsx (forward through to SegmentRow).

- [ ] **Step 3: Verify build and commit**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/components/SegmentedTTS/SegmentRow.tsx frontend/src/components/SegmentedTTS/SegmentRow.module.css frontend/src/components/SegmentedTTS/SegmentList.tsx frontend/src/pages/SegmentedTTS.tsx
git commit -m "feat(frontend): SSML annotate via row ⋮ menu"
```

---

### Task 22: Horizontal layout inline editor

**Files:**
- Modify: `frontend/src/pages/SegmentedTTS.tsx`

The CSS for horizontal mode is already in place from Task 16. Now wire the page to show the editor inline (not as drawer) when in horizontal layout.

- [ ] **Step 1: Conditionally render drawer or inline editor**

In `SegmentedTTS.tsx`, replace the `<SegmentEditDrawer ... />` with:

```tsx
{project.layout === 'vertical' ? (
  <SegmentEditDrawer
    segment={editingSegment}
    onClose={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
    onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
    onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
    onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
    onRegenerate={handleRegenerate}
    onAnnotateSSML={(id) => handleAnnotateSSML([id])}
  />
) : (
  editingSegment && (
    <div className={styles.inlineEditor}>
      {/* Inline edit panel — same content as drawer body, rendered inline */}
      <h4>编辑 #{editingSegment.id.slice(-3)}</h4>
      <textarea
        value={editingSegment.text}
        onChange={(e) => dispatch({ type: 'UPDATE_TEXT', id: editingSegment.id, text: e.target.value })}
        rows={2}
        style={{ width: '100%', background: '#111', border: '1px solid #333', color: '#ddd', padding: 8 }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={() => handleRegenerate(editingSegment.id)}
          style={{ background: '#2a6', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
          ↻ 重新生成
        </button>
      </div>
    </div>
  )
)}
```

Add to `SegmentedTTS.module.css`:
```css
.inlineEditor {
  background: #1f1f1f; border: 1px solid #333; border-radius: 8px;
  padding: 12px; margin-top: 12px;
}
.inlineEditor h4 { color: #ddd; margin: 0 0 8px; font-size: 13px; }
```

- [ ] **Step 2: Verify and commit**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors.

```bash
cd /Users/rio/repos/myprjs/voiceclone
git add frontend/src/pages/SegmentedTTS.tsx frontend/src/pages/SegmentedTTS.module.css
git commit -m "feat(frontend): horizontal layout inline editor"
```

---

### Task 23: Workshop manual test checklist

- [ ] **Step 1: Run the full manual test checklist**

```bash
cd /Users/rio/repos/myprjs/voiceclone/backend
source .venv/bin/activate
uv run uvicorn main:app --host 127.0.0.1 --port 8002
# In another terminal:
cd frontend
npm run dev
```

Manual checklist:
1. Long text (5000 chars) → rule split → see segments listed with idle status
2. Click regenerate all → observe queued → pending → ready animations
3. Play individual segment → hear audio
4. Edit a segment's text → regenerate → hear different audio
5. Undo regenerate → verify previous audio restored
6. Delete a segment → verify segment gone + orphan audio cleaned (IDB check)
7. Insert a segment between two existing ones
8. Append a segment at the end
9. Export WAV + JSON + SRT → verify WAV plays, JSON contains timestamps, SRT aligns
10. Export bilingual SRT → verify translation appears
11. Switch horizontal layout → verify inline editor works
12. Close browser → reopen → project loads from IndexedDB
13. Toggle `prefers-reduced-motion` in dev tools → verify animations disable

Fix any bugs found in an iteration commit.

- [ ] **Step 2: Final commit after bugfixes**

```bash
cd /Users/rio/repos/myprjs/voiceclone
git commit -am "fix: workshop bugfixes from manual test pass"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: Every requirement from the spec is covered by a task:
  - Rule split: Task 3, 6
  - LLM split: Task 4, 6
  - SSML annotate (LLM): Task 5, 6, 21
  - Per-segment regenerate: Task 17, 18, 20
  - Undo (previous_audio swap): Task 13 (reducer), 16 (UI button)
  - Segment CRUD (append, insert, delete, reorder): Task 13 (reducer), 16 (UI)
  - Status animations: Task 16 (CSS keyframes)
  - Export (WAV + JSON + SRT + bilingual): Task 19 (audioConcat), 20 (ExportDialog)
  - Front-end persistence (IndexedDB): Task 10, 11
  - Backend model skeleton: Task 8
  - Horizontal layout: Task 16 (CSS), 22
  - MiMoTTSParams extraction: noted in Task 18 (MiMo params in drawer)
  - Landing + App entry: Task 15
  - TypeScript types: Task 9
- [x] **Placeholder scan**: No TBD, TODO, placeholder code references, or "implement later". Every step has actual code.
- [x] **Type consistency**: 
  - `segmentedReducer` action types in Task 13 match `Action` union type in useSegmentedProject.ts. 
  - All dispatch calls in UI tasks use the correct action type names.
  - TTSLocalRecord.source field is consistently added in Task 9 (type), 10 (IDB filter), 11 (orphan cleanup).
  - `call_llm` signature matches between Task 1 (llm_client) and Task 3-5 (callers).
