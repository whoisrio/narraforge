"""edge-tts WebSocket 协议层（纯函数/类，零第三方依赖）

从 spike/cf-workers/src/edge_tts_ws.py 提炼的传输无关协议逻辑：
Sec-MS-GEC token、speech.config / SSML 消息构造、二进制帧解析与跨帧重组。

协议参考：edge_tts/communicate.py (v7.x)；坑位证据：spike/cf-workers/VERDICT.md。
本模块不得 import workers/js/pyodide —— 传输层在 edge_tts_ws_client.py。

与 spike 的两处有意差异：
- mkssml 对文本做 XML 转义（spike 原样插入，含 & < > 的文本会让服务端解析失败）。
- 所有含时间/随机性的函数接受可选注入参数，便于确定性测试。
"""

import hashlib
import struct
import time
import uuid
from functools import lru_cache
from xml.sax.saxutils import escape as _xml_escape

# --- constants (mirrors edge_tts/constants.py) -------------------------------
BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
CHROMIUM_FULL_VERSION = "143.0.3650.75"
CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".", maxsplit=1)[0]
# v2 前缀与 token 格式必须同时升级（服务端按 `2-`/`1-` 前缀选择 token 校验方式，
# 版本号本身不校验，但裸 `2-` 会被拒，见 edge-tts PR #492 实测）。
SEC_MS_GEC_VERSION = f"2-{CHROMIUM_FULL_VERSION}"
WIN_EPOCH = 11644473600
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# 服务端要求 WS 握手带齐这些浏览器头，否则拒绝（1006，见 VERDICT.md CP1 坑 1）
WSS_HEADERS = {
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/{0}.0.0.0 Safari/537.36 Edg/{0}.0.0.0".format(
            CHROMIUM_MAJOR_VERSION
        )
    ),
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
}


def generate_sec_ms_gec(now: float | None = None) -> str:
    """v1 token：SHA256(win32_filetime_ticks_rounded_to_5min + trusted token), upper hex。

    已淘汰：微软 2026-10 起强制 v2，v1 token 一律 403。保留作算法参考与测试。
    """
    ticks = (time.time() if now is None else now) + WIN_EPOCH
    ticks -= ticks % 300
    ticks *= 10**9 / 100  # 100-ns intervals
    str_to_hash = f"{ticks:.0f}{TRUSTED_CLIENT_TOKEN}"
    return hashlib.sha256(str_to_hash.encode("ascii")).hexdigest().upper()


# --- Sec-MS-GEC v2 DRM ---------------------------------------------------------
# 微软 2026-10 起强制 v2 token（v1 一律 403）。算法移植自 edge-tts 7.3.x drm.py
# （PR #492，线上抓包逐字节验证）。要点：
# - 与 v1 哈希同一 <ticks><trusted client token> 串（ticks 同样取 5 分钟窗口）；
# - 但摘要走「魔改 SHA-256 + CS64」双通道，产出 <16 hex>-<64 hex>；
# - 魔改 SHA-256 在标准 FIPS 180-4 常数上做了多处替换/调整，并把一个
#   微软版权常量前缀以预计算 state 形式折叠进初始状态 —— 因此 hashlib 不适用，
#   必须用下面的纯 Python 实现。
# 任何常数都不能改动，改动即 token 失效。

_U32_MASK = 0xFFFFFFFF

