import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ModelConfig } from '../ModelConfig';

const getAllMock = vi.fn();

vi.mock('../../services/api', () => ({
  modelConfigApi: {
    getAll: (...args: unknown[]) => getAllMock(...args),
    update: vi.fn(),
    getPublicKey: vi.fn(),
  },
}));
vi.mock('../../components/Settings/AnimationRootSetting', () => ({
  AnimationRootSetting: () => null,
}));
vi.mock('../../components/Settings/NarrationGitSetting', () => ({
  NarrationGitSetting: () => null,
}));

// 关键：这两个 mock 每次渲染都返回全新引用的 t/toast，模拟上下文值不稳定的
// 病态场景（#53 ToastProvider 未 memo 时正是这样导致加载 effect 以 ~200/s
// 狂刷 GET /api/model-config）。组件必须对这种抖动免疫。
vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));
vi.mock('../../components/ui/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

const CONFIGS = {
  qwen_tts: { label: 'Qwen-TTS', icon: 'Q', fields: {} },
  mimo_tts: { label: 'MiMo-TTS', icon: 'M', fields: {} },
  llm: { label: 'LLM', icon: 'L', fields: {} },
};

beforeEach(() => {
  getAllMock.mockReset();
  getAllMock.mockResolvedValue(CONFIGS);
});

describe('ModelConfig load-once guard', () => {
  it('fetches configs exactly once per mount even when context identities flap every render', async () => {
    const { rerender } = render(<ModelConfig />);
    await waitFor(() => expect(screen.getByText('Qwen-TTS')).toBeInTheDocument());

    for (let i = 0; i < 5; i++) rerender(<ModelConfig />);
    await new Promise((r) => setTimeout(r, 50));

    expect(getAllMock).toHaveBeenCalledTimes(1);
  });
});
