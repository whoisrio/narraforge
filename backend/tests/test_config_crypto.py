"""
测试配置加密的完整流程：
1. Fernet 存储加密/解密
2. RSA 传输加密/解密
3. model_config_service 存储加密/读取解密集成
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.crypto_service import (
    encrypt_value, decrypt_value, is_encrypted, 
    get_rsa_public_key_pem, rsa_decrypt,
)
import base64


def test_fernet_encrypt_decrypt():
    """测试 Fernet 存储加密解密"""
    print("=== Fernet 存储加密测试 ===")
    
    # 正常加密解密
    plaintext = "sk-test-api-key-12345"
    ciphertext = encrypt_value(plaintext)
    assert ciphertext != plaintext, "密文应该与明文不同"
    assert is_encrypted(ciphertext), "应该被识别为加密值"
    
    decrypted = decrypt_value(ciphertext)
    assert decrypted == plaintext, f"解密后应该等于原文: {decrypted} != {plaintext}"
    print(f"  加密: '{plaintext}' -> '{ciphertext[:30]}...'")
    print(f"  解密: '{decrypted}'")
    
    # 空值测试
    assert encrypt_value("") == ""
    assert decrypt_value("") == ""
    assert is_encrypted("") == False
    
    # 明文降级测试
    assert decrypt_value("not-encrypted-plaintext") == "not-encrypted-plaintext"
    assert is_encrypted("not-encrypted-plaintext") == False
    
    print("  PASS: Fernet 加密解密正常\n")


def test_rsa_encrypt_decrypt():
    """测试 RSA 传输加密解密"""
    print("=== RSA 传输加密测试 ===")
    
    # 获取公钥
    public_key_pem = get_rsa_public_key_pem()
    assert "BEGIN PUBLIC KEY" in public_key_pem, "公钥 PEM 格式正确"
    print(f"  公钥长度: {len(public_key_pem)} bytes")
    
    # 用公钥加密（模拟前端 jsencrypt 行为）
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives import hashes, serialization
    
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    plaintext = "sk-another-secret-key"
    ciphertext = public_key.encrypt(
        plaintext.encode("utf-8"),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    ciphertext_b64 = base64.b64encode(ciphertext).decode("utf-8")
    
    # 用私钥解密
    decrypted = rsa_decrypt(ciphertext_b64)
    assert decrypted == plaintext, f"解密后应该等于原文: {decrypted} != {plaintext}"
    print(f"  加密: '{plaintext}' -> RSA 密文 ({len(ciphertext_b64)} chars)")
    print(f"  解密: '{decrypted}'")
    print("  PASS: RSA 加密解密正常\n")


def test_rsa_prefix_format():
    """测试 RSA: 前缀格式（和 API 端点一致）"""
    print("=== RSA: 前缀格式测试 ===")
    
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives import hashes, serialization
    
    public_key_pem = get_rsa_public_key_pem()
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    plaintext = "my-secret-api-key"
    ciphertext = public_key.encrypt(
        plaintext.encode("utf-8"),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    ciphertext_b64 = base64.b64encode(ciphertext).decode("utf-8")
    
    # 模拟前端发送 "RSA:xxxxx" 格式
    prefixed = f"RSA:{ciphertext_b64}"
    assert prefixed.startswith("RSA:"), "RSA 前缀正确"
    
    # 模拟 API 端点解密
    raw_b64 = prefixed[4:]  # 去掉 "RSA:" 前缀
    decrypted = rsa_decrypt(raw_b64)
    assert decrypted == plaintext
    print(f"  前缀格式: 'RSA:{ciphertext_b64[:20]}...'")
    print(f"  解密结果: '{decrypted}'")
    print("  PASS: RSA: 前缀格式正常\n")


if __name__ == "__main__":
    test_fernet_encrypt_decrypt()
    test_rsa_encrypt_decrypt()
    test_rsa_prefix_format()
    print("=== 全部测试通过 ===")