# 魔改 SHA-256 常数表（盐值前缀已折叠进 _V2_SHA256_STATE）
_V2_SHA256_INITIAL = (
    0x6A09E667,
    0xBB67AE85,
    0x3C6EF372,
    0xA54FF53A,
    0x510E527F,
    0x9B05688C,
    0x1F83D9AB,
    0x5BE0CD19,
)
_V2_SHA256_STATE = (
    0xFD9FBEA2,
    0x91243CE7,
    0xBE499094,
    0xCD2E1E0A,
    0x6C006F49,
    0x04BD35AB,
    0xFEB0A7E4,
    0x03EFFBD2,
)
_V2_SHA256_SCHEDULE = (
    0xEB24BF9E,
    0x1558691F,
    0xA0C09EE2,
    0x0CFA32BA,
    0xA622EE8C,
    0xD1DD9491,
    0xC0DD25A0,
    0xF9E70AB6,
    0xF0C31573,
    0x7058CE4E,
    0x7188E606,
    0x00E5AB33,
    0xD258B060,
    0x72766564,
)
_V2_SHA256_ROUND_CONSTANTS = (
    0x428A2F98,
    0x71374491,
    0xB5C0FBCF,
    0xE9B5DBA5,
    0x3956C25B,
    0x59F111F1,
    0x923F82A4,
    0xAB1C5ED5,
    0xD807AA98,
    0x12835B01,
    0x243185BE,
    0x550C7DC3,
    0x72BE5D74,
    0x80DEB1FE,
    0x9BDC06A7,
    0xC19BF174,
    0xE49B69C1,
    0xEFBE4786,
    0x0FC19DC6,
    0x240CA1CC,
    0x2DE92C6F,
    0x4A7484AA,
    0x5CB0A9DC,
    0x76F988DA,
    0x983E5152,
    0xA831C66D,
    0xB00327C8,
    0xBF597FC7,
    0xC6E00BF3,
    0xD5A79147,
    0x06CA6351,
    0x14292967,
    0x27B70A85,
    0x2E1B2138,
    0x4D2C6DFC,
    0x53380D13,
    0x650A7354,
    0x766A0ABB,
    0x81C2C92E,
    0x92722C85,
    0xA2BFE8A1,
    0xA81A664B,
    0xC24B8B70,
    0xC76C51A3,
    0xD192E819,
    0xD6990624,
    0xF40E3585,
    0x106AA070,
    0x19A4C116,
    0x1E376C08,
    0x2748774C,
    0x34B0BCB5,
    0x391C0CB3,
    0x4ED8AA4A,
    0x5B9CCA4F,
    0x682E6FF3,
    0x748F82EE,
    0x78A5636F,
    0x84C87814,
    0x8CC70208,
    0x90BEFFFA,
    0xA4506CEB,
    0xBEF9A3F7,
    0xC67178F2,
)
# 版权常量载体：第 15 个轮常数被替换，盐值块的 sigma 计算也被加扰
_V2_SHA256_ADJUSTMENT = 0xC9DC06A7
_V2_SHA256_BLOCK_CONSTANTS = (
    _V2_SHA256_ROUND_CONSTANTS[:14]
    + (_V2_SHA256_ADJUSTMENT,)
    + _V2_SHA256_ROUND_CONSTANTS[15:]
)
_V2_SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80
_V2_SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0

# CS64 摘要常数（乘法-旋转混淆）
_V2_CS64_COEFFICIENTS = (
    (0xE82E91B1, 0xB32700D0),
    (0x44DE24C6, 0x88DFF51D),
    (0x3BEB65BC, 0x29514038),
    (0xC89C5933, 0xB328CBDF),
    (0x8D1EC211, 0xD405B4D5),
    (0x314EF5D5, 0x26E55F3C),
    (0xE92491B1, 0x607801C6),
    (0xF0A5B9D5, 0x82B2C1FB),
    (0x06064CF3, 0xFA51A3DA),
    (0xDA79FA60, 0x207CC464),
    (0xBED20560, 0x3C3C74F3),
    (0x89F9C9F8, 0xD2D14B61),
    (0x35FA38C6, 0xBB04A2C1),
    (0xCB49E3C6, 0xC5626167),
)
_V2_CS64_FACTOR = 0x82893933
_V2_CS64_ADJUSTMENT0 = 0xF2F90B1A
_V2_CS64_ADJUSTMENT1 = 0x0B1A0000


def _v2_rol16(value: int) -> int:
    """32-bit 值循环左移 16 位（等价于高低 16 位交换）。"""
    value &= _U32_MASK
    return ((value << 16) | (value >> 16)) & _U32_MASK


def _v2_words_le4_even(data: bytes) -> list[int]:
    """按小端 32-bit 字切分，补零到偶数字数。"""
    padded = data + b"\x00" * ((-len(data)) % 4)
    if not padded:
        return []
    words = list(struct.unpack(f"<{len(padded) // 4}I", padded))
    if len(words) % 2:
        words.append(0)
    return words


def _v2_sigma0(value: int) -> int:
    """SHA-256 小 sigma0（旋转合并后一次截断）。"""
    return (
        (value >> 7) ^ (value << 25) ^ (value >> 18) ^ (value << 14) ^ (value >> 3)
    ) & _U32_MASK


