import { describe, expect, it } from 'vitest';
import { getVoiceRoleKind, isNarratorRole } from './voiceRoleKind';

describe('voiceRoleKind', () => {
  it('classifies explicit default narrator role as narrator', () => {
    expect(getVoiceRoleKind({ id: 'r1', name: '嘉宾A', description: 'Cast' }, 'r1')).toBe('narrator');
  });

  it('classifies English and Chinese narrator labels as narrator', () => {
    expect(isNarratorRole({ id: 'r1', name: 'Default Narrator', description: null })).toBe(true);
    expect(isNarratorRole({ id: 'r2', name: '主旁白', description: '项目解说' })).toBe(true);
  });

  it('classifies normal dialogue roles as cast', () => {
    expect(getVoiceRoleKind({ id: 'r3', name: '嘉宾A', description: 'Cast' })).toBe('cast');
  });
});
