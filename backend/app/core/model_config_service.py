"""
模型配置服务 — 统一管理各模型/服务提供商的连接配置

设计原则：
- 界面配置优先：从 system_configs 表读取用户在界面中设置的值
- .env 降级兜底：如果界面未配置某个字段，回退到 .env 中的默认值
- API Key 等敏感字段：界面只显示"是否已设置"，不返回明文
"""

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto_service import encrypt_value, decrypt_value, is_encrypted
from app.models.system_config import SystemConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 配置键定义：每个模型提供商对应一个 system_configs 行
# 值为 JSON 字符串，包含该提供商的所有配置项
# ---------------------------------------------------------------------------

PROVIDER_KEYS = {
    "qwen_tts": "model_config.qwen_tts",
    "mimo_tts": "model_config.mimo_tts",
    "llm": "model_config.llm",
    "funasr": "model_config.funasr",
    "oss": "model_config.oss",
    "app": "model_config.app",
}

# 每个提供商的配置字段定义：
# key -> { label, type, sensitive, default_from_settings, description }
PROVIDER_SCHEMAS: dict[str, dict[str, dict[str, Any]]] = {
    "qwen_tts": {
        "api_key": {
            "label": "API Key",
            "type": "password",
            "sensitive": True,
            "default_from_settings": "qwen_api_key",
            "description": "千问 DashScope API Key",
        },
        "model": {
            "label": "模型名称",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "qwen_model",
            "description": "如 cosyvoice-v2 或 qwen-tts",
        },
    },
    "mimo_tts": {
        "api_key": {
            "label": "API Key",
            "type": "password",
            "sensitive": True,
            "default_from_settings": "mimo_api_key",
            "description": "小米 MiMo TTS API Key",
        },
        "base_url": {
            "label": "API Base URL",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "mimo_base_url",
            "description": "MiMo API 地址",
        },
    },
    "llm": {
        "api_key": {
            "label": "API Key",
            "type": "password",
            "sensitive": True,
            "default_from_settings": "llm_api_key",
            "fallback_settings": "mimo_api_key",
            "description": "LLM API Key（留空则回退到 MiMo API Key）",
        },
        "base_url": {
            "label": "API Base URL",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "llm_base_url",
            "fallback_settings": "mimo_base_url",
            "description": "LLM API 地址（留空则回退到 MiMo Base URL）",
        },
        "model": {
            "label": "模型名称",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "llm_model",
            "description": "如 mimo-v2.5-pro、deepseek-chat 等",
        },
    },
    "funasr": {
        "model": {
            "label": "模型名称",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "funasr_model",
            "description": "如 paraformer-zh、paraformer-zh-streaming",
        },
        "device": {
            "label": "计算设备",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "funasr_device",
            "description": "留空自动检测 (cuda > mps > cpu)",
        },
    },
    "oss": {
        "access_key": {
            "label": "Access Key",
            "type": "password",
            "sensitive": True,
            "default_from_settings": "oss_ak",
            "description": "七牛云 Access Key",
        },
        "secret_key": {
            "label": "Secret Key",
            "type": "password",
            "sensitive": True,
            "default_from_settings": "oss_sk",
            "description": "七牛云 Secret Key",
        },
        "bucket_name": {
            "label": "Bucket 名称",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "bucket_name",
            "description": "七牛云存储空间名称",
        },
        "bucket_domain": {
            "label": "Bucket 域名",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "bucket_domain",
            "description": "七牛云 CDN/绑定域名",
        },
    },
    "app": {
        "public_base_url": {
            "label": "公网访问 URL",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "public_base_url",
            "description": "CosyVoice 声音注册需要的公网可访问 URL",
        },
    },
}

# 提供商的显示信息
PROVIDER_INFO: dict[str, dict[str, str]] = {
    "qwen_tts": {"label": "千问 TTS / CosyVoice", "icon": "🎙️"},
    "mimo_tts": {"label": "小米 MiMo TTS", "icon": "🔊"},
    "llm": {"label": "LLM 字幕服务", "icon": "🤖"},
    "funasr": {"label": "FunASR 语音识别", "icon": "🎤"},
    "oss": {"label": "七牛云对象存储", "icon": "☁️"},
    "app": {"label": "应用设置", "icon": "⚙️"},
}


def _get_settings_default(provider: str, field: str) -> str:
    """从 settings (.env) 获取默认值，支持 fallback_settings 链"""
    schema = PROVIDER_SCHEMAS[provider][field]
    primary = schema.get("default_from_settings", "")
    value = getattr(settings, primary, "") if primary else ""
    if not value:
        fallback = schema.get("fallback_settings", "")
        value = getattr(settings, fallback, "") if fallback else ""
    return value or ""


