import logging
from qiniu import Auth, put_file_v2

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_oss_config(db=None) -> dict:
    """获取 OSS 有效配置（界面优先，.env 降级）"""
    config = {
        "access_key": settings.oss_ak,
        "secret_key": settings.oss_sk,
        "bucket_name": settings.bucket_name,
        "bucket_domain": settings.bucket_domain,
    }
    if db is not None:
        try:
            from app.core.model_config_service import get_effective_config
            db_config = get_effective_config(db, "oss")
            config["access_key"] = db_config.get("access_key") or config["access_key"]
            config["secret_key"] = db_config.get("secret_key") or config["secret_key"]
            config["bucket_name"] = db_config.get("bucket_name") or config["bucket_name"]
            config["bucket_domain"] = db_config.get("bucket_domain") or config["bucket_domain"]
        except Exception:
            pass  # 降级到 settings
    return config


def is_qiniu_configured(db=None) -> bool:
    config = _get_oss_config(db)
    return bool(
        config["access_key"]
        and config["secret_key"]
        and config["bucket_name"]
        and config["bucket_domain"]
    )


def upload_to_qiniu(local_file_path: str, key: str, db=None) -> str:
    """上传本地文件到七牛云，返回公网可访问的 URL。失败时抛出 RuntimeError。"""
    config = _get_oss_config(db)
    q = Auth(config["access_key"], config["secret_key"])
    token = q.upload_token(config["bucket_name"], key, 3600)

    ret, info = put_file_v2(token, key, local_file_path, version="v2")

    if ret is None or ret.get("key") != key:
        raise RuntimeError(f"Qiniu upload failed: {info}")

    url = f"{config['bucket_domain'].rstrip('/')}/{key}"
    logger.info(f"Uploaded {local_file_path} to Qiniu: {url}")
    return url
