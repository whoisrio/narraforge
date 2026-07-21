import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StageCard } from './StageCard';

describe('StageCard', () => {
  it('starts collapsed (L1) and expands to L2 on click', () => {
    const onFullscreen = vi.fn();
    render(
      <StageCard
        nodeId="gen_script"
        title="生成脚本"
        status="completed"
        summary="3 章 · 1200 字"
        onFullscreen={onFullscreen}
      >
        <div data-testid="detail">detail content</div>
      </StageCard>,
    );
    expect(screen.queryByTestId('detail')).toBeNull();
    fireEvent.click(screen.getByText('生成脚本'));
    expect(screen.getByTestId('detail')).toBeInTheDocument();
  });

  it('starts open when running', () => {
    render(
      <StageCard nodeId="gen_script" title="生成脚本" status="running" summary="...">
        <div data-testid="detail">detail</div>
      </StageCard>,
    );
    expect(screen.getByTestId('detail')).toBeInTheDocument();
  });
});