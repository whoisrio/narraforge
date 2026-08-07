# audio_adjust 已知问题

2026-08-06 变速功能评审修复（D1-D7 / P1-P4）后遗留的低优先级项。

## P5 — frontend 存储模式 WAV 与 SRT 的轻微漂移（~20ms/段）

合成时静音裁切保留句尾 100ms（`frontend/src/pages/TTSSynthesis.tsx` 约 1131-1133），`duration_sec` 按此计；
导出拼接时 `concatAudioBuffers` 统一裁到 80ms（`frontend/src/services/audioConcat.ts` 约 150、162），
每个句号结尾段产生约 20ms 累计误差，SRT（用存储时长）与拼接 WAV 逐渐错位。

修复方向：统一两处 keepMs（建议都以 80ms 为准，合成处裁切与导出一致）。

## P6 — studio-adjust-audio e2e 跨 run flaky

2026-08-06 观察到 `tests/e2e/specs/studio-adjust-audio.spec.ts` 在与其他 spec 连跑时随机失败
（每次失败的用例不同：时长 `toBeCloseTo` / 段数对不上 / `toBeLessThan(before*0.75)` 差 0.01），
单独重跑则 4/4 通过。e2e 库跨 run 持久（`voice_clone_e2e.db`），用例开头的"清残留"不彻底，
上一次 run 的 adjust 结果会影响下一次的 before/after 基线。
修复方向：每个用例开头先 `POST adjust-audio {tempo:1.0, volume_db:0}` 重置整个章节（目前只有部分用例做），
或 teardown 时清理本用例创建的合成音频。
