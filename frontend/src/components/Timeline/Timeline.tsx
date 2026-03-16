import { useState, useRef, useEffect } from 'react';
import { timelineApi } from '../../services/api';
import type { TimelineSegment } from '../../types';

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

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastPlayedSegmentRef = useRef<string | null>(null);

  // 视频时间更新时自动播放对应配音
  useEffect(() => {
    if (!videoRef.current || !autoPlayAudio) return;

    const video = videoRef.current;

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      onTimeUpdate?.(currentTime);

      // 查找当前时间段对应的段落
      const activeSegment = segments.find(
        seg => currentTime >= seg.start_time && currentTime <= seg.end_time
      );

      if (activeSegment && activeSegment.audio_url) {
        // 如果切换到了新的段落
        if (lastPlayedSegmentRef.current !== activeSegment.id) {
          lastPlayedSegmentRef.current = activeSegment.id;

          // 停止之前播放的音频
          audioRefs.current.forEach((audio, id) => {
            if (id !== activeSegment.id) {
              audio.pause();
              audio.currentTime = 0;
            }
          });

          // 播放当前段落的配音
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
    }
  };

  const handleDeleteSegment = async (segmentId: string) => {
    try {
      await timelineApi.deleteSegment(segmentId);
      onSegmentsChange?.(segments.filter(s => s.id !== segmentId));
    } catch (err) {
      console.error('Delete segment failed:', err);
    }
  };

  const handleSynthesize = async () => {
    if (segments.length === 0) return;
    setSynthesizing(true);
    try {
      const result = await timelineApi.synthesizeProject(projectId);
      // 更新段落的 audio_url
      const updatedSegments = segments.map(seg => {
        const synthesized = result.segments.find(s => s.segment_id === seg.id);
        return synthesized ? { ...seg, audio_url: synthesized.audio_url } : seg;
      });
      onSegmentsChange?.(updatedSegments);
    } catch (err) {
      console.error('Synthesize failed:', err);
      alert('配音生成失败，请重试');
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

  return (
    <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
      <h3>Timeline Segments</h3>

      {/* 生成配音按钮区域 */}
      <div style={{ marginBottom: '16px', padding: '12px', background: '#f0f7ff', borderRadius: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleSynthesize}
              disabled={synthesizing || segments.length === 0}
              style={{
                padding: '10px 20px',
                background: synthesizing || segments.length === 0 ? '#ccc' : '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: synthesizing || segments.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 500,
              }}
            >
              {synthesizing ? 'Generating...' : 'Generate Voiceover'}
            </button>

            {hasAudio && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
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
            <div style={{ fontSize: '12px', color: '#2e7d32' }}>
              All segments have audio
            </div>
          )}
        </div>
      </div>

      {/* 添加段落表单 */}
      <div style={{ marginBottom: '16px', padding: '12px', background: '#f9f9f9', borderRadius: '4px' }}>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Text</label>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Text for this segment..."
            rows={2}
            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Start (s)</label>
            <input
              type="number"
              value={startTime}
              onChange={(e) => setStartTime(parseFloat(e.target.value))}
              step="0.1"
              min="0"
              style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>End (s)</label>
            <input
              type="number"
              value={endTime}
              onChange={(e) => setEndTime(parseFloat(e.target.value))}
              step="0.1"
              min="0"
              style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleAddSegment}
              disabled={!newText.trim()}
              style={{
                width: '100%',
                padding: '8px',
                background: newText.trim() ? '#1976d2' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: newText.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* 隐藏的视频元素用于同步 */}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ display: 'none' }}
          preload="auto"
        />
      )}

      {/* 段落列表 */}
      {segments.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
          No segments yet. Add text segments to create voiceovers.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {segments.map((segment) => (
            <div
              key={segment.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                border: '1px solid #eee',
                borderRadius: '4px',
                background: 'white',
              }}
            >
              {/* 隐藏的音频元素 */}
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

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '500', marginBottom: '4px' }}>{segment.text}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {segment.start_time.toFixed(1)}s - {segment.end_time.toFixed(1)}s
                </div>
                {segment.audio_url && (
                  <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <audio
                      src={segment.audio_url}
                      controls
                      style={{ height: '24px' }}
                      onPlay={() => {
                        // 停止视频播放
                        if (videoRef.current) {
                          videoRef.current.pause();
                        }
                      }}
                    />
                    <button
                      onClick={() => handlePlaySegmentAudio(segment)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        background: '#e3f2fd',
                        color: '#1976d2',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Play
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => handleDeleteSegment(segment.id)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  background: '#ffebee',
                  color: '#c62828',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginLeft: '8px',
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}