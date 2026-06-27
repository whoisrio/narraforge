import { describe, expect, it } from 'vitest';
import { getVoiceRoleKind, isNarratorRole } from './voiceRoleKind';

describe('voiceRoleKind', () => {
  it('classifies explicit default narrator role as narrator', () => {
    expect(getVoiceRoleKind({ id: 'r1', name: '嘉宾A', description: 'Cast' }, 'r1')).toBe('narrator');
  });

  it('classifies roles with explicit role_kind as narrator', () => {
    expect(isNarratorRole({ id: 'r1', name: 'Default Narrator', description: null, role_kind: 'narrator' })).toBe(true);
    expect(isNarratorRole({ id: 'r2', name: '主旁白', description: '项目解说', role_kind: 'narrator' })).toBe(true);
  });

  it('classifies roles without explicit role_kind as cast by default', () => {
    expect(isNarratorRole({ id: 'r1', name: 'Default Narrator', description: null })).toBe(false);
    expect(isNarratorRole({ id: 'r2', name: '主旁白', description: '项目解说' })).toBe(false);
  });

  it('classifies normal dialogue roles as cast', () => {
    expect(getVoiceRoleKind({ id: 'r3', name: '嘉宾A', description: 'Cast' })).toBe('cast');
  });
});
