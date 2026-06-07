"""
模型配置 API — 统一管理各模型提供商的连接配置

GET  /model-config            — 获取所有提供商配置（敏感字段脱敏）
GET  /model-config/public-key — 获取 RSA 公钥（前端加密传输用）
PUT  /model-config/{provider} — 更新指定提供商的配置
GET  /model-config/schema     — 获取配置 schema（前端渲染表单用）
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.model_config_service import (
    get_all_configs,
    update_provider_config,
    get_config_schema,
    PROVIDER_SCHEMAS,
)
from app.core.crypto_service import get_rsa_public_key_pem, rsa_decrypt

router = APIRouter()


class ProviderConfigUpdate(BaseModel):
    """更新提供商配置的请求体 — 字段名到值的映射"""
    fields: Dict[str, str]


@router.get("")
def get_model_configs(db: Session = Depends(get_db)):
    """
    获取所有模型提供商的配置。

    敏感字段（如 API Key）不返回明文，只返回是否已设置。
    前端通过 has_value / has_env_default 判断状态。
    """
    configs = get_all_configs(db)
    # 脱敏：敏感字段不返回明文 value
    for provider_key, provider_data in configs.items():
        for field_key, field_info in provider_data["fields"].items():
            if field_info["sensitive"] and field_info["value"]:
                # 用占位符替代明文，前端可据此判断"已设置"
                field_info["value"] = "********"
    return configs


@router.get("/public-key")
def get_public_key():
    """
    获取 RSA 公钥 (PEM 格式)。
    前端用此公钥加密敏感字段后再提交，防止明文传输。
    注意：密钥对在进程启动时生成，重启后失效。
    """
    return {"public_key": get_rsa_public_key_pem()}


@router.get("/schema")
def get_model_config_schema():
    """获取配置 schema（不含实际值），用于前端动态渲染表单"""
    return get_config_schema()


@router.put("/{provider}")
def update_model_config(
    provider: str,
    data: ProviderConfigUpdate,
    db: Session = Depends(get_db),
):
    """
    更新指定提供商的配置。

    - 只更新传入的字段
    - 传入空字符串表示清除该字段（回退到 .env 默认值）
    - 传入 "********" 表示不修改敏感字段（前端占位符回传）
    - 敏感字段如果以 "RSA:" 前缀开头，则用 RSA 私钥解密
    """
    if provider not in PROVIDER_SCHEMAS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {provider}. Valid: {', '.join(PROVIDER_SCHEMAS.keys())}"
        )

    # 确定哪些字段是敏感的
    sensitive_fields = {
        k for k, v in PROVIDER_SCHEMAS[provider].items() if v["sensitive"]
    }

    updates = {}
    for key, value in data.fields.items():
        # 敏感字段占位符，跳过
        if key in sensitive_fields and value == "********":
            continue
        # RSA 加密传输的字段，用私钥解密
        if key in sensitive_fields and value.startswith("RSA:"):
            try:
                value = rsa_decrypt(value[4:])  # 去掉 "RSA:" 前缀后解密
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to decrypt field '{key}': {e}"
                )
        updates[key] = value

    if not updates:
        return {"message": "No changes"}

    try:
        result = update_provider_config(db, provider, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"message": "配置已保存", "provider": provider, "updated_fields": list(updates.keys())}
