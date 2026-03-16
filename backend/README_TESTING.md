# Voice Clone Studio - 测试框架指南

## 概述

这是一个基于 TDD (测试驱动开发) 原则的测试框架，为 Voice Clone Studio 项目提供全面的测试覆盖。

## 快速开始

### 1. 安装测试依赖

```bash
# 进入项目目录
cd backend

# 安装测试依赖
python tests/run_tests.py install

# 或者直接使用 pip
pip install -r requirements-test.txt
```

### 2. 运行测试

```bash
# 运行所有测试
python tests/run_tests.py all

# 或者使用便捷脚本
./test.sh all
test.bat all
```

### 3. 查看测试结果

测试完成后会显示：
- ✅ 通过的测试数量
- ❌ 失败的测试数量
- 📊 覆盖率报告（如果启用）

## 测试结构

### 测试类型

| 类型 | 目录 | 描述 | 运行命令 |
|------|------|------|----------|
| 单元测试 | `tests/unit/` | 测试独立的函数和类 | `python tests/run_tests.py unit` |
| 集成测试 | `tests/integration/` | 测试组件间的交互 | `python tests/run_tests.py integration` |
| API 测试 | `tests/integration/` | 测试 HTTP API 端点 | `python tests/run_tests.py api` |
| 所有测试 | `tests/` | 运行全部测试 | `python tests/run_tests.py all` |

### 测试文件命名

- `test_模块名.py` - 主测试文件
- `test_功能_场景.py` - 特定场景测试
- `test_边界情况.py` - 边缘条件测试

## TDD 工作流程

### 阶段 1: RED (写失败的测试)

```python
# tests/unit/test_new_feature.py
def test_new_feature():
    # 编写会失败的测试
    result = new_function()  # 这个函数还不存在
    assert result == expected_value
```

运行测试确认它失败：
```bash
pytest tests/unit/test_new_feature.py -v
```

### 阶段 2: GREEN (实现最小功能)

```python
# app/模块.py
def new_function():
    return expected_value  # 最小实现
```

运行测试确认它通过：
```bash
pytest tests/unit/test_new_feature.py -v
```

### 阶段 3: REFACTOR (重构改进)

优化代码，保持测试通过。

### 阶段 4: COVERAGE (验证覆盖率)

```bash
pytest --cov=app --cov-report=html
```

打开 `coverage_html/index.html` 查看覆盖率报告。

## 核心测试夹具

### 数据库会话

```python
def test_with_database(db_session):
    # 每个测试都有独立的数据库会话
    # 测试结束后自动回滚
    voice = VoiceProfile(name="Test", audio_path="/tmp/test.wav")
    db_session.add(voice)
    db_session.commit()
```

### FastAPI 测试客户端

```python
def test_api_endpoint(client: TestClient):
    response = client.get("/api/endpoint")
    assert response.status_code == 200
```

### 模拟 Qwen TTS 服务

```python
def test_tts_service(mock_tts_service):
    # 配置模拟行为
    mock_tts_service.synthesize_speech.return_value = b"audio_data"

    # 调用被测试的代码
    result = call_tts_function()

    # 验证模拟被调用
    mock_tts_service.synthesize_speech.assert_called_once()
```

### 测试音频文件

```python
def test_audio_processing(sample_audio_file):
    # 使用真实的音频文件进行测试
    with open(sample_audio_file, "rb") as f:
        audio_data = process_audio(f.read())
```

## 测试示例

### 示例 1: 测试声音上传

```python
def test_upload_voice_success(client: TestClient, sample_audio_file):
    with open(sample_audio_file, "rb") as audio_file:
        files = {"file": ("test.wav", audio_file, "audio/wav")}
        response = client.post("/api/clone/upload", files=files)

    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["name"] == "test.wav"
```

### 示例 2: 测试 TTS 合成

```python
def test_synthesize_speech(client: TestClient, mock_tts_service):
    mock_tts_service.synthesize_speech.return_value = b"synthesized_audio"

    request_data = {
        "text": "Hello world",
        "voice_id": "xiaoyun",
        "speed": 1.2
    }

    response = client.post("/api/tts/synthesize", json=request_data)

    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "Hello world"
    assert data["params"]["speed"] == 1.2
```

### 示例 3: 测试错误处理

