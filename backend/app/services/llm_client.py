"""LLM 客户端公共能力 —— 配置读取、HTTP 调用、JSON 解析、结构化输出。

从 llm_subtitle_service.py 抽取，供 text_split_service 和 subtitle 字幕服务共享。
保留与原私有函数同名的别名以便平滑迁移。

新增能力 (2026-06-08):
- `call_llm_structured(messages, schema, ...)` — 返回 Pydantic 实例，自动按 provider
  决定是否带 `response_format`，schema 始终注入到 system prompt，校验失败重试。
- `LLMValidationError` — Schema 校验耗尽重试次数后抛出，含最后一次返回内容。
- `extract_json_object` — 与 `extract_json_array` 对应，提取顶层 `{...}`。
"""

import json
import logging
import re
import ssl
import urllib.request
import urllib.error
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class LLMValidationError(RuntimeError):
    """LLM 返回内容多次都无法通过 Pydantic 校验时抛出。

    保留最后一次原始返回与最后一次校验错误，便于上层日志/降级。
    """

    def __init__(self, message: str, *, last_raw: str = "", last_error: str = ""):
        super().__init__(message)
        self.last_raw = last_raw
        self.last_error = last_error


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


def extract_json_object(raw: str | None) -> str | None:
    """从 LLM 返回中提取 JSON 对象字符串（顶层 `{...}`）。

    兼容 markdown 代码块与前后杂文，逻辑与 extract_json_array 对应。
    """
    if not raw or not raw.strip():
        return None
    text = raw.strip()

    md_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if md_match:
        return md_match.group(1)

    # 贪婪匹配最外层 {...}
    obj_match = re.search(r'\{.*\}', text, re.DOTALL)
    if obj_match:
        candidate = obj_match.group()
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return candidate
        except json.JSONDecodeError:
            pass

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
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


def _supports_response_format(base_url: str) -> bool:
    """按 base_url 判断 provider 是否默认带 response_format={"type":"json_object"}.

    - Qwen / DashScope OpenAI 兼容层: 支持
    - MiMo (xiaomimimo): 默认关闭，避免 400
    - 未知 provider: 默认关闭（保守）

    可被 call_llm_structured 的 use_response_format 参数显式覆盖。
    """
    url = (base_url or "").lower()
    if "xiaomimimo" in url:
        return False
    if "dashscope" in url or "aliyuncs" in url:
        return True
    return False


def call_llm(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    db=None,
    timeout: int = 300,
    response_format: dict | None = None,
) -> str:
    """调用 LLM Chat API 并返回 assistant 消息内容。

    自动适配 MiMo (api-key header) 和 Qwen/OpenAI (Bearer) 认证。
    失败抛 RuntimeError；token 耗尽（仅 reasoning 无 content）也抛 RuntimeError。

    新增 `response_format` 参数（默认 None 表示不带），由 call_llm_structured 按
    provider 自动决定。直接调用 call_llm 时通常不需要传。
    """
    api_key, base_url, default_model = get_llm_config(db=db)
    model = model or default_model

    chat_url = f"{base_url}/chat/completions"
    body: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        body["response_format"] = response_format
    payload = json.dumps(body).encode("utf-8")

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

        logger.info(f'llm messages : {msg}')
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
        body_err = e.read().decode("utf-8", errors="replace")
        logger.error(f"LLM API error {e.code}: {body_err}")
        raise RuntimeError(f"LLM API 调用失败 ({e.code}): {body_err[:200]}")
    except urllib.error.URLError as e:
        logger.error(f"LLM API URL error: {e}")
        raise RuntimeError(f"LLM 服务不可达: {e}")


# ---------------------------------------------------------------------------
# Structured output: call_llm + Pydantic schema + retry-on-validation-fail
# ---------------------------------------------------------------------------

_SCHEMA_INSTRUCTION_TEMPLATE = (
    "你必须严格按照以下 JSON Schema 返回结果，输出顶层必须是一个 JSON 对象 "
    "（不是数组、不是字符串）。不要包含任何 markdown 代码块、解释或额外说明，"
    "只输出符合 schema 的 JSON：\n\n"
    "```json\n{schema}\n```"
)


