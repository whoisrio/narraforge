# audio_adjust 已知问题

2026-08-06 变速功能评审修复（D1-D7 / P1-P4）后遗留的低优先级项。

## P5 — frontend 存储模式 WAV 与 SRT 的轻微漂移（~20ms/段）

合成时静音裁切保留句尾 100ms（`frontend/src/pages/TTSSynthesis.tsx` 约 1131-1133），`duration_sec` 按此计；
导出拼接时 `concatAudioBuffers` 统一裁到 80ms（`frontend/src/services/audioConcat.ts` 约 150、162），
每个句号结尾段产生约 20ms 累计误差，SRT（用存储时长）与拼接 WAV 逐渐错位。

修复方向：统一两处 keepMs（建议都以 80ms 为准，合成处裁切与导出一致）。
