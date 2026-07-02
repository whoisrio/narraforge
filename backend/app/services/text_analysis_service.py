"""
智能文稿解析服务 — 纯正则引擎

三层架构的第⼀层：
- 章节拆分（中文编号 / markdown 标题 / 场景标题）
- 角色识别（行首冒号 / 动词引导 / 引号+后置说话人 / 全大写英文）
- 台词分配
- 频次过滤去噪

完全零依赖，不调 LLM，不读数据库。
"""

import re
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 正则规则集
# ---------------------------------------------------------------------------

# 第一章、第 3 集、第十节 …
_RE_CN_CHAPTER = re.compile(
    r"^第[0-9零一二三四五六七八九十百千]+[章节集篇回]\s*(.*)$",
    re.MULTILINE,
)

# markdown 标题 H1-H3
_RE_MD_HEADING = re.compile(r"^(#{1,3})\s+(.*)$", re.MULTILINE)

# 场景标题 INT./EXT./【/△/▲
_RE_SCENE = re.compile(r"^(INT\.|EXT\.|【|△|▲).*$", re.MULTILINE | re.IGNORECASE)

# --- 角色识别 ---

# 规则 A：行首冒号  张三：快走！
_RE_ROLE_COLON = re.compile(r"^([^：\n\r]{1,12})：")

# 规则 B：带动词的冒号  张三说：快走！
_RE_ROLE_VERB_COLON = re.compile(r"^([^：\n\r]{1,10}?)(笑道|怒道|叹道|喊道|答道|问道|说|道)[:：]")

# 规则 C：引号 + 后置说话人  "快走！"张三焦急地说。
_RE_ROLE_QUOTE = re.compile(r'[」"\']\s*([^，。！？\s]{1,8})\s*(说|道)')

# 规则 D：全大写英文角色名（独占一行，下行即台词）
_RE_ROLE_ENGLISH = re.compile(r"^[A-Z][A-Z\s()]{1,29}$", re.MULTILINE)


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class Segment:
    text: str
    role: str | None = None
    role_confidence: float = 1.0


@dataclass
class Chapter:
    title: str
    segments: list[Segment] = field(default_factory=list)


@dataclass
class DetectedRole:
    name: str
    occurrences: int
    confidence: float


@dataclass
class SplitResult:
    method: str = "regex"
    chapters: list[Chapter] = field(default_factory=list)
    detected_roles: list[DetectedRole] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------

def analyze_script(
    text: str,
    mode: str = "auto",
    min_occurrences: int = 2,
) -> SplitResult:
    """对原始文稿做正则解析，返回章节 + 分段 + 检测到的角色。

    参数
    ----
    text: 原始文本内容
    mode: "auto" | "script" | "article"（目前仅有 auto，后续可扩展）
    min_occurrences: 角色出现的最低次数阈值，低于此值的候选被丢弃
    """
    if not text or not text.strip():
        return SplitResult()

    # 1. 找章节边界
    chapter_ranges = _find_chapter_boundaries(text)

    if not chapter_ranges:
        # 没识别到章节 → 全文作为一个章节
        chapter_ranges = [(None, 0, len(text))]

    # 2. 全局角色识别（先扫全⽂统计）
    role_counter, role_first_lines = _scan_roles(text)

    # 3. 逐章节：分段 → 分配角色
    chapters: list[Chapter] = []

    for title, start, end in chapter_ranges:
        chapter_text = text[start:end]
        lines = _split_lines(chapter_text)
        segs: list[Segment] = []

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line or _is_chapter_title(line):
                i += 1
                continue

            # 尝试分配角色
            role, confidence = _assign_role(line, role_counter, min_occurrences)

            # 如果是英文角色名独占一行，把下一行作为台词
            if role and _RE_ROLE_ENGLISH.match(line):
                # 这行是角色名，下行是台词
                i += 1
                if i < len(lines):
                    line = lines[i].strip()
                else:
                    i += 1
                    continue

            # 剥离角色前缀（规则 A/B 的 "角色名：" / "角色名说："）
            display_text = _strip_role_prefix(line, role)

            if display_text:
                segs.append(Segment(text=display_text, role=role, role_confidence=confidence))

            i += 1

        chapters.append(Chapter(title=title or "", segments=segs))

    # 4. 构建 detected_roles（按出现次数降序）
    detected = [
        DetectedRole(
            name=name,
            occurrences=cnt,
            confidence=_role_confidence(cnt, min_occurrences),
        )
        for name, cnt in sorted(role_counter.items(), key=lambda x: -x[1])
        if cnt >= min_occurrences
    ]

    return SplitResult(method="regex", chapters=chapters, detected_roles=detected)


# ---------------------------------------------------------------------------
# 内部实现
# ---------------------------------------------------------------------------