def _v2_sigma1(value: int) -> int:
    """SHA-256 小 sigma1（旋转合并后一次截断）。"""
    return (
        (value >> 17) ^ (value << 15) ^ (value >> 19) ^ (value << 13) ^ (value >> 10)
    ) & _U32_MASK


def _v2_sha256_rounds(
    state: tuple[int, ...],
    words: list[int],
    constants: tuple[int, ...],
    first_round: int = 0,
) -> tuple[int, ...]:
    """SHA-256 轮函数。数学与标准一致；盐值块从 first_round=14 恢复，
    调用方决定使用哪套轮常数（标准 K / 版权常量替换后的 K'）。"""
    mask = _U32_MASK
    a, b, c, d, e, f, g, h = state
    for index in range(first_round, 64):
        # 乘 0x100000001 后右移 = 32-bit 循环移位的低位，高位由最终掩码截断
        rot_e = e * 0x100000001
        rot_a = a * 0x100000001
        t1 = (
            h
            + ((rot_e >> 6) ^ (rot_e >> 11) ^ (rot_e >> 25))
            + (g ^ (e & (f ^ g)))
            + constants[index]
            + words[index]
        )
        t2 = ((rot_a >> 2) ^ (rot_a >> 13) ^ (rot_a >> 22)) + ((a & b) | (c & (a | b)))
        a, b, c, d, e, f, g, h = (t1 + t2) & mask, a, b, c, (d + t1) & mask, e, f, g
    return a, b, c, d, e, f, g, h


def _v2_expand_schedule(words: list[int], first_word: int = 16) -> None:
    """SHA-256 消息扩展（旋转先合并、求和后一次截断），原地追加到 64 字。"""
    mask = _U32_MASK
    for index in range(first_word, 64):
        x, y = words[index - 2], words[index - 15]
        sigma1 = (x >> 17) ^ (x << 15) ^ (x >> 19) ^ (x << 13) ^ (x >> 10)
        sigma0 = (y >> 7) ^ (y << 25) ^ (y >> 18) ^ (y << 14) ^ (y >> 3)
        words.append((sigma1 + words[index - 7] + sigma0 + words[index - 16]) & mask)


@lru_cache(maxsize=1)
def _v2_sha256_init(salt: bytes) -> tuple[int, ...]:
    """把 7 字节盐值通过版权常量块折叠进 SHA-256 初始状态。

    魔改点：消息前两字由 _V2_SHA256_SCHEDULE 提供、扩展时 index 16/29 的
    sigma 值被 XOR 加扰、word30 携带轮常数修正、轮常数用替换后的 K'，
    起始状态为预计算的 _V2_SHA256_STATE（即版权常量前缀）。
    """
    mask = _U32_MASK
    words = [0] * 14 + [int.from_bytes(salt[:3], "big")]
    words.append(int.from_bytes(salt[3:7], "big"))
    for index in range(16, 30):
        value = _V2_SHA256_SCHEDULE[index - 16]
        if index - 2 >= 14:
            value += (
                (_v2_sigma1(words[index - 2]) ^ _V2_SHA256_SIGMA1_ADJUSTMENT)
                if index == 16
                else _v2_sigma1(words[index - 2])
            )
        if index - 7 >= 14:
            value += words[index - 7]
        if index - 15 >= 14:
            value += (
                (_v2_sigma0(words[index - 15]) ^ _V2_SHA256_SIGMA0_ADJUSTMENT)
                if index == 29
                else _v2_sigma0(words[index - 15])
            )
        words.append(value & mask)
    words.append(
        (
            _v2_sigma1(words[28])
            + words[23]
            + _v2_sigma0(words[15])
            + words[14]
            + _V2_SHA256_ADJUSTMENT
            - _V2_SHA256_ROUND_CONSTANTS[14]
        )
        & mask
    )
    _v2_expand_schedule(words, 31)
    working = _v2_sha256_rounds(
        _V2_SHA256_STATE, words, _V2_SHA256_BLOCK_CONSTANTS, first_round=14
    )
    return tuple((x + y) & mask for x, y in zip(_V2_SHA256_INITIAL, working))


