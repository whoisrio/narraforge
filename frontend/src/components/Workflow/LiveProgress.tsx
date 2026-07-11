import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { WorkflowStageName } from '../../types';
import styles from './LiveProgress.module.css';

export interface ProgressEvent {
  stage: string;
  event_type: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface LiveProgressProps {
  projectId: string;
  runId: string;
  currentStage: WorkflowStageName;
  status: string;
}

const STAGE_ORDER: WorkflowStageName[] = ['gen_script', 'script_review', 'split_segment', 'synthesis'];

const STAGE_ICONS: Record<string, string> = {
  gen_script: '📝',
  script_review: '🔍',
  split_segment: '✂️',
  synthesis: '🎙️',
};

export function LiveProgress({ projectId, runId, currentStage, status }: LiveProgressProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [streamingTexts, setStreamingTexts] = useState<Record<string, string>>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/projects/${projectId}/workflow/${runId}/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setConnected(true);

    eventSource.addEventListener('progress', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents(prev => [...prev, data]);

        // Handle streaming text
        if (data.event_type === 'llm_streaming' && data.data.streaming_text) {
          setStreamingTexts(prev => ({
            ...prev,
            [data.stage]: String(data.data.streaming_text),
          }));
        }
      } catch { /* ignore parse errors */ }
    });

    eventSource.addEventListener('stage_start', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setEvents(prev => [...prev, {
          stage: data.stage,
          event_type: 'stage_start',
          message: `开始 ${t(`workflow.stage.${data.stage}`)}`,
          data,
          timestamp: new Date().toISOString(),
        }]);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('stage_complete', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setEvents(prev => [...prev, {
          stage: data.stage,
          event_type: 'stage_complete',
          message: `${t(`workflow.stage.${data.stage}`)} 完成`,
          data,
          timestamp: new Date().toISOString(),
        }]);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('interrupt', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setEvents(prev => [...prev, {
          stage: 'script_review',
          event_type: 'interrupt',
          message: '等待导演审批',
          data,
          timestamp: new Date().toISOString(),
        }]);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('workflow_complete', () => {
      setEvents(prev => [...prev, {
        stage: 'completed',
        event_type: 'workflow_complete',
        message: '工作流已完成',
        data: {},
        timestamp: new Date().toISOString(),
      }]);
    });

    eventSource.addEventListener('error', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setEvents(prev => [...prev, {
          stage: data.stage || 'unknown',
          event_type: 'error',
          message: data.error || '发生错误',
          data,
          timestamp: new Date().toISOString(),
        }]);
      } catch { /* ignore */ }
    });

    eventSource.onerror = () => setConnected(false);
  }, [projectId, runId, t]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);

  const toggleExpand = (index: number) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Group events by stage
  const eventsByStage = STAGE_ORDER.map(stage => ({
    stage,
    events: events.filter(e => e.stage === stage),
    isActive: stage === currentStage && status === 'running',
    isCompleted: events.some(e => e.stage === stage && e.event_type === 'stage_complete'),
  }));

  const renderEventDetails = (event: ProgressEvent, index: number) => {
    const isExpanded = expandedEvents.has(index);
    const hasDetails = event.event_type === 'llm_response' || event.event_type === 'interrupt';

    if (!hasDetails) return null;

    return (
      <div className={styles.eventDetails}>
        <button
          className={styles.expandButton}
          onClick={() => toggleExpand(index)}
        >
          {isExpanded ? '▼ 收起详情' : '▶ 查看详情'}
        </button>

        {isExpanded && (
          <div className={styles.detailsContent}>
            {/* Script preview for gen_script */}
            {event.stage === 'gen_script' && event.data.script_preview ? (
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>脚本预览:</div>
                <div className={styles.scriptPreview}>{event.data.script_preview as string}</div>
              </div>
            ) : null}

            {/* Chapters info */}
            {event.data.chapters && Array.isArray(event.data.chapters) ? (
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>章节:</div>
                <div className={styles.chaptersList}>
                  {(event.data.chapters as Array<{title: string; length: number}>).map((ch, i) => (
                    <div key={i} className={styles.chapterItem}>
                      <span className={styles.chapterTitle}>{String(ch.title)}</span>
                      <span className={styles.chapterLength}>{String(ch.length)}字</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Review dimensions for script_review */}
            {event.stage === 'script_review' && event.data.dimensions_summary ? (
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>审查维度:</div>
                <div className={styles.dimensionsList}>
                  {(event.data.dimensions_summary as Array<{name: string; status: string; comment: string}>).map((dim, i) => (
                    <div key={i} className={styles.dimensionItem}>
                      <span className={`${styles.dimensionStatus} ${styles[`status_${dim.status}`]}`}>
                        {dim.status === 'pass' ? '✓' : dim.status === 'warn' ? '⚠' : '✗'}
                      </span>
                      <span className={styles.dimensionName}>{String(dim.name)}</span>
                      <span className={styles.dimensionComment}>{String(dim.comment)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Overall comment */}
            {event.data.overall_comment ? (
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>总体评价:</div>
                <div className={styles.overallComment}>{String(event.data.overall_comment)}</div>
              </div>
            ) : null}

            {/* Chapters detail for split_segment */}
            {event.stage === 'split_segment' && event.data.chapters_detail ? (
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>拆分结果:</div>
                <div className={styles.chaptersDetail}>
                  {(event.data.chapters_detail as Array<{title: string; segment_count: number; segments_preview: Array<{text: string; emotion: string}>}>).map((ch, i) => (
                    <div key={i} className={styles.chapterDetail}>
                      <div className={styles.chapterHeader}>
                        <span className={styles.chapterTitle}>{String(ch.title)}</span>
                        <span className={styles.segmentCount}>{String(ch.segment_count)} 段</span>
                      </div>
                      {ch.segments_preview.map((seg, j) => (
                        <div key={j} className={styles.segmentPreview}>
                          <span className={styles.segmentEmotion}>{String(seg.emotion)}</span>
                          <span className={styles.segmentText}>{String(seg.text)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.liveProgress}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>实时进度</span>
          <span className={`${styles.connectionStatus} ${connected ? styles.connected : styles.disconnected}`}>
            {connected ? '● 已连接' : '○ 未连接'}
          </span>
        </div>
        <button
          className={styles.refreshButton}
          onClick={() => {
            setEvents([]);
            connect();
          }}
          title="刷新进度"
        >
          ↻ 刷新
        </button>
      </div>

      <div className={styles.stagesTimeline}>
        {eventsByStage.map(({ stage, events: stageEvents, isActive, isCompleted }) => (
          <div
            key={stage}
            className={`${styles.stageBlock} ${isActive ? styles.stageActive : ''} ${isCompleted ? styles.stageCompleted : ''}`}
          >
            <div className={styles.stageHeader}>
              <span className={styles.stageIcon}>{STAGE_ICONS[stage]}</span>
              <span className={styles.stageName}>{t(`workflow.stage.${stage}`)}</span>
              {isActive && <span className={styles.spinner}>●</span>}
              {isCompleted && <span className={styles.checkmark}>✓</span>}
            </div>

            {stageEvents.length > 0 && (
              <div className={styles.stageEvents}>
                {stageEvents.slice(-5).map((event, idx) => {
                  const globalIdx = events.indexOf(event);
                  return (
                    <div key={idx} className={`${styles.eventItem} ${styles[`event_${event.event_type}`]}`}>
                      <span className={styles.eventMessage}>{event.message}</span>
                      {event.event_type === 'progress' && event.data && (
                        <span className={styles.progressBadge}>
                          {String(event.data.completed)}/{String(event.data.total)}
                        </span>
                      )}
                      {renderEventDetails(event, globalIdx)}
                    </div>
                  );
                })}

                {/* Streaming text display */}
                {isActive && streamingTexts[stage] && (
                  <div className={styles.streamingText}>
                    <div className={styles.streamingLabel}>LLM 输出:</div>
                    <div className={styles.streamingContent}>{streamingTexts[stage]}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <div className={styles.latestEvent}>
          <span className={styles.latestLabel}>最新:</span>
          <span className={styles.latestMessage}>{events[events.length - 1].message}</span>
        </div>
      )}
    </div>
  );
}
