# Ngrok 快速使用指南

## 🚀 快速开始（3 步搞定）

### 步骤 1: 安装 ngrok

```powershell
# 使用 winget（推荐）
winget install ngrok.ngrok

# 或使用 Chocolatey
choco install ngrok
```

### 步骤 2: 一键启动开发环境

```powershell
# 在项目根目录
.\backend\scripts\start-dev.ps1
```

**这个脚本会自动：**
- ✅ 检查并安装 ngrok
- ✅ 启动 ngrok 隧道
- ✅ 获取公网 URL
- ✅ 自动更新 `.env` 文件
- ✅ 启动后端服务

### 步骤 3: 测试

```powershell
# 新开一个终端
curl http://127.0.0.1:8002/health

# 使用公网 URL 测试（替换为你的实际 URL）
curl https://abcd1234.ngrok.io/health
```

## 📋 详细使用方法

### 方法 A: 一键启动（推荐）

```powershell
# 启动 ngrok + 后端
.\backend\scripts\start-dev.ps1

# 参数
.\backend\scripts\start-dev.ps1 -Port 8002      # 指定端口
.\backend\scripts\start-dev.ps1 -SkipNgrok      # 跳过 ngrok
.\backend\scripts\start-dev.ps1 -NoReload       # 禁用热重载
```

### 方法 B: 手动启动

```powershell
# 1. 启动 ngrok
.\backend\scripts\start-ngrok.ps1

# 2. 手动更新 backend\.env
# 添加：PUBLIC_BASE_URL=https://xxxx.ngrok.io

# 3. 启动后端
cd backend
.\.venv\Scripts\activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002 --reload
```

### 方法 C: 完全手动

```powershell
# 1. 启动 ngrok（新窗口）
ngrok http 8002

# 2. 复制显示的 URL（如：https://abcd1234.ngrok.io）

# 3. 编辑 backend\.env，添加：
PUBLIC_BASE_URL=https://abcd1234.ngrok.io

# 4. 重启后端
```

## 🔧 常用命令

### 检查 ngrok 状态

```powershell
# 查看隧道信息
Invoke-RestMethod http://localhost:4040/api/tunnels

# 打开 ngrok Web 界面
Start-Process http://localhost:4040
```

### 测试 API

```powershell
# 健康检查
curl http://127.0.0.1:8002/health

# 获取声音列表
curl http://127.0.0.1:8002/api/clone/list

# 使用公网 URL 测试
$ngrokUrl = "https://abcd1234.ngrok.io"  # 替换为实际 URL
curl "$ngrokUrl/health"
```

### 运行克隆测试

```powershell
# 使用现有音频文件测试克隆
backend\.venv\Scripts\python.exe tests\webapp-testing\test_existing_audio_clone.py
```

## 📁 项目文件结构

```
voice_clone/
├── backend/
│   ├── .env                           # 环境变量（包含 PUBLIC_BASE_URL）
│   ├── .env.ngrok.example             # ngrok 配置示例
│   └── scripts/
│       ├── start-ngrok.ps1            # ngrok 启动脚本
│       └── start-dev.ps1              # 一键开发环境启动
├── scripts/
│   └── ngrok-setup.md                 # 详细配置文档
└── tests/
    └── webapp-testing/
        ├── test_existing_audio_clone.py   # 音频克隆测试
        └── test_qwen_integration.py       # Qwen 集成测试
```

## ⚠️ 常见问题

### Q1: ngrok URL 每次都变怎么办？

**A:** 免费版本确实会变化。解决方案：

1. **使用自动化脚本**（推荐）
   ```powershell
   # 每次启动时自动更新 .env
   .\backend\scripts\start-dev.ps1
   ```

2. **使用固定域名**（付费）
   - 购买 ngrok 付费套餐
   - 在 `.env.ngrok` 中配置 `NGROK_DOMAIN`

3. **使用国内替代**
   - natapp: https://natapp.cn/
   - 神卓互联：https://www.zhexitech.com/

### Q2: 声音克隆失败，提示需要公网 URL

**A:** 检查以下几点：

1. **确认 `.env` 文件已更新**
   ```bash
   # backend/.env 中应该有：
   PUBLIC_BASE_URL=https://xxxx.ngrok.io
   ```

2. **重启后端服务**
   ```powershell
   # 停止当前后端（Ctrl+C）
   # 重新启动
   cd backend
   .\.venv\Scripts\activate
   python -m uvicorn main:app --host 127.0.0.1 --port 8002 --reload
   ```

3. **验证 URL 是否可访问**
   ```powershell
   # 在浏览器中打开
   Start-Process "$ngrokUrl/health"
   ```

### Q3: ngrok 连接不稳定

**A:** 

1. **设置认证令牌**
   ```powershell
   # 获取 token: https://dashboard.ngrok.com/get-started/your-authtoken
   ngrok authtoken YOUR_TOKEN_HERE
   ```

2. **检查网络连接**
   ```powershell
   # 测试 ngrok 服务器连接
   Test-NetConnection tunnel.ngrok.com -Port 443
   ```

3. **使用国内服务**
   - natapp
   - 神卓互联

### Q4: 端口被占用

**A:**

```powershell
# 查看占用端口的进程
Get-NetTCPConnection -LocalPort 8002 | Select-Object OwningProcess | Get-Unique

# 停止占用端口的进程（谨慎使用）
Stop-Process -Id <PID> -Force
```

## 🎯 验证清单

启动后，按以下顺序验证：

- [ ] ngrok 已启动（查看 ngrok 窗口）
- [ ] 获取到公网 URL（如：https://abcd1234.ngrok.io）
- [ ] `.env` 文件中 `PUBLIC_BASE_URL` 已更新
- [ ] 后端服务已启动（http://127.0.0.1:8002）
- [ ] 本地健康检查通过：`curl http://127.0.0.1:8002/health`
- [ ] 公网健康检查通过：`curl https://xxxx.ngrok.io/health`
- [ ] 声音克隆测试通过

## 📞 获取帮助

- **详细文档**: `scripts\ngrok-setup.md`
- **ngrok 官方文档**: https://ngrok.com/docs
- **Qwen API 文档**: https://help.aliyun.com/zh/model-studio/developer-reference/cosyvoice

## 💡 最佳实践

1. **开发时始终使用一键启动脚本**
   - 自动处理所有配置
   - 避免手动错误

2. **定期更新 ngrok**
   ```powershell
   winget upgrade ngrok.ngrok
   ```

3. **保存 ngrok URL**
   - 启动后复制 URL 到笔记
   - 方便后续测试使用

4. **测试前检查配置**
   ```powershell
   # 检查 .env 文件
   cat backend\.env | Select-String "PUBLIC_BASE_URL"
   ```

## 🔄 下次启动

下次开发时，只需运行：

```powershell
.\backend\scripts\start-dev.ps1
```

一切都会自动配置好！
