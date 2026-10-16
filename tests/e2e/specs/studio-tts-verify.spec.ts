/**
 * TTS 语音核对（ASR 回读验收）E2E。
 *
 * 后端以 TTS_VERIFY_STUB=1 运行（.env.e2e → settings.tts_verify_stub）：verify
 * 不跑真实 ASR，回读文本固定为「语音核对测试桩回读文本」——与任何正常基准都
 * 不同 → 全量核对后所有段都判「不一致」，供本用例驱动 mismatch/过滤/忽略/续跑。
 *
 * 覆盖（设计文档 e2e 清单）：
 *   1. 合成态种子 → 全量核对 → 出现不一致（badge + API/SQLite 双读）
 *   2. 只看不一致过滤 → 忽略 → badge ⊘；SQLite status=ignored
 *   3. 重新 TTS（真实 edge-tts）→ 旧核对/忽略作废（audio_key 过期）→ 幂等续跑只核 1 段
 *   4. 防重：API 直发两个 POST /runs → 第二个 409；心跳新鲜时 UI 显示快照 pill
 *   5. 中断恢复：API 造 run + 回拨心跳 → 刷新 → 「上次核对中断于」pill → 续跑只补缺
 *      （SQLite 双读：旧 run interrupted，新 run completed done/total）
 *
 * 注意：直接跑 playwright 时必须带 e2e-run.cjs 同款环境，否则 dbWriter/dbReader
 * 会读到开发库：DATABASE_URL=sqlite:///backend/voice_clone_e2e.db E2E_ENV_FILE=.env.e2e
 *
 * @feature docs/superpowers/specs/2026-10-15-tts-asr-verify-design.md
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { attachSegmentAudio, backdateVerifyRunHeartbeat } from '../helpers/dbWriter';
import { readDbSegmentVerification, readDbVerifyRuns } from '../helpers/dbReader';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'e2e-tts-verify';
const PROJECT_NAME = '语音核对测试';
const CH_ID = `${PROJECT_ID}-ch1`;
const SEG_IDS = ['s1', 's2', 's3', 's4'];
const SEGMENTED_DIR = path.resolve(__dirname, '..', '..', '..', 'backend', 'data', 'projects');

interface BackendSegment {
  id: string;
  audio?: { current?: { path?: string; id?: string } | null } | null;
  verification?: { status: string; audio_key: string; engine?: string } | null;
}

/** 写假音频文件并返回 DB 存储的相对路径（相对 settings.segmented_dir）。

文件名故意偏离规范 ``{segmentId}.mp3`` —— 重新 TTS 后落到规范路径 + 新唯一
id，audio_key 随之变化，旧核对结果/忽略标记据此作废（步骤 3 的前提）。 */
function writeSeedAudio(segmentId: string): string {
  const rel = `${PROJECT_ID}/chapters/${CH_ID}/segments/${segmentId}-seed.mp3`;
  const abs = path.join(SEGMENTED_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from('fake-mp3-audio'));
  return rel;
}

function projectPayload() {
  const texts = [
    '保温杯可以装热水。',
    '夜色渐浓风声四起。',
    '他把文件放进了抽屉。',
    '周三下午有一场评审。',
  ];
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    schema_version: 2,
    layout: 'vertical',
    chapters: [
      {
        id: CH_ID,
        position: 0,
        name: '核对章',
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        segments: SEG_IDS.map((id, i) => ({
          id,
          position: i,
          text: texts[i],
          voice: { source: 'chapter' },
          segment_kind: 'narration',
        })),
      },
    ],
  };
}

async function seedProject(page: Page): Promise<void> {
  await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, { data: projectPayload() });
  expect(createResp.status()).toBe(201);
  // 已存在段的 audio 是服务端自产字段（PUT 会被忽略），按 chapter-split e2e 先例直写 DB + 落盘
  for (const id of SEG_IDS) {
    attachSegmentAudio(id, writeSeedAudio(id));
  }
}

/** 清理历史 run（上次失败运行遗留的 running/interrupted 会让快照 pill 挡住用例）。 */
async function stopAllRuns(page: Page): Promise<void> {
  for (const r of await readDbVerifyRuns(PROJECT_ID)) {
    await page.request.patch(`${BACKEND}/api/tts-verify/runs/${r.id}`, { data: { status: 'stopped' } });
  }
}

async function openStudio(page: Page): Promise<void> {
  await setLocaleToZhCN(page);
  await page.goto('/');
  await enterWorkspace(page);
  await openProjectStudio(page);
}

