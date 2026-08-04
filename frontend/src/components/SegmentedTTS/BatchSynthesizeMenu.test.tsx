import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BatchSynthesizeMenu } from './BatchSynthesizeMenu';

describe('BatchSynthesizeMenu', () => {
  it('renders both options when the trigger is clicked', () => {
    render(<BatchSynthesizeMenu onSelect={vi.fn()} />);

    expect(screen.queryByText('仅合成未合成')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批量合成/ }));

    expect(screen.getByText('仅合成未合成')).toBeInTheDocument();
    expect(screen.getByText('重新合成全部')).toBeInTheDocument();
  });

  it('clicking each option fires the callback with the right mode and closes the menu', () => {
    const onSelect = vi.fn();
    render(<BatchSynthesizeMenu onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /批量合成/ }));
    fireEvent.click(screen.getByText('仅合成未合成'));
    expect(onSelect).toHaveBeenCalledWith('unsynthesized');
    expect(screen.queryByText('重新合成全部')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /批量合成/ }));
    fireEvent.click(screen.getByText('重新合成全部'));
    expect(onSelect).toHaveBeenCalledWith('all');
    expect(screen.queryByText('仅合成未合成')).not.toBeInTheDocument();
  });

  it('closes on outside click without firing the callback', () => {
    const onSelect = vi.fn();
    render(<BatchSynthesizeMenu onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /批量合成/ }));
    expect(screen.getByText('仅合成未合成')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('仅合成未合成')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
