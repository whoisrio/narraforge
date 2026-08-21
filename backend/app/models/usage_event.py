from sqlalchemy import Column, String, DateTime, Integer, Boolean
from datetime import datetime
import uuid

from app.core.database import Base
from app.core.time_utils import utcnow


class UsageEvent(Base):
    """用量计量事件（Phase 3）：TTS 合成与 LLM 调用的计费原料。

    - kind='tts'：chars=合成文本字符数，token 恒 0；
    - kind='llm'：chars=输入文本字符数，token 优先取 API 返回，否则字符估算
      （estimated=True 标记估算值）；
    - project_id 可空：无项目上下文的 LLM 调用（字幕校准/翻译、文本拆分）归 NULL 桶；
    - local SQLite 单租户无 user_id 列；Supabase 侧经 alter table 追加
      （见 supabase/schema.sql 与 schema sync 测试的 EXTRA_DDL_COLUMNS）。
    """
    __tablename__ = "usage_events"

    def __repr__(self):
        return f"<UsageEvent(id={self.id}, kind={self.kind}, project_id={self.project_id})>"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, nullable=True)
    kind = Column(String, nullable=False)  # 'tts' | 'llm'
    chars = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    # token 为字符估算（非 API 返回）时置 True
    estimated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=utcnow)
