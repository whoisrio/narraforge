import { vi } from 'vitest';
import type { VoiceProfile, TimelineProject, TimelineSegment } from '.';

// Factory functions for creating test data

export function createMockVoiceProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: 'voice-1',
    name: 'Test Voice',
    audio_url: '/audio/test.mp3',
    qwen_voice_id: 'qwen-voice-1',
    role: 'custom',
    is_cloned: true,
    cloned_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function createMockTimelineSegment(overrides: Partial<TimelineSegment> = {}): TimelineSegment {
  return {
    id: 'segment-1',
    text: 'Test segment text',
    start_time: 0,
    end_time: 5,
    audio_url: undefined,
    voice_id: undefined,
    voice: undefined,
    ...overrides,
  };
}

export function createMockTimelineProject(overrides: Partial<TimelineProject> = {}): TimelineProject {
  return {
    id: 'project-1',
    name: 'Test Project',
    video_url: undefined,
    segments: [],
    ...overrides,
  };
}

// Mock API responses
export const mockApiResponses = {
  listProjects: [
    createMockTimelineProject({ id: 'project-1', name: 'Project 1' }),
    createMockTimelineProject({ id: 'project-2', name: 'Project 2' }),
  ],

  listCloned: [
    createMockVoiceProfile({ id: 'voice-1', name: 'Voice 1' }),
    createMockVoiceProfile({ id: 'voice-2', name: 'Voice 2' }),
  ],

  getProject: (projectId: string) =>
    createMockTimelineProject({
      id: projectId,
      name: `Project ${projectId}`,
      segments: [
        createMockTimelineSegment({ id: 'seg-1', text: 'Segment 1' }),
        createMockTimelineSegment({ id: 'seg-2', text: 'Segment 2' }),
      ],
    }),

  assignVoiceSuccess: (segmentId: string, voiceId: string) =>
    createMockTimelineSegment({
      id: segmentId,
      voice_id: voiceId,
      voice: createMockVoiceProfile({ id: voiceId }),
    }),

  removeVoiceSuccess: (segmentId: string) =>
    createMockTimelineSegment({
      id: segmentId,
      voice_id: undefined,
      voice: undefined,
    }),
};

// Mock fetch implementation
export function setupMockFetch(responseMap: Map<string, any>) {
  return vi.fn().mockImplementation((url: string) => {
    const response = responseMap.get(url);
    if (response !== undefined) {
      return Promise.resolve({
        json: () => Promise.resolve(response),
        ok: true,
        status: 200,
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

// Helper to wait for async operations in tests
export function waitFor(ms: number = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to suppress console errors during tests
export function suppressConsoleErrors() {
  const originalError = console.error;
  beforeAll(() => {
    console.error = vi.fn();
  });
  afterAll(() => {
    console.error = originalError;
  });
}