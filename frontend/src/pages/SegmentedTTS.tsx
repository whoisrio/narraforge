import { useState } from 'react';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { SegmentEditDrawer } from '../components/SegmentedTTS/SegmentEditDrawer';
import { ProjectToolbar } from '../components/SegmentedTTS/ProjectToolbar';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { useSegmentedProject, segmentedReducer, createInitialProject, type Action } from '../hooks/useSegmentedProject';
import { textSplitApi } from '../services/api';
import type { SegmentedProject } from '../types';
import styles from './SegmentedTTS.module.css';

export function SegmentedTTS() {
  const [state, dispatch] = useSegmentedProject();
  const { project } = state;
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const editingSegment = project.segments.find(s => s.id === project.selected_segment_id) ?? null;

  const handleSplit = (texts: string[]) => {
    dispatch({ type: 'APPLY_SPLIT', texts });
  };

  const handleLLMSplit = async (text: string) => {
    const result = await textSplitApi.llmSplit(text);
    const texts = result.segments.map(s => s.text);
    dispatch({ type: 'APPLY_SPLIT', texts });
  };

  const handleSplitConfigChange = (config: SegmentedProject['split_config']) => {
    dispatch({ type: 'SET_SPLIT_CONFIG', config });
  };

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
      <TextInputPanel
        splitConfig={project.split_config}
        onSplitConfigChange={handleSplitConfigChange}
        onSplit={handleSplit}
        onLLMSplit={handleLLMSplit}
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
        onAnnotateSSML={() => {}}
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