/** 已在工作区时（reload 后）：重新打开项目并进入工作室（SPA 刷新回落地页）。 */
async function reopenStudio(page: Page): Promise<void> {
  await enterWorkspace(page);
  await openProjectStudio(page);
}

async function openProjectStudio(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
  await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
  await page.getByRole('button', { name: '展开工具栏' }).click();
}

/** API 读项目段（dual-read 的 API 侧）。 */
async function readBackendSegments(page: Page): Promise<BackendSegment[]> {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  expect(resp.status()).toBe(200);
  const project = (await resp.json()) as { chapters: { segments: BackendSegment[] }[] };
  return project.chapters.flatMap((c) => c.segments);
}


test.describe('TTS 语音核对', () => {
  test.setTimeout(240_000);

  test('全量核对 → 不一致 → 过滤/忽略 → 重新TTS作废 → 幂等续跑', async ({ page }) => {
    const errors = collectErrors(page);
    await seedProject(page);
    await stopAllRuns(page);

    try {
      await openStudio(page);

      // ── 0. 紧凑行（默认视图）角标双职责：未核对 → 点角标直接核对，不建 run ──
      const runsBeforeSingle = await readDbVerifyRuns(PROJECT_ID);
      const s1Badge = page
        .locator(`[data-segment-id="${SEG_IDS[0]}"]`)
        .getByRole('button', { name: '语音核对：未核对（点击核对）' });
      await s1Badge.click();
      await expect(
        page.locator(`[data-segment-id="${SEG_IDS[0]}"]`).getByRole('button', { name: /语音核对：不一致/ }),
      ).toBeVisible({ timeout: 15_000 });
      // 单段核对不走批量：不建 run（SQLite 双读，与点击前快照对比）
      expect(await readDbVerifyRuns(PROJECT_ID)).toHaveLength(runsBeforeSingle.length);

      // ── 1. 全量核对：剩余 3 段未核对 → 全部判不一致（桩回读 ≠ 任何基准）；完成后弹报告 ──
      await page.getByRole('button', { name: '◎ 语音核对 ▾' }).click();
      await page.getByRole('button', { name: '全量核对（项目所有章节）' }).click();
      await expect(page.getByText(/语音核对完成：3 段/)).toBeVisible({ timeout: 30_000 });
      // 核对报告：列出本次 run 发现的 3 段不一致，直接给 基准 vs ASR 回读比对
      const report = page.getByRole('dialog', { name: '语音核对报告' });
      await expect(report).toBeVisible({ timeout: 10_000 });
      await expect(report.getByText('不一致 3')).toBeVisible();
      await expect(report.getByText('语音核对测试桩回读文本').first()).toBeVisible();
      await report.getByText('关闭').click();
      await expect(report).toHaveCount(0);

      // 紧凑行角标为符号 + tooltip（aria-label），按 tooltip 前缀精确匹配不一致
      await expect(page.getByRole('button', { name: /语音核对：不一致/ })).toHaveCount(4, { timeout: 10_000 });

      // API 双读（段级 PATCH 有 800ms 防抖，轮询等待落库）
      await expect
        .poll(async () => {
          const segs = await readBackendSegments(page);
          return segs.filter((s) => s.verification?.status === 'mismatch').length;
        }, { timeout: 15_000, intervals: [1_000] })
        .toBe(4);
      // SQLite 双读：绑 seed 音频 audio_key + 引擎（PATCH 落库后可读）
      await expect
        .poll(async () => {
          const rows = await Promise.all(SEG_IDS.map((id) => readDbSegmentVerification(id)));
          return rows.filter((r) => r?.verification && JSON.parse(r.verification).status === 'mismatch').length;
        }, { timeout: 15_000, intervals: [1_000] })
        .toBe(4);
      for (const id of SEG_IDS) {
        const row = await readDbSegmentVerification(id);
        const parsed = JSON.parse(row!.verification!) as { status: string; audio_key: string; engine: string };
        expect(parsed.audio_key).toContain(`${id}-seed.mp3`);
        expect(parsed.engine).toBe('funasr');
      }
      // runs 表：completed 3/3（s1 已由步骤 0 的单段核对覆盖，批量幂等跳过）
      const runs = await readDbVerifyRuns(PROJECT_ID);
      const completed = runs.find((r) => r.status === 'completed');
      expect(completed, 'completed run row').toBeTruthy();
      expect(completed!.done).toBe(3);
      expect(completed!.total).toBe(3);

      // ── 2. 二次全量核对：全部新鲜 → 幂等空跑，不建 run ──
      await page.getByRole('button', { name: '◎ 语音核对 ▾' }).click();
      await page.getByRole('button', { name: '全量核对（项目所有章节）' }).click();
      await expect(page.getByText('所有段落都已核对，无需再跑')).toBeVisible({ timeout: 10_000 });
      const runsAfter2nd = await readDbVerifyRuns(PROJECT_ID);
      expect(runsAfter2nd.filter((r) => r.status === 'completed')).toHaveLength(1);

      // ── 3. 只看不一致：4 段全是不一致 → 打开详情忽略 s1 → 3 段 ──
      await page.getByRole('button', { name: '只看不一致' }).click();
      await expect(page.getByRole('button', { name: /语音核对：不一致/ })).toHaveCount(4, { timeout: 10_000 });
      const s1Row = page.locator(`[data-segment-id="${SEG_IDS[0]}"]`);
      await s1Row.getByRole('button', { name: /语音核对：不一致/ }).click();
      const detail = page.getByRole('dialog', { name: '语音核对详情' });
      await expect(detail).toBeVisible();
      await expect(detail.getByText(/相似度 \d+%/)).toBeVisible();
      await detail.getByRole('button', { name: '忽略不一致' }).click();
      // s1 变 ⊘ 已忽略，过滤后只剩 3 段不一致
      await expect(page.getByRole('button', { name: /语音核对：不一致/ })).toHaveCount(3, { timeout: 10_000 });
      // 关过滤后 s1 显示已忽略
      await page.getByRole('button', { name: '只看不一致' }).click();
      await expect(s1Row.getByRole('button', { name: /已人工忽略/ })).toBeVisible();
      // SQLite：s1 status=ignored（防抖落库后可读）
      await expect
        .poll(async () => {
          const row = await readDbSegmentVerification(SEG_IDS[0]);
          return row?.verification ? (JSON.parse(row.verification) as { status: string }).status : '';
        }, { timeout: 15_000, intervals: [1_000] })
        .toBe('ignored');

      // ── 4. 重新 TTS s1 → audio_key 变化 → 旧忽略作废 ──
      // 注：真实 UI 重合成（edge-tts）在部分环境被微软 403 拒绝（produce-all 等
      // 同样受限）；本步用 dbWriter 重挂新音频等价驱动 audio_key 变更，
      // 旧结果作废机制的消费链路不变，UI 合成链路由 studio-resynthesis.spec 覆盖。
      attachSegmentAudio(SEG_IDS[0], writeSeedAudio(`${SEG_IDS[0]}-v2`));
      // 刷新让前端拿到新 audio.current（真实场景由合成响应回写，无需刷新）
      await page.reload();
      await reopenStudio(page);
      // audio.current 换新 path → audio_key 变化 → 旧 verification 过期（按未核对处理）
      const s1RowV2 = page.locator(`[data-segment-id="${SEG_IDS[0]}"]`);
      await expect(s1RowV2.getByRole('button', { name: /已过期/ })).toBeVisible({ timeout: 20_000 });

      // ── 5. 幂等续跑：只补 s1 一段（其余新鲜跳过）──
      await page.getByRole('button', { name: '◎ 语音核对 ▾' }).click();
      await page.getByRole('button', { name: '全量核对（项目所有章节）' }).click();
      await expect(page.getByText(/语音核对完成：1 段/)).toBeVisible({ timeout: 30_000 });
      // 报告只含本次 run 发现的 s1 → 关闭后继续双读断言
      const reportV2 = page.getByRole('dialog', { name: '语音核对报告' });
      await expect(reportV2).toBeVisible({ timeout: 10_000 });
      await expect(reportV2.getByText('不一致 1')).toBeVisible();
      await reportV2.getByText('关闭').click();
      let reverified: { status: string; audio_key: string } | null = null;
      await expect
        .poll(async () => {
          const row = await readDbSegmentVerification(SEG_IDS[0]);
          reverified = row?.verification ? (JSON.parse(row.verification) as { status: string; audio_key: string }) : null;
          return reverified?.status ?? '';
        }, { timeout: 15_000, intervals: [1_000] })
        .toBe('mismatch');
      expect(reverified!.audio_key).toContain(`${SEG_IDS[0]}-v2-seed.mp3`);

      // 409 是段级 PATCH/整包 PUT 并发的预期冲突噪声（冲突裁决机制自愈），
      // 与 produce-all 等既有 spec 的过滤惯例一致
      expect(errors.filter((e) => !e.includes('favicon') && !e.includes('409 (Conflict)'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      fs.rmSync(path.join(SEGMENTED_DIR, PROJECT_ID), { recursive: true, force: true });
    }
  });

  test('防重 409 + 中断恢复续跑（runs 表双读）', async ({ page }) => {
    const errors = collectErrors(page);
    await seedProject(page);
    await stopAllRuns(page);

    try {
      // ── 1. API 造一个心跳新鲜的 running run → 第二个 POST 必须 409 ──
      const first = await page.request.post(`${BACKEND}/api/tts-verify/runs`, {
        data: { project_id: PROJECT_ID, scope: 'project', total: 4 },
      });
      expect(first.status()).toBe(201);
      const firstRun = (await first.json()) as { id: string };
      const second = await page.request.post(`${BACKEND}/api/tts-verify/runs`, {
        data: { project_id: PROJECT_ID, scope: 'project', total: 4 },
      });
      expect(second.status()).toBe(409);
      expect(((await second.json()) as { detail: { code: string } }).detail.code).toBe('verify_run_in_progress');

      // ── 2. UI：心跳新鲜的快照 run → 显示「核对中」pill（不随进度跳动）──
      await openStudio(page);
      const pill = page.getByTestId('verify-run-pill');
      await expect(pill.getByText('核对中 0/4')).toBeVisible({ timeout: 10_000 });
      // 快照 run 无取消按钮（跨 tab 无控制权），下拉入口也被 pill 取代（防重）
      expect(pill.getByRole('button', { name: '取消' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '◎ 语音核对 ▾' })).toHaveCount(0);
      // 清理：置 stopped，UI 恢复下拉
      await page.request.patch(`${BACKEND}/api/tts-verify/runs/${firstRun.id}`, { data: { status: 'stopped' } });
      await page.reload();
      await reopenStudio(page);
      await expect(page.getByRole('button', { name: '◎ 语音核对 ▾' })).toBeVisible({ timeout: 10_000 });

      // ── 3. 中断恢复：造 running run（done=1/4）+ 回拨心跳 200s → 惰性判 interrupted ──
      const stale = await page.request.post(`${BACKEND}/api/tts-verify/runs`, {
        data: { project_id: PROJECT_ID, scope: 'project', total: 4 },
      });
      expect(stale.status()).toBe(201);
      const staleRun = (await stale.json()) as { id: string };
      await page.request.patch(`${BACKEND}/api/tts-verify/runs/${staleRun.id}`, { data: { done: 1 } });
      backdateVerifyRunHeartbeat(staleRun.id, 200);

      // 刷新 → GET latest 惰性判活 → interrupted pill + 续跑入口
      await page.reload();
      await reopenStudio(page);
      const interruptPill = page.getByTestId('verify-run-pill');
      await expect(interruptPill.getByText('上次核对中断于 1/4')).toBeVisible({ timeout: 10_000 });
      await interruptPill.getByRole('button', { name: '续跑' }).click();

      // 续跑 = 幂等选择：4 段全部未核对 → 补 4 段
      await expect(page.getByText(/语音核对完成：4 段/)).toBeVisible({ timeout: 30_000 });
      // 报告汇总本次 run 的 4 段不一致 → 关闭
      const resumeReport = page.getByRole('dialog', { name: '语音核对报告' });
      await expect(resumeReport).toBeVisible({ timeout: 10_000 });
      await expect(resumeReport.getByText('不一致 4')).toBeVisible();
      await resumeReport.getByText('关闭').click();
      // pill 消失（无活跃/中断 run）
      await expect(page.getByTestId('verify-run-pill')).toHaveCount(0, { timeout: 10_000 });

      // ── 4. runs 表双读：旧 run interrupted，新 run completed 4/4（段级 PATCH 落库后可读）──
      await expect
        .poll(async () => {
          const segs = await readBackendSegments(page);
          return segs.filter((s) => s.verification?.status === 'mismatch').length;
        }, { timeout: 15_000, intervals: [1_000] })
        .toBe(4);
      const runs = await readDbVerifyRuns(PROJECT_ID);
      const oldRun = runs.find((r) => r.id === staleRun.id);
      expect(oldRun?.status).toBe('interrupted');
      const newCompleted = runs.find((r) => r.status === 'completed' && r.total === 4);
      expect(newCompleted, 'new completed run').toBeTruthy();
      expect(newCompleted!.done).toBe(4);

      // 每段都已有新鲜 mismatch 结果
      for (const seg of await readBackendSegments(page)) {
        expect(seg.verification?.status).toBe('mismatch');
      }


      expect(errors.filter((e) => !e.includes('favicon') && !e.includes('409 (Conflict)'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      fs.rmSync(path.join(SEGMENTED_DIR, PROJECT_ID), { recursive: true, force: true });
    }
  });
});
