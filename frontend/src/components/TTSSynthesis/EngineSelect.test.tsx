import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EngineSelect } from './EngineSelect';
import { ALL_ENGINE_OPTIONS } from './engineOptions';

describe('EngineSelect', () => {
  it('exposes the full local engine option list in stable order', () => {
    expect(ALL_ENGINE_OPTIONS.map((e) => e.id)).toEqual(['edge_tts', 'cosyvoice', 'mimo_tts', 'voxcpm', 'indextts']);
  });

  it('renders every engine option in local mode', () => {
    render(
      <EngineSelect
        value="edge_tts"
        availableEngines={['edge_tts', 'mimo_tts', 'cosyvoice', 'voxcpm', 'indextts']}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'Edge-TTS' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CosyVoice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'MiMo TTS' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'VoxCPM' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'IndexTTS-2.5' })).toBeInTheDocument();
  });

  it('filters local-only engines out in workers mode', () => {
    render(
      <EngineSelect
        value="edge_tts"
        availableEngines={['edge_tts', 'mimo_tts']}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'Edge-TTS' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'MiMo TTS' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'CosyVoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'VoxCPM' })).not.toBeInTheDocument();
  });

  it('emits the selected engine id', () => {
    const onChange = vi.fn();
    render(
      <EngineSelect
        value="edge_tts"
        availableEngines={['edge_tts', 'mimo_tts']}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mimo_tts' } });
    expect(onChange).toHaveBeenCalledWith('mimo_tts');
  });
});