def _v2_sha256_digest(data: bytes) -> bytes:
    """对 token 数据做魔改 SHA-256：前 7 字节作盐折叠进初始状态，其余走标准填充。"""
    if len(data) < 7:
        raise ValueError("token 数据至少 7 字节")
    mask = _U32_MASK
    length = 57 + len(data)
    padded = data[7:] + b"\x80" + b"\x00" * ((55 - length) % 64)
    padded += struct.pack(">Q", length * 8)
    state = _v2_sha256_init(data[:7])
    block_size = 64
    for offset in range(0, len(padded), block_size):
        end = offset + block_size
        words = list(struct.unpack(">16I", padded[offset:end]))
        _v2_expand_schedule(words)
        working = _v2_sha256_rounds(state, words, _V2_SHA256_ROUND_CONSTANTS)
        state = tuple((x + y) & mask for x, y in zip(state, working))
    return struct.pack(">8I", *state)


def _v2_cs64_digest(data: bytes, digest: bytes) -> tuple[int, int]:
    """CS64 摘要：以 SHA-256 摘要前 8 字节为双密钥的乘法-旋转混淆，返回两个 32-bit 字。"""
    mask = _U32_MASK
    key_a, key_b = struct.unpack_from("<II", digest)
    key_a |= 1
    key_b |= 1
    factors = (
        (key_a * _V2_CS64_FACTOR) & mask,
        (key_b * _V2_CS64_FACTOR) & mask,
    )
    terms = [
        (coefficient * factors[index % 2]) & mask
        for index, (coefficient, _) in enumerate(_V2_CS64_COEFFICIENTS)
    ]
    offsets = [offset for _, offset in _V2_CS64_COEFFICIENTS]
    for index, word in enumerate(_v2_words_le4_even(b"\x00" + data)):
        term = word * (key_a if index % 2 == 0 else key_b)
        offset = _v2_rol16(word) * (0xEF0569FB if index % 2 == 0 else 0xC31713DB)
        if index == 0:
            term += _V2_CS64_ADJUSTMENT0 * factors[0]
            offset += _V2_CS64_ADJUSTMENT1
        terms.append(term & mask)
        offsets.append(offset & mask)
    swap_acc = swap_last = state = acc = 0
    for index in range(0, len(terms), 2):
        x, y = terms[index], terms[index + 1]
        t = _v2_rol16((offsets[index] + x) & mask)
        q = (t * 0x76F50F34) & mask
        swap_acc += (_v2_rol16(q) * 0xC3EFEA97 + q) & mask
        t = _v2_rol16((offsets[index + 1] + y) & mask)
        q = (t * 0x1881CE3C) & mask
        swap_last = (_v2_rol16(q) * 0x35BD1EC9 + q) & mask
        swap_acc = (swap_acc + swap_last) & mask

        state = (state * key_a + x) & mask
        state = (_v2_rol16(state) * 0xCF98B111) & mask
        state = (_v2_rol16(state) * 0x87085B9F) & mask
        state = (_v2_rol16(state) * 0x12CEB96D) & mask
        state = (_v2_rol16(state) * 0x257E1D83) & mask
        acc += state
        t = (state * key_b + y) & mask
        t = (_v2_rol16(t) * 0xA27416F5) & mask
        t = (_v2_rol16(t) * 0xD38396FF) & mask
        state = (_v2_rol16((_v2_rol16(t) * 0x7C932B89) & mask) * 0xBFA49F69) & mask
        acc = (acc + state) & mask
    return swap_last ^ state, swap_acc ^ acc


@lru_cache(maxsize=1)
def _v2_token_hash(data: bytes) -> tuple[str, str]:
    """token 数据的双通道摘要：(CS64 hex, SHA256 hex)，均大写。"""
    digest = _v2_sha256_digest(data)
    cs64 = struct.pack("<II", *_v2_cs64_digest(data, digest)).hex().upper()
    return cs64, digest.hex().upper()


def generate_sec_ms_gec_v2(now: float | None = None) -> str:
    """v2 token：`<CS64>-<SHA256>`，格式 <16 hex>-<64 hex>。

    哈希串与 v1 相同（<ticks><trusted client token>，ticks 取 5 分钟窗口），
    但摘要走魔改 SHA-256 + CS64。微软 2026-10 起强制，v1 一律 403。
    """
    ticks = (time.time() if now is None else now) + WIN_EPOCH
    ticks -= ticks % 300
    ticks *= 10**9 / 100
    str_to_hash = f"{ticks:.0f}{TRUSTED_CLIENT_TOKEN}".encode("ascii")
    cs64, sha256_hex = _v2_token_hash(str_to_hash)
    return f"{cs64}-{sha256_hex}"


