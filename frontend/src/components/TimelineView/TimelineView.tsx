import { useState } from 'react';
import type { TimelineProject, TimelineSegment, VoiceProfile } from '../../types';
import { VideoPlayer } from '../Timeline/VideoPlayer';
import { timelineApi } from '../../services/api';
import styles from './TimelineView.module.css';

interface TimelineViewProps {
  project: TimelineProject;
  voices: VoiceProfile[];
  onProjectUpdate: (project: TimelineProject) => void;
}

export function TimelineView({ project, voices, onProjectUpdate }: TimelineViewProps) {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const handleAssignVoice = async (segmentId: string, voiceId: string) => {
    setIsAssigning(true);
    try {
      await timelineApi.assignVoiceToSegment(segmentId, voiceId);
      // Refresh project to get updated segments
      const updatedProject = await timelineApi.getProject(project.id);
      onProjectUpdate(updatedProject);
    } catch (error) {
      console.error('Failed to assign voice:', error);
    } finally {
      setIsAssigning(false);
      setSelectedSegmentId(null);
    }
  };

  const handleRemoveVoice = async (segmentId: string) => {
    setIsAssigning(true);
    try {
      await timelineApi.removeVoiceFromSegment(segmentId);
      const updatedProject = await timelineApi.getProject(project.id);
      onProjectUpdate(updatedProject);
    } catch (error) {
      console.error('Failed to remove voice:', error);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className={styles.timelineView}>
      {/* Left Panel - Video Stage */}
      <div className={styles.videoStage}>
        <div className={styles.videoContainer}>
          {project.video_url ? (
            <VideoPlayer url={project.video_url} />
          ) : (
            <div className={styles.videoPlaceholder}>
              <div className={styles.videoPlaceholderIcon}>🎬</div>
              <div className={styles.videoPlaceholderText}>No video uploaded</div>
              <div className={styles.videoPlaceholderHint}>
                Upload a video to start editing
              </div>
            </div>
          )}
        </div>

        <div className={styles.timelineSection}>
          <div className={styles.timelineHeader}>
            <div className={styles.timelineTitle}>Timeline</div>
          </div>

          <div className={styles.segmentTrack}>
            {project.segments.map((segment) => (
              <SegmentCard
                key={segment.id}
                segment={segment}
                voices={voices}
                isSelected={selectedSegmentId === segment.id}
                isAssigning={isAssigning}
                onSelect={() => setSelectedSegmentId(segment.id)}
                onAssignVoice={handleAssignVoice}
                onRemoveVoice={handleRemoveVoice}
              />
            ))}

            {project.segments.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📝</div>
                <div className={styles.emptyTitle}>No segments yet</div>
                <div className={styles.emptyHint}>
                  Add text segments to create voiceover
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Voice Panel */}
      <VoicePanel voices={voices} />
    </div>
  );
}

// Sub-components
interface SegmentCardProps {
  segment: TimelineSegment;
  voices: VoiceProfile[];
  isSelected: boolean;
  isAssigning: boolean;
  onSelect: () => void;
  onAssignVoice: (segmentId: string, voiceId: string) => void;
  onRemoveVoice: (segmentId: string) => void;
}

function SegmentCard({
  segment,
  voices,
  isSelected,
  isAssigning,
  onSelect,
  onAssignVoice,
  onRemoveVoice,
}: SegmentCardProps) {
  const assignedVoice = voices.find((v) => v.id === segment.voice_id);

  return (
    <div
      className={`${styles.segmentCard} ${isSelected ? styles.selected : ''}`}
      onClick={onSelect}
    >
      <div className={styles.segmentContent}>
        <div className={styles.segmentText}>{segment.text}</div>

        <div className={styles.segmentMeta}>
          {segment.start_time.toFixed(1)}s - {segment.end_time.toFixed(1)}s
        </div>

        {assignedVoice ? (
          <div className={styles.voiceBadge}>
            <span className={styles.voiceIcon}>🎤</span>
            <span className={styles.voiceName}>{assignedVoice.name}</span>
            <button
              className={styles.removeVoiceButton}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveVoice(segment.id);
              }}
              disabled={isAssigning}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className={styles.assignVoicePlaceholder}>
            <button
              className={styles.assignVoiceButton}
              disabled={isAssigning}
            >
              + Assign Voice
            </button>
          </div>
        )}
      </div>

      {isSelected && !assignedVoice && (
        <div className={styles.voicePicker}>
          <div className={styles.voicePickerTitle}>Select a voice:</div>
          <div className={styles.voiceList}>
            {voices.map((voice) => (
              <button
                key={voice.id}
                className={styles.voiceOption}
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignVoice(segment.id, voice.id);
                }}
                disabled={isAssigning}
              >
                <span className={styles.voiceOptionIcon}>🎤</span>
                <span className={styles.voiceOptionName}>{voice.name}</span>
                {voice.is_cloned && (
                  <span className={styles.voiceOptionBadge}>Cloned</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface VoicePanelProps {
  voices: VoiceProfile[];
}

function VoicePanel({ voices }: VoicePanelProps) {
  const [activeTab, setActiveTab] = useState<'clone' | 'library'>('clone');

  return (
    <div className={styles.voicePanel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>🎤 Voices</div>
      </div>

      <div className={styles.panelTabs}>
        <button
          className={`${styles.panelTab} ${activeTab === 'clone' ? styles.active : ''}`}
          onClick={() => setActiveTab('clone')}
        >
          Clone
        </button>
        <button
          className={`${styles.panelTab} ${activeTab === 'library' ? styles.active : ''}`}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
      </div>

      <div className={styles.panelContent}>
        {activeTab === 'clone' ? (
          <div className={styles.cloneSection}>
            <div className={styles.sectionLabel}>Create New Voice</div>

            <div className={styles.uploadZone}>
              <div className={styles.uploadIcon}>📁</div>
              <div className={styles.uploadText}>Drop audio file to clone</div>
              <div className={styles.uploadHint}>MP3, WAV, WebM supported</div>
            </div>

            <button className={styles.recordButton}>
              <span>🎙️</span>
              <span>Record Voice Sample</span>
            </button>
          </div>
        ) : (
          <div className={styles.voiceListSection}>
            <div className={styles.sectionLabel}>Your Cloned Voices</div>

            {voices.length > 0 ? (
              <div className={styles.voiceList}>
                {voices.map((voice) => (
                  <div
                    key={voice.id}
                    className={styles.voiceCard}
                  >
                    <div className={styles.voiceHeader}>
                      <button className={styles.voicePlayButton}>▶</button>
                      <span className={styles.voiceName}>{voice.name}</span>
                    </div>
                    <div className={styles.voiceMeta}>
                      {voice.is_cloned ? 'Cloned' : 'Not cloned'} • {voice.role || 'Custom'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🎙️</div>
                <div className={styles.emptyTitle}>No voices yet</div>
                <div className={styles.emptyHint}>
                  Upload or record audio to clone your first voice
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}