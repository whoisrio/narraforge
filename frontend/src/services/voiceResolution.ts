/**
 * voiceResolution — 音色配置解析 & stale 检测
 *
 * 核心函数：
 * - mergeDeep(base, overrides): 浅层 + 嵌套对象递归合并
 * - resolveEffectiveVoice(segVoice, role, chapterDefaults): 三层继承合并
 * - isAudioStale(current, generated): 判断合成后的音频是否已过期
 */

import type { EngineParams, Role, VoiceSource } from '../types';

/** 递归合并两个对象，overrides 中的值覆盖 base */
export function mergeDeep(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key];
    if (
      overrideVal !== null &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeDeep(
        result[key] as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

/**
 * 三层继承合并：chapter → role → segment
 *
 * @param segVoice  segment 上的 VoiceSource 配置
 * @param role      当前 segment 关联的角色（可能 undefined）
 * @param chapterDefaults 章节级别的默认引擎参数
 * @returns 最终生效的引擎参数
 */
export function resolveEffectiveVoice(
  segVoice: VoiceSource,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): EngineParams {
  // Layer 1: chapter defaults
  let result: Record<string, unknown> = { ...chapterDefaults } as Record<string, unknown>;

  switch (segVoice.source) {
    case 'chapter':
      return result as unknown as EngineParams;

    case 'role': {
      if (!role) return result as unknown as EngineParams;
      // role.voice 的 engine 可能和 chapter 不同，直接替换而非合并
      const roleVoice = role.voice as unknown as Record<string, unknown>;
      if (roleVoice.engine !== chapterDefaults.engine) {
        result = { ...roleVoice };
      } else {
        result = mergeDeep(result, roleVoice);
      }
      return result as unknown as EngineParams;
    }

    case 'custom': {
      // Layer 2: role (always use if available — custom params layer on top of role)
      if (role) {
        const roleVoice = role.voice as unknown as Record<string, unknown>;
        if (roleVoice.engine !== (result as Record<string, unknown>).engine) {
          result = { ...roleVoice };
        } else {
          result = mergeDeep(result, roleVoice);
        }
      }

      // Layer 3: custom segment params
      // Partial<> 断言仅为规避 TS2783（params 必含 engine），运行时行为不变
      const customLayer: Record<string, unknown> = {
        engine: segVoice.engine,
        ...(segVoice.params as Partial<EngineParams>),
      };

      // 如果 custom engine 和当前 base engine 不同，替换
      if (segVoice.engine !== (result as Record<string, unknown>).engine) {
        result = { ...customLayer };
      } else {
        result = mergeDeep(result, customLayer);
      }

      return result as unknown as EngineParams;
    }

    default:
      return result as unknown as EngineParams;
  }
}

/**
 * 判断当前期望参数与生成时的参数是否一致（音频是否 stale）
 *
 * @param current   resolveEffectiveVoice() 返回的当前期望参数
 * @param generated segment.generated_params（生成时的快照）
 * @returns true 表示参数已变更，音频需要重新合成
 */
export function isAudioStale(
  current: EngineParams,
  generated: Partial<EngineParams> | undefined,
): boolean {
  if (!generated) return false;

  // 只比较 current 中存在的 key（generated 可能包含额外的 transient 字段）
  for (const key of Object.keys(current) as (keyof EngineParams)[]) {
    const cv = current[key];
    const gv = generated[key];

    if (cv === undefined && gv === undefined) continue;

    // 对象类型递归比较
    if (
      cv !== null && typeof cv === 'object' && !Array.isArray(cv) &&
      gv !== null && typeof gv === 'object' && !Array.isArray(gv)
    ) {
      if (
        JSON.stringify(cv) !== JSON.stringify(gv)
      ) return true;
    } else if (cv !== gv) {
      return true;
    }
  }

  return false;
}
