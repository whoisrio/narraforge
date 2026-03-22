# Ngrok 集成设计总结

## 📐 设计方案

### 目录结构

```
voice_clone/
├── backend/
│   ├── .env                           # 环境变量配置
│   ├── .env.ngrok.example             # ngrok 配置示例
│   └── scripts/
│       ├── start-ngrok.ps1            # ngrok 启动脚本
│       ├── start-dev.ps1              # 一键开发环境启动
│       └── README-NGROK.md            # 快速使用指南
├── scripts/
│   └── ngrok-setup.md                 # 详细配置文档
└── tests/webapp-testing/
    ├── test_existing_audio_clone.py   # 现有音频克隆测试
    └── test_qwen_integration.py       # Qwen 集成测试
```

## 🎯 核心功能

### 1. 一键启动脚本 (`start-dev.ps1`)

**功能：**
- ✅ 自动检查并安装 ngrok
- ✅ 启动 ngrok 隧道
- ✅ 获取公网 URL
- ✅ 自动更新 `.env` 文件
- ✅ 启动后端服务

**使用方式：**
```powershell
.\backend\scripts\start-dev.ps1
```

**参数选项：**
- `-Port 8002` - 指定端口
- `-SkipNgrok` - 跳过 ngrok 启动
- `-NoReload` - 禁用热重载

### 2. 独立 ngrok 启动脚本 (`start-ngrok.ps1`)

**功能：**
- ✅ 检查 ngrok 安装
- ✅ 检查端口占用
- ✅ 启动 ngrok 隧道
- ✅ 自动获取公网 URL
- ✅ 可选：自动更新 `.env` 文件
- ✅ 可选：打开 ngrok Web 界面

**使用方式：**
```powershell
.\backend\scripts\start-ngrok.ps1
```

**参数选项：**
- `-Port 8002` - 指定端口
- `-NoBrowser` - 不打开浏览器
- `-Verbose` - 详细日志模式

### 3. 配置文件

#### `.env.ngrok.example`
ngrok 配置示例文件，包含：
- `NGROK_AUTH_TOKEN` - 认证令牌
- `NGROK_PORT` - 后端端口
- `NGROK_DOMAIN` - 指定域名

## 📋 使用流程

### 场景 1: 首次使用

```powershell
# 1. 安装 ngrok
winget install ngrok.ngrok

# 2. 一键启动开发环境
.\backend\scripts\start-dev.ps1

# 3. 等待自动配置完成
# - ngrok 启动
# - 获取公网 URL
# - 更新 .env 文件
# - 启动后端服务

# 4. 测试
curl http://127.0.0.1:8002/health
curl https://xxxx.ngrok.io/health
```

### 场景 2: 日常开发

```powershell
# 直接启动开发环境
.\backend\scripts\start-dev.ps1
```

### 场景 3: 只启动 ngrok

```powershell
# 后端已经在运行，只启动 ngrok
.\backend\scripts\start-ngrok.ps1
```

### 场景 4: 测试声音克隆

```powershell
# 1. 确保开发环境已启动
.\backend\scripts\start-dev.ps1

# 2. 运行克隆测试
backend\.venv\Scripts\python.exe tests\webapp-testing\test_existing_audio_clone.py
```

## 🔧 技术细节

### 自动更新 .env 文件

脚本会自动检测并更新 `PUBLIC_BASE_URL`：

