"""
声音描述功能 API 测试

测试场景：
1. 更新不存在声音的描述应返回 404
2. pitch/speed 范围校验：拒绝超范围值，接受边界值
"""

import requests

BACKEND_URL = "http://127.0.0.1:8002"


def test_update_description_not_found():
    """测试更新不存在声音的描述应返回 404"""
    print("\n" + "=" * 60)
    print("测试: 更新不存在声音的描述 -> 404")
    print("=" * 60)

    resp = requests.patch(
        f"{BACKEND_URL}/api/clone/nonexistent-id/description",
        json={"description": "test"},
        timeout=10
    )
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
    print("[PASS] 正确返回 404")


def test_pitch_speed_validation():
    """测试 Pydantic pitch/speed 校验：超范围应返回 422，边界值应通过"""
    print("\n" + "=" * 60)
    print("测试: pitch/speed 范围校验")
    print("=" * 60)

    # speed 超范围
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "speed": 3.0, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code == 422, f"Expected 422 for invalid speed, got {resp.status_code}"
    print("[PASS] speed=3.0 被拒绝 (422)")

    # pitch 超范围
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "pitch": 0.1, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code == 422, f"Expected 422 for invalid pitch, got {resp.status_code}"
    print("[PASS] pitch=0.1 被拒绝 (422)")

    # 边界值应通过校验（不返回 422，即使后续因 voice_id 不存在而失败）
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "speed": 0.5, "pitch": 2.0, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code != 422, f"边界值不应返回 422, got {resp.status_code}"
    print("[PASS] speed=0.5, pitch=2.0 通过校验")


if __name__ == "__main__":
    test_update_description_not_found()
    test_pitch_speed_validation()
    print("\n" + "=" * 60)
    print("所有测试通过!")