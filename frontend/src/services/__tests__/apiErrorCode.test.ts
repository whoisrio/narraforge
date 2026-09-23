import { describe, expect, it } from 'vitest';
import { apiErrorCode, apiStaleServerUpdatedAt } from '../api';

/** 每用户设计音色配额 409 的错误码提取（frontend 兑现后端 designed_voice_limit_reached）。 */
describe('apiErrorCode', () => {
  it('提取 axios 409 的 detail.code', () => {
    const err = {
      response: {
        status: 409,
        data: {
          detail: {
            code: 'designed_voice_limit_reached',
            message: '每位用户限保存一个设计音色，可删除已有设计音色后再新建',
          },
        },
      },
    };
    expect(apiErrorCode(err)).toBe('designed_voice_limit_reached');
  });

  it('detail 为纯字符串（旧式错误）时返回 undefined', () => {
    expect(apiErrorCode({ response: { data: { detail: 'Voice not found' } } })).toBeUndefined();
  });

  it('非 axios 错误 / 网络错误（无 response）返回 undefined', () => {
    expect(apiErrorCode(new Error('Network Error'))).toBeUndefined();
    expect(apiErrorCode(undefined)).toBeUndefined();
  });
});

/** 409 stale_payload 的服务端当前版本提取（冲突自愈/裁决都用它判真假冲突）。 */
describe('apiStaleServerUpdatedAt', () => {
  it('提取 409 stale_payload 的 detail.server_updated_at', () => {
    const err = {
      response: {
        status: 409,
        data: { detail: { code: 'stale_payload', server_updated_at: '2026-09-23T01:00:00' } },
      },
    };
    expect(apiStaleServerUpdatedAt(err)).toBe('2026-09-23T01:00:00');
  });

  it('非 stale_payload 错误 / 缺字段 / 非字符串均返回 undefined', () => {
    expect(apiStaleServerUpdatedAt({
      response: { status: 409, data: { detail: { code: 'other' } } },
    })).toBeUndefined();
    expect(apiStaleServerUpdatedAt({
      response: { status: 500, data: { detail: { code: 'stale_payload' } } },
    })).toBeUndefined();
    expect(apiStaleServerUpdatedAt({
      response: { status: 409, data: { detail: { code: 'stale_payload', server_updated_at: 123 } } },
    })).toBeUndefined();
    expect(apiStaleServerUpdatedAt(new Error('Network Error'))).toBeUndefined();
  });
});