```powershell
# 如果已有 PUBLIC_BASE_URL，则更新
$content = $content -replace 'PUBLIC_BASE_URL=.*', "PUBLIC_BASE_URL=$ngrokUrl"

# 如果没有，则添加
$content += "`n# Ngrok 配置`nPUBLIC_BASE_URL=$ngrokUrl"
```

### 获取 ngrok URL

通过 ngrok API 自动获取：

```powershell
$tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels"
$httpsTunnel = $tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
$ngrokUrl = $httpsTunnel.public_url
```

### 错误处理

- ✅ ngrok 未安装 - 提示安装或跳过
- ✅ 端口被占用 - 提示并询问是否继续
- ✅ 无法获取 URL - 提示手动查看 ngrok 窗口
- ✅ .env 文件不存在 - 创建新文件

## 📊 工作流程图

```
┌─────────────────────────────────────────────────────────┐
│                  start-dev.ps1                          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   1. 检查 ngrok 是否安装          │
        │   - 已安装 → 继续                │
        │   - 未安装 → 提示安装或跳过      │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   2. 启动 ngrok 隧道              │
        │   - 后台运行 ngrok http 8002    │
        │   - 等待 5 秒初始化               │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   3. 获取公网 URL                │
        │   - 调用 ngrok API              │
        │   - 最多重试 10 次                │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   4. 更新 .env 文件               │
        │   - 设置 PUBLIC_BASE_URL        │
        │   - 自动保存                    │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   5. 启动后端服务                │
        │   - uvicorn main:app            │
        │   - 端口 8002                    │
        │   - 启用热重载                  │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │   6. 显示配置信息                │
        │   - 本地地址                    │
        │   - 公网地址                    │
        │   - 测试命令                    │
        └─────────────────────────────────┘
```

## ✅ 验证清单

启动后验证：

- [ ] ngrok 窗口已打开
- [ ] 显示公网 URL（如：https://abcd1234.ngrok.io）
- [ ] `.env` 文件中 `PUBLIC_BASE_URL` 已设置
- [ ] 后端服务日志显示 "Uvicorn running on http://127.0.0.1:8002"
- [ ] 本地健康检查：`curl http://127.0.0.1:8002/health` → `{"status":"healthy"}`
- [ ] 公网健康检查：`curl https://xxxx.ngrok.io/health` → `{"status":"healthy"}`
- [ ] 声音克隆测试通过

## 🎯 优势

### 自动化
- ✅ 自动安装 ngrok
- ✅ 自动启动隧道
- ✅ 自动获取 URL
- ✅ 自动更新配置
- ✅ 自动启动后端

### 用户友好
- ✅ 彩色输出
- ✅ 清晰的进度提示
- ✅ 详细的错误信息
- ✅ 交互式确认

### 健壮性
- ✅ 完善的错误处理
- ✅ 超时重试机制
- ✅ 回滚机制
- ✅ 日志记录

### 灵活性
- ✅ 支持自定义端口
- ✅ 支持跳过 ngrok
- ✅ 支持禁用热重载
- ✅ 支持详细日志

## 📝 下一步

1. **运行一键启动**
   ```powershell
   .\backend\scripts\start-dev.ps1
   ```

2. **验证公网访问**
   ```powershell
   curl https://xxxx.ngrok.io/health
   ```

3. **测试声音克隆**
   ```powershell
   backend\.venv\Scripts\python.exe tests\webapp-testing\test_existing_audio_clone.py
   ```

4. **查看测试报告**
   - 检查 `qwen_voice_id` 是否有值
   - 验证 `is_cloned` 是否为 `true`

## 📖 相关文档

- `backend/scripts/README-NGROK.md` - 快速使用指南
- `scripts/ngrok-setup.md` - 详细配置文档
- `.env.ngrok.example` - 配置示例

## 🆘 故障排查

如果遇到问题：

1. **检查 ngrok 状态**
   ```powershell
   Invoke-RestMethod http://localhost:4040/api/tunnels
   ```

2. **查看后端日志**
   - 控制台输出
   - 或 `backend/logs/app.log`（如果配置了文件日志）

3. **验证 .env 配置**
   ```powershell
   cat backend\.env | Select-String "PUBLIC_BASE_URL"
   ```

4. **重新运行测试**
   ```powershell
   backend\.venv\Scripts\python.exe tests\webapp-testing\test_qwen_integration.py
   ```
