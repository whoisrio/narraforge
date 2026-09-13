# audio_adjust 已知问题

2026-08-06 变速功能评审修复（D1-D7 / P1-P4）后遗留的低优先级项。

## P5 — frontend 存储模式 WAV 与 SRT 的轻微漂移（~20ms/段）

合成时静音裁切保留句尾 100ms（`frontend/src/pages/TTSSynthesis.tsx` 约 1131-1133），`duration_sec` 按此计；
导出拼接时 `concatAudioBuffers` 统一裁到 80ms（`frontend/src/services/audioConcat.ts` 约 150、162），
每个句号结尾段产生约 20ms 累计误差，SRT（用存储时长）与拼接 WAV 逐渐错位。

修复方向：统一两处 keepMs（建议都以 80ms 为准，合成处裁切与导出一致）。

## P6 — studio-adjust-audio e2e 跨 run flaky（2026-08-17 已修复）

2026-08-06 观察到 `tests/e2e/specs/studio-adjust-audio.spec.ts` 在与其他 spec 连跑时随机失败
（每次失败的用例不同：时长 `toBeCloseTo` / 段数对不上 / `toBeLessThan(before*0.75)` 差 0.01），
单独重跑则 4/4 通过。e2e 库跨 run 持久（`voice_clone_e2e.db`），用例开头的"清残留"不彻底，
上一次 run 的 adjust 结果会影响下一次的 before/after 基线。
修复方向：每个用例开头先 `POST adjust-audio {tempo:1.0, volume_db:0}` 重置整个章节（目前只有部分用例做），
或 teardown 时清理本用例创建的合成音频。

2026-08-17 定位出三个确定性/半确定性根因并修复：

1. PR #79 给调整音频弹窗新增「应用到所有章节」按钮，`getByRole('button', { name: '应用' })` 命中两个按钮
   触发 strict mode violation（用例 1/2 必挂）。
   修复：选择器加 `exact: true`。
2. 录音用例（D1/D2）中，录音落库后前端会把本地草稿在防抖安静期后整包 PUT 回后端；
   该 PUT 若落在用例后续的 API 调整/force 重合成之后，旧草稿会回写覆盖服务端状态
   （force 重合成结果被草稿里的 recorded 音频盖回，`origin` 断言失败，并级联导致下一个用例 `adjusted` 计数不符）。
   修复：录音确认后先 `waitForResponse` 等这次草稿 PUT 落库，再 `goto('about:blank')` 卸载工作室页面，
   之后才继续纯 API 步骤。
3. 跨 run 残留：上次 run 若中断在录音用例还原之前，`seg-1-1` 仍是 `recorded`，
   无 force 的合成会被后端跳过（录音锁），导致 `adjusted` 计数/时长基线不符。
   修复：用例 1/3/4 开头检测 `origin === 'recorded'` 残留，先 force 重合成还原为普通 TTS 段。
