import { describe, expect, it } from 'vitest';
import { apiErrorCode } from '../api';

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
