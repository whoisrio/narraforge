"""
配置加密服务 — 保护 API Key 等敏感配置的存储和传输

双层加密设计：
1. 存储加密 (Fernet 对称加密): 敏感字段写入 DB 前加密，读出后解密
   - 密钥来源: CONFIG_ENCRYPTION_KEY 环境变量
   - 首次启动自动生成，写入 .env
   - 单独加密每个字段值，保持 JSON 结构不变

2. 传输加密 (RSA 非对称加密): 前端提交敏感字段时先用公钥加密
   - 后端启动时生成 RSA 密钥对 (内存中，重启失效)
   - 前端 GET /model-config/public-key 获取 PEM 公钥
   - 前端用公钥加密 -> 后端用私钥解密
   - 每次 API 进程重启后密钥对自动更新，旧的加密数据自然失效
"""

from __future__ import annotations

import base64
import logging
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives.asymmetric import rsa as _rsa_mod
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fernet 对称加密 (存储加密)
# ---------------------------------------------------------------------------

_fernet_instance: Optional[Fernet] = None
_fernet_lock = threading.Lock()


def _get_or_create_fernet_key() -> str:
    """从 .env 读取 CONFIG_ENCRYPTION_KEY，不存在则自动生成并写入"""
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"

    # 读取现有 .env
    env_lines: list[str] = []
    existing_key = ""
    if env_path.exists():
        env_lines = env_path.read_text(encoding="utf-8").splitlines()
        for line in env_lines:
            if line.strip().startswith("CONFIG_ENCRYPTION_KEY="):
                existing_key = line.split("=", 1)[1].strip().strip("'\"")
                break

    if existing_key:
        return existing_key

    # 生成新密钥
    from cryptography.fernet import Fernet as _Fernet
    new_key = _Fernet.generate_key().decode("utf-8")

    # 追加到 .env
    env_lines.append(f"CONFIG_ENCRYPTION_KEY={new_key}")
    env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
    logger.info("Generated new CONFIG_ENCRYPTION_KEY and saved to .env")

    # 同步加载到当前进程
    os.environ["CONFIG_ENCRYPTION_KEY"] = new_key
    return new_key


def get_fernet() -> Fernet:
    """获取 Fernet 实例（懒加载，线程安全）"""
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    with _fernet_lock:
        if _fernet_instance is not None:
            return _fernet_instance

        from cryptography.fernet import Fernet as _Fernet
        key = os.environ.get("CONFIG_ENCRYPTION_KEY", "").strip()
        if not key:
            # 尝试从 settings 读取
            try:
                from app.core.config import settings
                key = getattr(settings, "config_encryption_key", "") or ""
            except Exception:
                pass
        if not key:
            key = _get_or_create_fernet_key()
        _fernet_instance = _Fernet(key.encode("utf-8"))
        logger.info("Fernet encryption initialized for config storage")
        return _fernet_instance


def encrypt_value(plaintext: str) -> str:
    """加密一个配置值，返回 base64 编码的密文"""
    if not plaintext:
        return ""
    f = get_fernet()
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_value(ciphertext: str) -> str:
    """解密一个配置值，返回明文"""
    if not ciphertext:
        return ""
    f = get_fernet()
    try:
        return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.warning(f"Failed to decrypt config value (may be plaintext): {e}")
        # 降级返回原文（兼容已有的明文数据）
        return ciphertext


def is_encrypted(value: str) -> bool:
    """判断一个值是否已经是 Fernet 加密的"""
    if not value:
        return False
    try:
        # Fernet 密文总是以 gAAAA 开头 (base64 of version byte 0x80)
        if value.startswith("gAAAA"):
            get_fernet().decrypt(value.encode("utf-8"))
            return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# RSA 非对称加密 (传输加密)
# ---------------------------------------------------------------------------

_rsa_private_key: Optional[RSAPrivateKey] = None
_rsa_public_key_pem: Optional[str] = None
_rsa_lock = threading.Lock()


def _ensure_rsa_keys() -> None:
    """生成或获取 RSA 密钥对（内存中，进程重启后重新生成）"""
    global _rsa_private_key, _rsa_public_key_pem
    if _rsa_private_key is not None:
        return

    with _rsa_lock:
        if _rsa_private_key is not None:
            return

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        _rsa_private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        _rsa_public_key_pem = _rsa_private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")
        logger.info("RSA key pair generated for config transmission encryption")


def get_rsa_public_key_pem() -> str:
    """获取 RSA 公钥 PEM（供前端使用）"""
    _ensure_rsa_keys()
    assert _rsa_public_key_pem is not None
    return _rsa_public_key_pem


def rsa_decrypt(ciphertext_b64: str) -> str:
    """用 RSA 私钥解密前端传来的加密数据（base64 编码的 RSA 密文）"""
    _ensure_rsa_keys()
    assert _rsa_private_key is not None

    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives import hashes

    ciphertext = base64.b64decode(ciphertext_b64)
    plaintext = _rsa_private_key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return plaintext.decode("utf-8")
