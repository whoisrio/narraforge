import { describe, it, expect } from 'vitest';
import { applyTryHandoffToProject } from './applyTryHandoff';
import { createInitialProject } from '../hooks/useSegmentedProject';

function makeProject() {
  return createInitialProject();
}

describe('applyTryHandoffToProject', () => {
  it('sets handoff text on the active chapter original_text', () => {
    const project = makeProject();
    const result = applyTryHandoffToProject(project, 'hello from try page');
    expect(result.chapters[0].original_text).toBe('hello from try page');
  });

  it('returns project unchanged when text is empty', () => {
    const project = makeProject();
    expect(applyTryHandoffToProject(project, '  ')).toBe(project);
  });

  it('does not overwrite existing original_text', () => {
    const project = makeProject();
    project.chapters[0].original_text = 'existing content';
    expect(applyTryHandoffToProject(project, 'new text')).toBe(project);
  });

  it('does not apply when chapter already has segments', () => {
    const project = makeProject();
    project.chapters[0].segments = [{ id: 's1' } as never];
    expect(applyTryHandoffToProject(project, 'new text')).toBe(project);
  });
});
