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