def _find_chapter_boundaries(text: str) -> list[tuple[str | None, int, int]]:
    """找到章节标题位置，返回 [(title, start, end), ...]

    同时支持中⽂章节号、markdown 标题、场景标题。
    取最早出现的一种模式作为章节切分依据。
    """
    matches: list[tuple[str, int, int]] = []  # (title, start, level)

    # 中文章节号
    for m in _RE_CN_CHAPTER.finditer(text):
        title = m.group(0).strip()
        matches.append((title, m.start(), 0))

    # Markdown 标题
    if not matches:
        for m in _RE_MD_HEADING.finditer(text):
            level = len(m.group(1))
            if level <= 3:
                title = m.group(2).strip()
                matches.append((title, m.start(), level))

    # 场景标题（兜底）
    if not matches:
        for m in _RE_SCENE.finditer(text):
            title = m.group(0).strip()
            matches.append((title, m.start(), 99))

    if not matches:
        return []

    # 排序后生成区间
    matches.sort(key=lambda x: x[1])

    boundaries: list[tuple[str | None, int, int]] = []
    for i, (title, pos, _) in enumerate(matches):
        start = pos
        end = matches[i + 1][1] if i + 1 < len(matches) else len(text)
        boundaries.append((title, start, end))

    return boundaries


def _scan_roles(text: str) -> tuple[dict[str, int], dict[str, str]]:
    """全⽂扫描角色名，返回 (出现次数, 首句样例)"""
    role_counter: dict[str, int] = {}
    role_first_lines: dict[str, str] = {}

    lines = _split_lines(text)

    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue

        # 规则 B 优先（更长、更精确）
        m = _RE_ROLE_VERB_COLON.match(line)
        if m:
            role = m.group(1)
            _count_role(role_counter, role_first_lines, role, line)
            continue

        # 规则 A
        m = _RE_ROLE_COLON.match(line)
        if m:
            role = m.group(1)
            _count_role(role_counter, role_first_lines, role, line)
            continue

        # 规则 D（英文角色名）
        m = _RE_ROLE_ENGLISH.match(line)
        if m:
            role = m.group(0)
            # 看下⼀行是不是台词
            if i + 1 < len(lines) and lines[i + 1].strip():
                _count_role(role_counter, role_first_lines, role, lines[i + 1].strip())
            continue

        # 规则 C（引号后置），最弱，最后匹配
        m = _RE_ROLE_QUOTE.search(line)
        if m:
            role = m.group(1)
            _count_role(role_counter, role_first_lines, role, line)

    return role_counter, role_first_lines


def _count_role(
    counter: dict[str, int],
    first_lines: dict[str, str],
    role: str,
    line: str,
) -> None:
    role = role.strip()
    if not role or len(role) == 1:
        return  # 单字不认
    counter[role] = counter.get(role, 0) + 1
    if role not in first_lines:
        first_lines[role] = line.strip()[:60]


def _assign_role(
    line: str,
    role_counter: dict[str, int],
    min_occurrences: int,
) -> tuple[str | None, float]:
    """给一行台本分配角色，返回 (role, confidence)"""

    # 规则 B（动词引导冒号）
    m = _RE_ROLE_VERB_COLON.match(line)
    if m:
        role = m.group(1).strip()
        cnt = role_counter.get(role, 0)
        if cnt >= min_occurrences:
            return role, 0.95
        return None, 0.0

    # 规则 A（行首冒号）
    m = _RE_ROLE_COLON.match(line)
    if m:
        role = m.group(1).strip()
        cnt = role_counter.get(role, 0)
        if cnt >= min_occurrences:
            return role, 0.95
        return None, 0.0

    # 规则 D（全大写英文 — 在前面的 line-by-line 遍历里已处理，这里兜底）
    m = _RE_ROLE_ENGLISH.match(line)
    if m:
        role = m.group(0).strip()
        cnt = role_counter.get(role, 0)
        if cnt >= min_occurrences:
            return role, 0.9
        return None, 0.0

    # 规则 C（引号后置说话人）
    m = _RE_ROLE_QUOTE.search(line)
    if m:
        role = m.group(1).strip()
        cnt = role_counter.get(role, 0)
        if cnt >= min_occurrences:
            return role, 0.7
        return None, 0.0

    # 旁白
    return None, 1.0


def _strip_role_prefix(line: str, role: str | None) -> str:
    """去掉行首的角色标记（张三：/ 张三说：），返回纯台词"""
    if role is None:
        return line

    # 规则 B 前缀 "角色说："
    m = _RE_ROLE_VERB_COLON.match(line)
    if m and m.group(1).strip() == role:
        # 保留冒号后的内容
        idx = line.index(m.group(0))
        rest = line[idx + len(m.group(0)):]
        return rest.strip()

    # 规则 A 前缀 "角色："
    m = _RE_ROLE_COLON.match(line)
    if m and m.group(1).strip() == role:
        idx = line.index(m.group(0))
        rest = line[idx + len(m.group(0)):]
        return rest.strip()

    return line


def _is_chapter_title(line: str) -> bool:
    """判断某行是否是章节标题（不应当成台词分段）"""
    if _RE_CN_CHAPTER.match(line):
        return True
    if _RE_MD_HEADING.match(line):
        return True
    if _RE_SCENE.match(line):
        return True
    return False


def _split_lines(text: str) -> list[str]:
    """按换行拆行，保留空行"""
    return text.split("\n")


def _role_confidence(occurrences: int, min_occ: int) -> float:
    """根据出现次数计算置信度"""
    if occurrences >= 5:
        return 0.98
    if occurrences >= 3:
        return 0.95
    if occurrences >= min_occ:
        return 0.80
    return 0.50