def _load_provider_config(db: Session, provider: str) -> dict:
    """从 system_configs 表读取某个提供商的配置 JSON，敏感字段自动解密"""
    key = PROVIDER_KEYS[provider]
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if row and row.value:
        try:
            config = json.loads(row.value)
            # 解密敏感字段
            schema = PROVIDER_SCHEMAS.get(provider, {})
            for field_key, field_def in schema.items():
                if field_def.get("sensitive") and field_key in config and config[field_key]:
                    config[field_key] = decrypt_value(config[field_key])
            return config
        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON for {key}, resetting")
    return {}


def _save_provider_config(db: Session, provider: str, config: dict) -> None:
    """保存某个提供商的配置到 system_configs 表，敏感字段自动加密"""
    key = PROVIDER_KEYS[provider]
    # 加密敏感字段（不改动原 dict）
    save_config = dict(config)
    schema = PROVIDER_SCHEMAS.get(provider, {})
    for field_key, field_def in schema.items():
        if field_def.get("sensitive") and field_key in save_config and save_config[field_key]:
            save_config[field_key] = encrypt_value(save_config[field_key])
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    value = json.dumps(save_config, ensure_ascii=False)
    if row:
        row.value = value
    else:
        db.add(SystemConfig(key=key, value=value))


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------

def get_all_configs(db: Session) -> dict:
    """
    获取所有提供商的配置（用于界面显示）。

    返回格式：
    {
      "qwen_tts": {
        "label": "千问 TTS / CosyVoice",
        "icon": "🎙️",
        "fields": {
          "api_key": {
            "label": "API Key",
            "type": "password",
            "sensitive": true,
            "description": "...",
            "value": "sk-xxx",        # 界面设置的值
            "has_env_default": true,   # .env 中是否有默认值
            "has_value": true,         # 最终是否有可用值（界面 or .env）
          },
          ...
        }
      },
      ...
    }
    """
    result = {}
    for provider, schema in PROVIDER_SCHEMAS.items():
        db_config = _load_provider_config(db, provider)
        fields = {}
        for field_key, field_def in schema.items():
            env_default = _get_settings_default(provider, field_key)
            ui_value = db_config.get(field_key, "")
            # 如果界面没配置但有 .env 默认值，最终有效值就是 .env 的
            effective_value = ui_value or env_default
            fields[field_key] = {
                "label": field_def["label"],
                "type": field_def["type"],
                "sensitive": field_def["sensitive"],
                "description": field_def.get("description", ""),
                "value": ui_value,  # 界面设置的值（空字符串表示未设置）
                "has_env_default": bool(env_default),
                "has_value": bool(effective_value),
            }
        result[provider] = {
            **PROVIDER_INFO[provider],
            "fields": fields,
        }
    return result


def update_provider_config(db: Session, provider: str, updates: dict) -> dict:
    """
    更新某个提供商的配置。

    updates: { "api_key": "sk-xxx", "model": "cosyvoice-v2" }
    只更新传入的字段，未传入的字段保持不变。
    传入空字符串表示清除该字段的界面配置（回退到 .env 默认值）。
    """
    if provider not in PROVIDER_SCHEMAS:
        raise ValueError(f"Unknown provider: {provider}")

    # 验证字段名
    valid_fields = set(PROVIDER_SCHEMAS[provider].keys())
    for key in updates:
        if key not in valid_fields:
            raise ValueError(f"Unknown field '{key}' for provider '{provider}'")

    current = _load_provider_config(db, provider)
    current.update(updates)
    _save_provider_config(db, provider, current)
    db.commit()

    logger.info(f"Model config updated for provider: {provider}, fields: {list(updates.keys())}")
    return current


def get_effective_config(db: Session, provider: str) -> dict:
    """
    获取某个提供商的有效配置（界面配置优先，.env 降级）。

    返回所有字段的有效值字典，敏感字段也返回明文（仅后端内部使用）。
    这是各 service 应该调用的方法。
    """
    if provider not in PROVIDER_SCHEMAS:
        raise ValueError(f"Unknown provider: {provider}")

    db_config = _load_provider_config(db, provider)
    result = {}
    for field_key, field_def in PROVIDER_SCHEMAS[provider].items():
        ui_value = db_config.get(field_key, "")
        env_default = _get_settings_default(provider, field_key)
        result[field_key] = ui_value or env_default
    return result


def get_effective_value(db: Session, provider: str, field: str) -> str:
    """
    获取单个字段的有效值（界面配置优先，.env 降级）。
    便捷方法，用于 service 中快速获取单个配置项。
    """
    config = get_effective_config(db, provider)
    return config.get(field, "")


def get_config_schema() -> dict:
    """获取配置 schema（不含实际值），用于前端渲染表单"""
    result = {}
    for provider, schema in PROVIDER_SCHEMAS.items():
        fields = {}
        for field_key, field_def in schema.items():
            fields[field_key] = {
                "label": field_def["label"],
                "type": field_def["type"],
                "sensitive": field_def["sensitive"],
                "description": field_def.get("description", ""),
                "has_fallback": bool(field_def.get("fallback_settings")),
            }
        result[provider] = {
            **PROVIDER_INFO[provider],
            "fields": fields,
        }
    return result
