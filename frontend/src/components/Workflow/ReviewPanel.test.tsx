import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';

const interrupt = {
  script: 'original script',
  review: {
    dimensions: [{ name: '内容忠实度', status: 'pass' as const, comment: 'ok', suggestion: null }],
    overall_score: 4,
    overall_comment: 'good',
    has_critical_issue: false,
  },
  available_actions: ['approve', 'reject'],
};

describe('ReviewPanel', () => {
  it('renders review score and dimensions', () => {
    render(<ReviewPanel interrupt={interrupt} onRespond={vi.fn()} />);
    expect(screen.getByText('4/5')).toBeInTheDocument();
    expect(screen.getByText('内容忠实度')).toBeInTheDocument();
  });

  it('calls respond with approve on click', () => {
    const respond = vi.fn();
    render(<ReviewPanel interrupt={interrupt} onRespond={respond} />);
    fireEvent.click(screen.getByText('批准'));
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approve' }),
    );
  });
});