import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));

afterEach(() => cleanup());

import { ChapterSyncBadges } from './ChapterSyncBadges';

describe('ChapterSyncBadges', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<ChapterSyncBadges status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when all layers clean', () => {
    const { container } = render(
      <ChapterSyncBadges status={{ l1_dirty: false, l2_dirty: false, l3_dirty: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the dirty layer badges', () => {
    render(<ChapterSyncBadges status={{ l1_dirty: true, l2_dirty: false, l3_dirty: true }} />);
    expect(screen.getByText('sync.l1')).toBeInTheDocument();
    expect(screen.queryByText('sync.l2')).not.toBeInTheDocument();
    expect(screen.getByText('sync.l3')).toBeInTheDocument();
  });

  it('renders all three when all dirty', () => {
    render(<ChapterSyncBadges status={{ l1_dirty: true, l2_dirty: true, l3_dirty: true }} />);
    expect(screen.getByText('sync.l1')).toBeInTheDocument();
    expect(screen.getByText('sync.l2')).toBeInTheDocument();
    expect(screen.getByText('sync.l3')).toBeInTheDocument();
  });
});
