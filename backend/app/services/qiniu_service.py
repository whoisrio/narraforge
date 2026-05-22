import logging
from qiniu import Auth, put_file_v2

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_qiniu_configured() -> bool:
    return bool(
        settings.oss_ak
        and settings.oss_sk
        and settings.bucket_name
        and settings.bucket_domain
    )


def upload_to_qiniu(local_file_path: str, key: str) -> str:
    """上传本地文件到七牛云，返回公网可访问的 URL。失败时抛出 RuntimeError。"""
    q = Auth(settings.oss_ak, settings.oss_sk)
    token = q.upload_token(settings.bucket_name, key, 3600)

    ret, info = put_file_v2(token, key, local_file_path, version="v2")

    if ret is None or ret.get("key") != key:
        raise RuntimeError(f"Qiniu upload failed: {info}")

    url = f"{settings.bucket_domain.rstrip('/')}/{key}"
    logger.info(f"Uploaded {local_file_path} to Qiniu: {url}")
    return url
