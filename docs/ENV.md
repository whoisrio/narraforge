# Environment Variables

<!-- AUTO-GENERATED -->
| Variable | Required | Description | Default | Example |
|----------|----------|-------------|---------|---------|
| `APP_NAME` | Yes | Application name | - | `Voice Clone Studio` |
| `DEBUG` | No | Debug mode | `false` | `true`, `false` |
| `DATABASE_URL` | Yes | Database connection string | - | `sqlite:///./voice_clone.db` |
| `QWEN_API_KEY` | Yes | Qwen API key for voice cloning | - | `sk-...` |
| `QWEN_MODEL` | No | Qwen TTS model | `cosyvoice-v3.5-plus` | `cosyvoice-v3.5-plus` |
<!-- AUTO-GENERATED -->
## ffmpeg（分段编辑器后端模式）

后端将分段项目音频统一转码为 mp3，需要系统安装 ffmpeg。缺失时会回退为 wav 并将 `audio_format` 写入数据库。

- macOS: `brew install ffmpeg`
- Ubuntu: `apt-get install -y ffmpeg`