```python
def test_voice_not_found(client: TestClient):
    response = client.get("/api/clone/nonexistent_id")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
```

## 测试数据工厂

使用 `factories.py` 创建测试数据：

```python
from tests.fixtures.factories import (
    VoiceProfileFactory,
    create_test_tts_request,
    create_test_clone_request
)

# 创建测试对象
voice = VoiceProfileFactory.create(name="Test Voice")

# 创建测试请求数据
tts_request = create_test_tts_request(text="Custom text")
clone_request = create_test_clone_request(voice_id="custom_id")
```

## 命令行选项

### 基础命令

```bash
# 运行所有测试
python tests/run_tests.py all

# 运行特定类型测试
python tests/run_tests.py unit
python tests/run_tests.py integration
python tests/run_tests.py api

# 代码质量检查
python tests/run_tests.py lint      # 代码风格
python tests/run_tests.py types     # 类型检查
python tests/run_tests.py coverage  # 覆盖率报告
```

### 选项参数

| 选项 | 描述 | 示例 |
|------|------|------|
| `-v, --verbose` | 详细输出 | `python tests/run_tests.py all -v` |
| `-c, --coverage` | 生成覆盖率 | `python tests/run_tests.py all -c` |
| `--quick` | 跳过慢速测试 | `python tests/run_tests.py all --quick` |

### 便捷脚本

```bash
# Linux/Mac
./test.sh unit --coverage --verbose

# Windows
test.bat integration --verbose
```

## 覆盖率要求

- **目标**: 80%+ 覆盖率
- **检查**: `pytest --cov=app --cov-report=term-missing`
- **重点**: 业务逻辑、错误处理、API 端点

## 常见问题

### 1. 导入错误

**问题**: `ModuleNotFoundError: No module named 'app'`

**解决**:
```bash
# 确保在 backend 目录运行
cd backend
export PYTHONPATH=$(pwd)
```

### 2. 数据库错误

**问题**: 数据库表不存在

**解决**: 测试使用内存数据库，会自动创建表。

### 3. 测试太慢

**问题**: 测试运行时间太长

**解决**:
```bash
# 标记慢速测试
@pytest.mark.slow

# 跳过慢速测试
pytest -m "not slow"
python tests/run_tests.py all --quick
```

### 4. 模拟不工作

**问题**: 模拟没有被正确调用

**解决**: 检查模拟配置和调用参数：
```python
# 查看实际调用参数
print(mock_service.method_name.call_args)
```

## 最佳实践

### 1. 测试金字塔
- 70% 单元测试 (快速、隔离)
- 20% 集成测试 (组件交互)
- 10% API/E2E 测试 (端到端)

### 2. 测试命名
- `test_功能_条件_期望`
- `test_upload_voice_success`
- `test_upload_empty_file_error`

### 3. 测试隔离
- 每个测试独立
- 不依赖执行顺序
- 清理测试数据

### 4. 断言明确
- 一个测试一个断言点
- 明确的错误消息
- 验证行为而非实现

### 5. 覆盖率检查
- 每次提交前检查覆盖率
- 重点覆盖业务逻辑
- 忽略生成的代码

## 开发流程

### 1. 新功能开发
```bash
# 1. 写失败的测试
python tests/run_tests.py unit -v > test_output.log

# 2. 实现功能
# 3. 验证测试通过

# 4. 运行集成测试
python tests/run_tests.py integration

# 5. 检查覆盖率
python tests/run_tests.py coverage
```

### 2. Bug 修复
```bash
# 1. 重现 bug 的测试
# 2. 验证测试失败
# 3. 修复 bug
# 4. 验证测试通过
# 5. 运行相关测试
```

### 3. 重构
```bash
# 1. 确保有足够测试
# 2. 运行所有测试
# 3. 进行重构
# 4. 验证测试通过
```

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Run tests
        run: python tests/run_tests.py all --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

## 下一步

### 完成 RED 阶段
当前所有测试都是 RED 状态（会失败），需要：
1. 实现业务逻辑
2. 使测试通过 (GREEN 阶段)
3. 重构改进代码

### 扩展测试
- 添加时间轴 API 测试
- 添加配置 API 测试
- 添加性能测试
- 添加负载测试

### 监控和报告
- 集成测试覆盖率到 CI/CD
- 自动生成测试报告
- 监控测试性能