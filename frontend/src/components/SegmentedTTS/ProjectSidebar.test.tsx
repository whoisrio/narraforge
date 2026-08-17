import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));

afterEach(() => cleanup());

import { ProjectSidebar } from './ProjectSidebar';

const baseProps = {
  projects: [
    {
      schema_version: 2,
      id: 'p1',
      name: '项目一',
      chapters: [],
      active_chapter_id: undefined,
      layout: 'vertical' as const,
      remotion_project_path: null,
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
    },
  ],
  activeProjectId: 'p1',
  collapsed: false,
  scratchpadId: '__scratchpad__',
  onToggleCollapse: vi.fn(),
  onSelectProject: vi.fn(),
  onCreateProject: vi.fn(),
  onDeleteProject: vi.fn(),
};

describe('ProjectSidebar quota gate', () => {
  it('renders create button enabled by default', () => {
    render(<ProjectSidebar {...baseProps} />);
    const btn = screen.getByLabelText('segment.projectSidebar.newProject');
    expect(btn).toBeEnabled();
  });

  it('disables create button with hint when quota reached', () => {
    render(
      <ProjectSidebar
        {...baseProps}
        createDisabled
        createDisabledHint="每位用户限一个后端项目"
      />,
    );
    const btn = screen.getByLabelText('每位用户限一个后端项目');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', '每位用户限一个后端项目');
  });
});
