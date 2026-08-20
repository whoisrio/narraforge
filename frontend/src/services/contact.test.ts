import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAdminContactEmail } from './contact';

describe('getAdminContactEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined when VITE_ADMIN_EMAIL is unset', () => {
    vi.stubEnv('VITE_ADMIN_EMAIL', '');
    expect(getAdminContactEmail()).toBeUndefined();
  });

  it('returns the trimmed email when configured', () => {
    vi.stubEnv('VITE_ADMIN_EMAIL', '  admin@example.com  ');
    expect(getAdminContactEmail()).toBe('admin@example.com');
  });

  it('returns undefined for whitespace-only value', () => {
    vi.stubEnv('VITE_ADMIN_EMAIL', '   ');
    expect(getAdminContactEmail()).toBeUndefined();
  });
});