def _inject_schema_instruction(messages: list[dict], schema: Type[BaseModel]) -> list[dict]:
    """把 schema 的 JSON Schema 文本拼到 system message 末尾（无则新建）。

    Pydantic v2 的 model_json_schema() 输出 `$defs` 等元信息，足以让模型理解结构。
    返回新的 messages 列表，不修改入参。
    """
    schema_json = json.dumps(schema.model_json_schema(), ensure_ascii=False, indent=2)
    instruction = _SCHEMA_INSTRUCTION_TEMPLATE.format(schema=schema_json)

    new_messages = [dict(m) for m in messages]
    if new_messages and new_messages[0].get("role") == "system":
        new_messages[0] = {
            **new_messages[0],
            "content": f"{new_messages[0].get('content', '')}\n\n{instruction}",
        }
    else:
        new_messages.insert(0, {"role": "system", "content": instruction})
    return new_messages


def call_llm_structured(
    messages: list[dict],
    schema: Type[T],
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    db=None,
    timeout: int = 300,
    max_retries: int = 2,
    use_response_format: bool | None = None,
) -> T:
    """调用 LLM 并把返回解析为指定的 Pydantic schema 实例。

    Args:
        messages: 标准 chat messages。schema 指令会被注入到 system prompt 里。
        schema: Pydantic BaseModel 子类。**必须用 object 包裹**——OpenAI 兼容
            的 response_format=json_object 要求顶层是对象。如需数组，把数组放在
            字段里（如 `{"segments": [...]}`)。
        max_retries: Schema 校验失败后的额外重试次数。默认 2 → 最多调用 3 次。
            仅对"返回内容无法通过 Pydantic 校验"重试；HTTP/网络错误不重试。
        use_response_format: 是否在请求里带 `response_format={"type":"json_object"}`。
            默认 None → 按 base_url 自动判断（Qwen 带，MiMo 不带）。

    Returns:
        schema 的实例。

    Raises:
        RuntimeError: HTTP/网络错误，或 token 耗尽（沿用 call_llm 行为）。
        LLMValidationError: 重试耗尽后仍无法校验通过。
    """
    _, base_url, _ = get_llm_config(db=db)

    if use_response_format is None:
        use_response_format = _supports_response_format(base_url)
    response_format = {"type": "json_object"} if use_response_format else None

    # 始终把 schema 注入到 prompt 里 —— 这是跨 provider 最稳的兜底
    enriched_messages = _inject_schema_instruction(messages, schema)

    last_raw = ""
    last_error = ""
    convo = list(enriched_messages)

    for attempt in range(max_retries + 1):
        raw = call_llm(
            convo,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            db=db,
            timeout=timeout,
            response_format=response_format,
        )
        last_raw = raw

        # 容错提取顶层 JSON 对象
        json_str = extract_json_object(raw) or raw.strip()

        try:
            return schema.model_validate_json(json_str)
        except ValidationError as e:
            last_error = str(e)
            logger.warning(
                f"LLM 结构化输出校验失败 (attempt {attempt + 1}/{max_retries + 1}): "
                f"{last_error[:300]}"
            )
            if attempt >= max_retries:
                break
            # 把上一轮返回 + 错误反馈拼回会话，让模型修正
            convo = convo + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "你上一次的返回无法通过 schema 校验，错误信息如下：\n"
                        f"{last_error}\n\n"
                        "请严格按照之前给出的 JSON Schema 重新返回，只输出 JSON 对象本身。"
                    ),
                },
            ]
        except json.JSONDecodeError as e:
            last_error = f"JSON 解析失败: {e}"
            logger.warning(
                f"LLM 结构化输出无法解析 JSON (attempt {attempt + 1}/{max_retries + 1}): "
                f"{last_error}; raw[:200]={raw[:200]!r}"
            )
            if attempt >= max_retries:
                break
            convo = convo + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "你上一次的返回不是合法 JSON，请严格按照 schema 重新返回，"
                        "只输出 JSON 对象本身，不要 markdown、不要解释。"
                    ),
                },
            ]

    raise LLMValidationError(
        f"LLM 返回内容经 {max_retries + 1} 次尝试仍无法通过 schema 校验。"
        f"最后错误: {last_error[:300]}",
        last_raw=last_raw,
        last_error=last_error,
    )
