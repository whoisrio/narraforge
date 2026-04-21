import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ParameterControls } from '../../components/TTSSynthesis/ParameterControls';
import type { TTSRequest } from '../../types';

describe('ParameterControls', () => {
  const defaultParams: Partial<TTSRequest> = {
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 0,
  };

  it('should render all parameter controls', () => {
    render(
      <ParameterControls
        params={defaultParams}
        onParamChange={() => {}}
      />
    );

    expect(screen.getByLabelText('语言')).toBeInTheDocument();
    expect(screen.getByText(/语速/)).toBeInTheDocument();
    expect(screen.getByText(/音量/)).toBeInTheDocument();
    expect(screen.getByText(/语调/)).toBeInTheDocument();
    expect(screen.getByText(/语气/)).toBeInTheDocument();
  });

  it('should call onParamChange when speed slider changes', () => {
    const onParamChange = vi.fn();

    render(
      <ParameterControls
        params={defaultParams}
        onParamChange={onParamChange}
      />
    );

    const speedSlider = screen.getByRole('slider', { name: /语速/ });
    fireEvent.change(speedSlider, { target: { value: '1.5' } });

    expect(onParamChange).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.5 })
    );
  });

  it('should call onParamChange when language select changes', () => {
    const onParamChange = vi.fn();

    render(
      <ParameterControls
        params={defaultParams}
        onParamChange={onParamChange}
      />
    );

    const languageSelect = screen.getByLabelText('语言');
    fireEvent.change(languageSelect, { target: { value: 'English' } });

    expect(onParamChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'English' })
    );
  });
});
