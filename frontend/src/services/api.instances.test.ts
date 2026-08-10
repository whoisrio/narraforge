import { describe, expect, it } from 'vitest';
import api from './api';
import { api as segmentedApi } from './backendSegmentedProjectStorage';
import { api as migrationApi } from './segmentedMigration';

// workers 部署下 API 在独立域名且走 Cloudflare Access cookie：
// 所有 axios 实例必须统一 baseURL（VITE_API_BASE_URL 或 /api）并带 credentials。
describe('axios instances', () => {
  it.each([
    ['services/api', api],
    ['backendSegmentedProjectStorage', segmentedApi],
    ['segmentedMigration', migrationApi],
  ])('%s uses the shared API base and sends credentials', (_name, instance) => {
    expect(instance.defaults.baseURL).toBe('/api');
    expect(instance.defaults.withCredentials).toBe(true);
  });
});
