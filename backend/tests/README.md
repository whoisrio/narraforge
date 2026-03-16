# Voice Clone Studio 测试框架

基于 TDD (测试驱动开发) 的测试框架，为 Voice Clone Studio 项目提供全面的测试覆盖。

## 测试结构

```
tests/
├── conftest.py              # pytest 配置和夹具
├── run_tests.py            # 测试运行脚本
├── unit/                   # 单元测试
│   ├── test_voice_profile_model.py
│   └── test_qwen_tts_service.py
├── integration/            # 集成测试
│   ├── test_clone_api.py
│   └── test_tts_api.py
└── fixtures/              # 测试夹具
    ├── __init__.py
    └── factories.py
```

## 测试类型

### 1. 单元测试 (Unit Tests)
- **位置**: `tests/unit/`
- **目的**: 测试独立的函数、类和方法
- **特点**: 快速、隔离、无外部依赖
- **示例**: 模型验证、服务方法测试

### 2. 集成测试 (Integration Tests)
- **位置**: `tests/integration/`
- **目的**: 测试组件之间的交互
- **特点**: 涉及数据库、API 端点、外部服务模拟
- **示例**: API 端点测试、数据库操作测试

### 3. API 测试 (API Tests)
- **位置**: `tests/integration/` (标记为 `@pytest.mark.api`)
- **目的**: 测试 HTTP API 端点
- **特点**: 使用 FastAPI TestClient，模拟真实请求

## 测试标记

pytest 支持以下标记：

| 标记 | 描述 | 使用示例 |
|------|------|----------|
| `@pytest.mark.unit` | 单元测试 | `@pytest.mark.unit` |
| `@pytest.mark.integration` | 集成测试 | `@pytest.mark.integration` |
| `@pytest.mark.api` | API 测试 | `@pytest.mark.api` |
| `@pytest.mark.slow` | 慢速测试 | `@pytest.mark.slow` |
| `@pytest.mark.db` | 数据库测试 | `@pytest.mark.db` |

## 测试夹具 (Fixtures)

### 核心夹具

| 夹具 | 作用域 | 描述 |
|------|--------|------|
| `db_session` | 函数 | 数据库会话，每个测试后回滚 |
| `client` | 函数 | FastAPI TestClient |
| `mock_tts_service` | 函数 | 模拟的 Qwen TTS 服务 |
| `sample_audio_file` | 函数 | 测试用的音频文件 |
| `test_voice_data` | 函数 | 测试用的声音数据 |

### 使用示例

```python
def test_example(client: TestClient, db_session):
    # 使用测试客户端和数据库会话
    response = client.get("/api/endpoint")
    assert response.status_code == 200
```

## 运行测试

### 1. 安装测试依赖

```bash
# 进入项目目录
cd backend

# 安装测试依赖
pip install -r requirements-test.txt

# 或者使用测试脚本
python tests/run_tests.py install
```

### 2. 运行测试

```bash
# 运行所有测试
python tests/run_tests.py all

# 运行单元测试
python tests/run_tests.py unit

# 运行集成测试
python tests/run_tests.py integration

# 运行 API 测试
python tests/run_tests.py api

# 带覆盖率报告
python tests/run_tests.py all --coverage

# 详细输出
python tests/run_tests.py all --verbose
```

### 3. 直接使用 pytest

```bash
# 运行所有测试
pytest

# 运行特定测试文件
pytest tests/unit/test_voice_profile_model.py

# 运行标记的测试
pytest -m unit
pytest -m integration
pytest -m api

# 带覆盖率
pytest --cov=app --cov-report=html
```

### 4. 代码质量检查

```bash
# 代码风格检查
python tests/run_tests.py lint

# 类型检查
python tests/run_tests.py types

# 生成覆盖率报告
python tests/run_tests.py coverage
```

## TDD 工作流

### 1. 编写测试 (RED)
```python
def test_new_feature():
    # 编写会失败的测试
    result = new_function()
    assert result == expected_value
```

### 2. 运行测试 (验证失败)
```bash
pytest tests/unit/test_new_feature.py -v
```

### 3. 实现功能 (GREEN)
实现最小代码使测试通过。

### 4. 运行测试 (验证通过)
```bash
pytest tests/unit/test_new_feature.py -v
```

### 5. 重构 (IMPROVE)
优化代码，保持测试通过。

### 6. 验证覆盖率
```bash
pytest --cov=app --cov-report=term-missing
```

## 测试覆盖率要求

- **目标**: 80%+ 覆盖率
- **检查**: `pytest --cov=app --cov-report=html`
- **报告**: 生成在 `coverage_html/` 目录

## 模拟外部服务

### Qwen TTS 服务模拟

```python
def test_with_mock(mock_tts_service):
    # 配置模拟行为
    mock_tts_service.synthesize_speech.return_value = b"audio_data"

    # 测试代码
    result = call_tts_service()

    # 验证调用
    mock_tts_service.synthesize_speech.assert_called_once_with(...)
```

### HTTP 请求模拟

```python
def test_http_request(mock_http_client):
    # 测试使用 httpx 的代码
    response = await make_http_request()

    # 验证模拟调用
    mock_http_client.post.assert_called_once_with(...)
```

## 测试数据工厂

使用 `factories.py` 创建测试数据：

```python
from tests.fixtures.factories import VoiceProfileFactory

# 创建测试对象
voice = VoiceProfileFactory.create(name="Test Voice")

# 创建已克隆的声音
cloned_voice = VoiceProfileFactory.create_cloned(name="Cloned Voice")
```

## 最佳实践

### 1. 测试独立性
- 每个测试应该独立运行
- 不依赖其他测试的状态
- 使用夹具进行设置和清理

### 2. 测试命名
- 使用 `test_` 前缀
- 描述性名称：`test_功能_场景_期望结果`
- 示例：`test_upload_voice_success`

### 3. 断言明确
- 一个测试一个断言（或相关断言）
- 使用明确的错误消息
- 验证实际行为，而不是实现细节

### 4. 边缘情况
- 测试无效输入
- 测试边界条件
- 测试错误处理
- 测试并发场景

### 5. 性能考虑
- 标记慢速测试为 `@pytest.mark.slow`
- 使用 `--quick` 跳过慢速测试
- 避免在测试中 sleep

## 故障排除

### 常见问题

1. **数据库连接错误**
   - 检查 `conftest.py` 中的数据库配置
   - 确保使用内存数据库进行测试

2. **导入错误**
   - 检查 Python 路径
   - 确保安装了所有依赖

3. **测试失败**
   - 检查测试数据
   - 验证模拟配置
   - 查看详细的错误输出

### 调试测试

```bash
# 显示详细输出
pytest -v

# 显示打印输出
pytest -s

# 只运行失败的测试
pytest --lf

# 进入调试器
pytest --pdb
```

## 持续集成

建议在 CI/CD 流水线中包含：

```yaml
# 示例 GitHub Actions 配置
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
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

## 更新日志

### v1.0.0
- 初始测试框架
- 单元测试：模型和服务
- 集成测试：API 端点
- 完整的 TDD 工作流支持