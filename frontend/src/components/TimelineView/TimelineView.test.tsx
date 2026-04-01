import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimelineView } from './TimelineView';
import type { TimelineProject, VoiceProfile } from '../../types';

// Mock the API module
vi.mock('../../services/api', () => ({
  timelineApi: {
    assignVoiceToSegment: vi.fn(),
    removeVoiceFromSegment: vi.fn(),
    getProject: vi.fn(),
  },
}));

import { timelineApi } from '../../services/api';

describe('TimelineView', () => {
  const mockVoices: VoiceProfile[] = [
    {
      id: 'voice-1',
      name: 'My Voice',
      audio_url: '/audio/voice1.mp3',
      is_cloned: true,
      qwen_voice_id: 'qwen-1',
      role: 'custom',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'voice-2',
      name: 'Narrator',
      audio_url: '/audio/voice2.mp3',
      is_cloned: true,
      qwen_voice_id: 'qwen-2',
      role: 'male',
      created_at: '2026-01-01T00:00:00Z',
    },
  ];

  const mockProject: TimelineProject = {
    id: 'project-1',
    name: 'Test Project',
    video_url: '/video/test.mp4',
    segments: [
      {
        id: 'segment-1',
        text: 'Welcome to our channel',
        start_time: 0,
        end_time: 3,
        audio_url: undefined,
        voice_id: undefined,
      },
      {
        id: 'segment-2',
        text: 'Today we will learn about',
        start_time: 4,
        end_time: 7,
        audio_url: undefined,
        voice_id: 'voice-1',
        voice: mockVoices[0],
      },
    ],
  };

  const mockOnProjectUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the video stage and timeline section', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Welcome to our channel')).toBeInTheDocument();
    expect(screen.getByText('Today we will learn about')).toBeInTheDocument();
  });

  it('renders voice assignment badge when segment has voice', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    // Second segment has a voice assigned
    expect(screen.getByText('🎤 My Voice')).toBeInTheDocument();
  });

  it('shows "+ Assign Voice" for segments without voice', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    // First segment has no voice
    expect(screen.getByText('+ Assign Voice')).toBeInTheDocument();
  });

  it('opens voice picker when clicking on segment without voice', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    const segment = screen.getByText('Welcome to our channel').closest('.segmentCard');
    if (segment) {
      fireEvent.click(segment);
    }

    expect(screen.getByText('Select a voice:')).toBeInTheDocument();
    expect(screen.getByText('Voice 1')).toBeInTheDocument();
    expect(screen.getByText('Voice 2')).toBeInTheDocument();
  });

  it('calls onProjectUpdate when voice is assigned', async () => {
    const updatedProject = {
      ...mockProject,
      segments: [
        {
          ...mockProject.segments[0],
          voice_id: 'voice-1',
          voice: mockVoices[0],
        },
        mockProject.segments[1],
      ],
    };

    vi.mocked(timelineApi.assignVoiceToSegment).mockResolvedValueOnce(updatedProject.segments[0]);
    vi.mocked(timelineApi.getProject).mockResolvedValueOnce(updatedProject);

    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    // Open voice picker
    const segment = screen.getByText('Welcome to our channel').closest('.segmentCard');
    if (segment) {
      fireEvent.click(segment);
    }

    // Select a voice
    const voiceOption = screen.getByText('Voice 1').closest('button');
    if (voiceOption) {
      fireEvent.click(voiceOption);
    }

    await waitFor(() => {
      expect(mockOnProjectUpdate).toHaveBeenCalledWith(updatedProject);
    });
  });

  it('renders voice panel with tabs', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    expect(screen.getByText('🎤 Voices')).toBeInTheDocument();
    expect(screen.getByText('Clone')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
  });

  it('switches between clone and library tabs', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    // Default to Clone tab
    expect(screen.getByText('Create New Voice')).toBeInTheDocument();

    // Click Library tab
    fireEvent.click(screen.getByText('Library'));

    expect(screen.getByText('Your Cloned Voices')).toBeInTheDocument();
    expect(screen.getByText('Voice 1')).toBeInTheDocument();
    expect(screen.getByText('Voice 2')).toBeInTheDocument();
  });

  it('shows empty state when no voices exist', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={[]}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    fireEvent.click(screen.getByText('Library'));

    expect(screen.getByText('No voices yet')).toBeInTheDocument();
    expect(
      screen.getByText('Upload or record audio to clone your first voice')
    ).toBeInTheDocument();
  });

  it('renders empty state when no project is selected', () => {
    render(
      <TimelineView
        project={{ ...mockProject, segments: [], video_url: undefined }}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    expect(screen.getByText('🎬')).toBeInTheDocument();
    expect(screen.getByText('No video uploaded')).toBeInTheDocument();
    expect(screen.getByText('Upload a video to start editing')).toBeInTheDocument();
  });

  it('displays video player when video_url exists', () => {
    render(
      <TimelineView
        project={mockProject}
        voices={mockVoices}
        onProjectUpdate={mockOnProjectUpdate}
      />
    );

    // VideoPlayer component should render
    const videoPlayer = document.querySelector('video');
    expect(videoPlayer).toBeInTheDocument();
    expect(videoPlayer).toHaveAttribute('src', '/video/test.mp4');
  });
});