def connect_id() -> str:
    return uuid.uuid4().hex


def date_to_string(now: float | None = None) -> str:
    return time.strftime(
        "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)",
        time.gmtime(time.time() if now is None else now),
    )


def mkssml(
    voice: str,
    text: str,
    rate: str = "+0%",
    volume: str = "+0%",
    pitch: str = "+0Hz",
) -> str:
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"
        f"<voice name='{voice}'>"
        f"<prosody pitch='{pitch}' rate='{rate}' volume='{volume}'>"
        f"{_xml_escape(text)}"
        "</prosody>"
        "</voice>"
        "</speak>"
    )


def speech_config_msg(now: float | None = None) -> str:
    return (
        f"X-Timestamp:{date_to_string(now)}\r\n"
        "Content-Type:application/json; charset=utf-8\r\n"
        "Path:speech.config\r\n\r\n"
        '{"context":{"synthesis":{"audio":{"metadataoptions":{'
        '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"'
        "},"
        f'"outputFormat":"{OUTPUT_FORMAT}"'
        "}}}}\r\n"
    )


def ssml_msg(ssml: str, request_id: str | None = None, now: float | None = None) -> str:
    return (
        f"X-RequestId:{request_id or connect_id()}\r\n"
        "Content-Type:application/ssml+xml\r\n"
        f"X-Timestamp:{date_to_string(now)}Z\r\n"  # trailing Z: MS quirk, see edge-tts
        "Path:ssml\r\n\r\n"
        f"{ssml}"
    )


def build_wss_url(now: float | None = None, connection_id: str | None = None) -> str:
    """完整 WS 连接 URL（含 Sec-MS-GEC v2 鉴权参数）。"""
    return (
        f"wss://{BASE_URL}/edge/v1?TrustedClientToken={TRUSTED_CLIENT_TOKEN}"
        f"&ConnectionId={connection_id or connect_id()}"
        f"&Sec-MS-GEC={generate_sec_ms_gec_v2(now)}"
        f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    )


def parse_binary_frame(payload: bytes) -> tuple[dict, bytes]:
    """解析服务端二进制帧为 (headers, data)。

    坑（VERDICT.md CP1 坑 3，与 edge_tts get_headers_and_data 一致）：
    header_len 包含自身 2 字节，头部块从 offset 2 开始，
    头部结束后还有 2 字节 \\r\\n 分隔，data 从 header_len + 2 开始。
    """
    header_len = int.from_bytes(payload[:2], "big")
    head = payload[2:header_len]
    data_start = header_len + 2  # skip \r\n after headers
    data = payload[data_start:]
    headers = {}
    for line in head.split(b"\r\n"):
        if b":" in line:
            k, v = line.split(b":", 1)
            headers[k.decode(errors="replace")] = v.decode(errors="replace")
    return headers, data


def parse_text_frame(payload: str) -> dict:
    """解析服务端文本帧的头部块（\\r\\n\\r\\n 之前），返回 headers dict。"""
    head = payload.split("\r\n\r\n", 1)[0]
    headers = {}
    for line in head.split("\r\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k] = v
    return headers


class TurnAssembler:
    """跨帧音频重组：收集 Path:audio 帧的数据，直到 Path:turn.end。"""

    def __init__(self) -> None:
        self._audio = bytearray()
        self.ended = False

    @property
    def audio_bytes(self) -> bytes:
        return bytes(self._audio)

    def feed_text(self, payload: str) -> str:
        """喂入文本帧，返回其 Path；Path:turn.end 时标记结束。"""
        path = parse_text_frame(payload).get("Path", "")
        if path == "turn.end":
            self.ended = True
        return path

    def feed_binary(self, payload: bytes) -> bytes:
        """喂入二进制帧，返回本次的音频数据（非 audio 帧或空数据返回 b""）。"""
        headers, data = parse_binary_frame(payload)
        if headers.get("Path") == "audio" and data:
            self._audio.extend(data)
            return data
        return b""
