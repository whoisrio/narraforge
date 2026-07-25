import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));

afterEach(() => cleanup());

import { ChapterSyncModal } from './ChapterSyncModal';

const baseProps = {
  onResplit: vi.fn(),
  onRewrite: vi.fn(),
  onClose: vi.fn(),
};

describe('ChapterSyncModal', () => {
  it('L2-only dirty shows resplit button, not rewrite', () => {
    render(<ChapterSyncModal status={{ l1_dirty: false, l2_dirty: true, l3_dirty: false }} {...baseProps} />);
    expect(screen.getByText('sync.resplit')).toBeInTheDocument();
    expect(screen.queryByText('sync.rewrite')).not.toBeInTheDocument();
    expect(screen.queryByText('sync.conflictWarning')).not.toBeInTheDocument();
  });

  it('L3-only dirty shows rewrite button, not resplit', () => {
    render(<ChapterSyncModal status={{ l1_dirty: false, l2_dirty: false, l3_dirty: true }} {...baseProps} />);
    expect(screen.getByText('sync.rewrite')).toBeInTheDocument();
    expect(screen.queryByText('sync.resplit')).not.toBeInTheDocument();
  });

  it('both dirty shows both buttons + conflict warning', () => {
    render(<ChapterSyncModal status={{ l1_dirty: false, l2_dirty: true, l3_dirty: true }} {...baseProps} />);
    expect(screen.getByText('sync.resplit')).toBeInTheDocument();
    expect(screen.getByText('sync.rewrite')).toBeInTheDocument();
    expect(screen.getByText('sync.conflictWarning')).toBeInTheDocument();
  });

  it('resplit button calls onResplit', () => {
    const onResplit = vi.fn();
    render(<ChapterSyncModal status={{ l1_dirty: false, l2_dirty: true, l3_dirty: false }} onResplit={onResplit} onRewrite={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('sync.resplit'));
    expect(onResplit).toHaveBeenCalled();
  });

  it('rewrite button calls onRewrite', () => {
    const onRewrite = vi.fn();
    render(<ChapterSyncModal status={{ l1_dirty: false, l2_dirty: false, l3_dirty: true }} onResplit={vi.fn()} onRewrite={onRewrite} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('sync.rewrite'));
    expect(onRewrite).toHaveBeenCalled();
  });
});
