import { useState } from 'react';
import { WorkflowHub } from './WorkflowHub';
import { ReviewEditor } from './ReviewEditor';
import { WorkflowRunDetail } from './WorkflowRunDetail';

interface WorkflowPageProps {
  projectId: string;
}

type WorkflowView = 'hub' | { type: 'review'; runId: string } | { type: 'detail'; runId: string };

export function WorkflowPage({ projectId }: WorkflowPageProps) {
  const [view, setView] = useState<WorkflowView>('hub');

  if (view === 'hub') {
    return (
      <WorkflowHub
        projectId={projectId}
        onViewRun={runId => setView({ type: 'detail', runId })}
        onViewReview={runId => setView({ type: 'review', runId })}
      />
    );
  }

  if (view.type === 'review') {
    return (
      <ReviewEditor
        projectId={projectId}
        runId={view.runId}
        onBack={() => setView('hub')}
        onComplete={() => setView('hub')}
      />
    );
  }

  return (
    <WorkflowRunDetail
      projectId={projectId}
      runId={view.runId}
      onBack={() => setView('hub')}
    />
  );
}
