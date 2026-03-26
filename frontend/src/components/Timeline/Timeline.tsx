import { useState, useRef, useEffect } from 'react';
import { timelineApi } from '../../services/api';
import type { TimelineSegment } from '../../types';
import { Button, Input, Card, EmptyState, Alert } from '../ui';

interface TimelineProps {
  projectId: string;
  segments: TimelineSegment[];
  onSegmentsChange?: (segments: TimelineSegment[]) => void;
  videoUrl?: string;
  onTimeUpdate?: (time: number) => void;
}

export function Timeline({ projectId, segments, onSegmentsChange, videoUrl, onTimeUpdate }: TimelineProps) {
  const [newText, setNewText] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(5);
  const [synthesizing, setSynthesizing] = useState(false);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastPlayedSegmentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!videoRef.current || !autoPlayAudio) return;

    const video = videoRef.current;

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      onTimeUpdate?.(currentTime);

      const activeSegment = segments.find(
        seg => currentTime >= seg.start_time && currentTime <= seg.end_time
      );

      if (activeSegment && activeSegment.audio_url) {
        if (lastPlayedSegmentRef.current !== activeSegment.id) {
          lastPlayedSegmentRef.current = activeSegment.id;

          audioRefs.current.forEach((audio, id) => {
            if (id !== activeSegment.id) {
              audio.pause();
              audio.currentTime = 0;
            }
          });

          const audio = audioRefs.current.get(activeSegment.id);
          if (audio) {
            audio.currentTime = 0;
            audio.play().catch(console.error);
          }
        }
      } else {
        lastPlayedSegmentRef.current = null;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [segments, autoPlayAudio, onTimeUpdate]);

  const handleAddSegment = async () => {
    if (!newText.trim()) return;
    try {
      await timelineApi.addSegment(projectId, newText, startTime, endTime);
      setNewText('');
      onSegmentsChange?.(segments);
    } catch (err) {
      console.error('Add segment failed:', err);
      setError('Failed to add segment');
    }
  };

  const handleDeleteSegment = async (segmentId: string) => {
    try {
      await timelineApi.deleteSegment(segmentId);
      onSegmentsChange?.(segments.filter(s => s.id !== segmentId));
    } catch (err) {
      console.error('Delete segment failed:', err);
      setError('Failed to delete segment');
    }
  };

  const handleSynthesize = async () => {
    if (segments.length === 0) return;
    setSynthesizing(true);
    setError(null);
    try {
      const result = await timelineApi.synthesizeProject(projectId);
      const updatedSegments = segments.map(seg => {
        const synthesized = result.segments.find(s => s.segment_id === seg.id);
        return synthesized ? { ...seg, audio_url: synthesized.audio_url } : seg;
      });
      onSegmentsChange?.(updatedSegments);
    } catch (err) {
      console.error('Synthesize failed:', err);
      setError('Voiceover generation failed');
    } finally {
      setSynthesizing(false);
    }
  };

  const handlePlaySegmentAudio = (segment: TimelineSegment) => {
    if (!segment.audio_url) return;
    const audio = audioRefs.current.get(segment.id);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(console.error);
    }
  };

  const hasAudio = segments.some(s => s.audio_url);

  const headerStyle = {
    marginBottom: 'var(--spacing-md)',
  };

  const h3Style = {
    margin: 0,
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const controlsContainerStyle = {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    flexWrap: 'wrap' as const,
    gap: 'var(--spacing-md)',
    padding: 'var(--spacing-md)',
    background: 'rgba(25, 118, 210, 0.05)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--spacing-md)',
  };

  const formContainerStyle = {
    padding: 'var(--spacing-md)',
    background: 'rgba(253, 249, 249, 0.8)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--spacing-md)',
  };

  const formGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 'var(--spacing-sm)',
  };

  const segmentItemStyle = {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 'var(--spacing-md)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)',
    marginBottom: 'var(--spacing-sm)',
  };

  const segmentInfoStyle = {
    flex: 1,
  };

  const segmentTextStyle = {
    fontWeight: 'var(--font-weight-medium)',
    marginBottom: 'var(--spacing-xs)',
  };

  const segmentMetaStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  };

  const audioControlsStyle = {
    marginTop: 'var(--spacing-xs)',
    display: 'flex',
    alignItems: 'center' as const,
    gap: 'var(--spacing-sm)',
  };

  return (
    <Card>
      <div style={headerStyle}>
        <h3 style={h3Style}>Timeline Segments</h3>
      </div>

      <div style={controlsContainerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <Button
            variant="primary"
            onClick={handleSynthesize}
            disabled={synthesizing || segments.length === 0}
            loading={synthesizing}
          >
            {synthesizing ? 'Generating...' : 'Generate Voiceover'}
          </Button>

          {hasAudio && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoPlayAudio}
                onChange={(e) => setAutoPlayAudio(e.target.checked)}
              />
              Auto-play during video
            </label>
          )}
        </div>

        {hasAudio && (
          <Alert variant="info">
            All segments have audio
          </Alert>
        )}
      </div>

      {error && (
        <Alert variant="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div style={formContainerStyle}>
        <div style={{ marginBottom: 'var(--spacing-sm)' }}>
          <Input
            label="Text"
            type="textarea"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Text for this segment..."
            style={{ minHeight: '60px' }}
          />
        </div>
        <div style={formGridStyle}>
          <Input
            label="Start (s)"
            type="text"
            value={startTime.toString()}
            onChange={(e) => setStartTime(parseFloat(e.target.value) || 0)}
          />
          <Input
            label="End (s)"
            type="text"
            value={endTime.toString()}
            onChange={(e) => setEndTime(parseFloat(e.target.value) || 0)}
          />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button
              variant="primary"
              fullWidth
              onClick={handleAddSegment}
              disabled={!newText.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ display: 'none' }}
          preload="auto"
        />
      )}

      {segments.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No Segments Yet"
          description="Add text segments to create voiceovers."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
          {segments.map((segment) => (
            <div key={segment.id} style={segmentItemStyle}>
              {segment.audio_url && (
                <audio
                  ref={(el) => {
                    if (el) audioRefs.current.set(segment.id, el);
                    else audioRefs.current.delete(segment.id);
                  }}
                  src={segment.audio_url}
                  preload="auto"
                />
              )}

              <div style={segmentInfoStyle}>
                <div style={segmentTextStyle}>{segment.text}</div>
                <div style={segmentMetaStyle}>
                  {segment.start_time.toFixed(1)}s - {segment.end_time.toFixed(1)}s
                </div>
                {segment.audio_url && (
                  <div style={audioControlsStyle}>
                    <audio
                      src={segment.audio_url}
                      controls
                      style={{ height: '24px' }}
                      onPlay={() => {
                        if (videoRef.current) {
                          videoRef.current.pause();
                        }
                      }}
                    />
                    <Button variant="secondary" size="sm" onClick={() => handlePlaySegmentAudio(segment)}>
                      Play
                    </Button>
                  </div>
                )}
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleDeleteSegment(segment.id)}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
