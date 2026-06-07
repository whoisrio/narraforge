import { useState } from 'react';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { SegmentEditDrawer } from '../components/SegmentedTTS/SegmentEditDrawer';
import { ProjectToolbar } from '../components/SegmentedTTS/ProjectToolbar';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { segmentedReducer, createInitialProject, type Action } from '../hooks/useSegmentedProject';
import type { SegmentedProject } from '../types';
import styles from './SegmentedTTS.module.css';

// Lightweight state management (no useReducer for now — we use useState + dispatch wrapper)
function useProjectState() {
  const [project, setProject] = useState<SegmentedProject>(createInitialProject);

  const dispatch = (action: Action) => {
    setProject(prev => {
      const result = segmentedReducer({ project: prev }, action);
      return result.project;
    });
  };

  return { project, dispatch };
}

export function SegmentedTTS() {
  const { project, dispatch } = useProjectState();
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const editingSegment = project.segments.find(s => s.id === project.selected_segment_id) ?? null;

  return (
    <div className={styles.container}>
      <ProjectToolbar
        project={project}
        onRename={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
        onLayoutToggle={() => dispatch({
          type: 'SET_LAYOUT',
          layout: project.layout === 'vertical' ? 'horizontal' : 'vertical',
        })}
        onGenerateAll={() => { /* placeholder for T20 */ }}
        onAnnotateAll={() => { /* placeholder for T21 */ }}
        onExport={() => setExportOpen(true)}
      />
      <SegmentList
        segments={project.segments}
        layout={project.layout}
        selectedId={project.selected_segment_id}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
        onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
        onAppend={() => dispatch({ type: 'APPEND_SEGMENT', text: '' })}
        onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
        onEdit={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onRegenerate={() => {}}
        onUndo={() => {}}
      />
      <SegmentEditDrawer
        segment={editingSegment}
        onClose={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
        onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
        onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
        onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
        onRegenerate={() => {}}
        onAnnotateSSML={() => {}}
      />
      <ExportDialog
        open={exportOpen}
        segments={project.segments}
        defaultName={project.name}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
