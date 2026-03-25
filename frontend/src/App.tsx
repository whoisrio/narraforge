import { useState, useEffect } from 'react';
import { AudioUploader } from './components/VoiceClone/AudioUploader';
import { AudioRecorder } from './components/VoiceClone/AudioRecorder';
import { VoiceList } from './components/VoiceClone/VoiceList';
import { TTSControls } from './components/TTS/TTSControls';
import { ModelSelector } from './components/TTS/ModelSelector';
import { VideoPlayer } from './components/Timeline/VideoPlayer';
import { VideoUpload } from './components/Timeline/VideoUpload';
import { Timeline } from './components/Timeline/Timeline';
import { timelineApi } from './services/api';
import { Tabs } from './components/ui';
import type { TimelineProject } from './types';

interface AppTab {
  id: 'clone' | 'tts' | 'timeline';
  label: string;
  icon: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<'clone' | 'tts' | 'timeline'>('clone');
  const [voiceRefreshKey, setVoiceRefreshKey] = useState(0);

  const [projects, setProjects] = useState<TimelineProject[]>([]);
  const [currentProject, setCurrentProject] = useState<TimelineProject | null>(null);

  const loadProjects = async () => {
    try {
      const list = await timelineApi.listProjects();
      setProjects(list);
      if (list.length > 0 && !currentProject) {
        setCurrentProject(list[0]);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async () => {
    const name = prompt('Enter project name:');
    if (!name) return;
    try {
      const project = await timelineApi.createProject(name);
      setProjects([project, ...projects]);
      setCurrentProject(project);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleSegmentsChange = async () => {
    if (currentProject) {
      const updated = await timelineApi.getProject(currentProject.id);
      setCurrentProject(updated);
    }
  };

  const tabs: AppTab[] = [
    { id: 'clone', label: 'Voice Clone', icon: '🔊' },
    { id: 'tts', label: 'TTS', icon: '📝' },
    { id: 'timeline', label: 'Timeline', icon: '🎬' },
  ];

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as 'clone' | 'tts' | 'timeline');
  };

  const headerStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    borderBottom: `1px solid var(--color-border-light)`,
    padding: 'var(--spacing-md) var(--spacing-lg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const h1Style: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-primary)',
  };

  const mainStyle: React.CSSProperties = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: 'var(--spacing-lg)',
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--spacing-lg)',
  };

  const projectHeaderStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--spacing-md)',
  };

  const h2Style: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-primary)',
  };

  const actionButtonsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--spacing-sm)',
  };

  const projectListStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-sm)',
  };

  const projectItemStyle = (isSelected: boolean): React.CSSProperties => ({
    padding: 'var(--spacing-md)',
    border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    background: isSelected ? 'rgba(25, 118, 210, 0.1)' : 'var(--color-surface)',
    transition: 'background-color var(--transition-fast), border-color var(--transition-fast)',
  });

  const emptyProjectStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: 'var(--spacing-3xl)',
    color: 'var(--color-text-secondary)',
  };

  const timelineGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: 'var(--spacing-lg)',
  };

  return (
    <div style={{ minHeight: '100.5vh', background: 'var(--color-background)' }}>
      <header style={headerStyle}>
        <h1 style={h1Style}>🎙️ Voice Clone Studio</h1>
      </header>

      <main style={mainStyle}>
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={handleTabChange}
        />

        {activeTab === 'clone' && (
          <div style={gridStyle}>
            <div>
              <h2 style={h2Style}>Clone Your Voice</h2>
              <AudioUploader onUploadComplete={() => setVoiceRefreshKey(k => k + 1)} />
              <div style={{ marginTop: 'var(--spacing-lg)' }}>
                <AudioRecorder onRecordComplete={() => setVoiceRefreshKey(k => k + 1)} />
              </div>
            </div>
            <VoiceList key={voiceRefreshKey} onRefresh={() => setVoiceRefreshKey(k => k + 1)} />
          </div>
        )}

        {activeTab === 'tts' && (
          <div style={gridStyle}>
            <TTSControls />
            <ModelSelector />
          </div>
        )}

        {activeTab === 'timeline' && (
          <div>
            <div style={projectHeaderStyle}>
              <h2 style={h2Style}>Video Timeline</h2>
              <div style={actionButtonsStyle}>
                <button
                  onClick={handleCreateProject}
                  style={{
                    padding: 'var(--spacing-sm) var(--spacing-md)',
                    background: 'var(--color-success)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  + New Project
                </button>
                {currentProject && (
                  <VideoUpload
                    projectId={currentProject.id}
                    onUploadComplete={handleSegmentsChange}
                  />
                )}
              </div>
            </div>

            {currentProject ? (
              <div style={timelineGridStyle}>
                <div>
                  <VideoPlayer
                    url={currentProject.video_url}
                  />
                  {currentProject.video_url && (
                    <div style={{ marginTop: 'var(--spacing-lg)' }}>
                      <Timeline
                        projectId={currentProject.id}
                        segments={currentProject.segments}
                        onSegmentsChange={handleSegmentsChange}
                        videoUrl={currentProject.video_url}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <h2 style={{ ...h2Style, fontSize: 'var(--font-size-base)' }}>Projects</h2>
                  <div style={projectListStyle}>
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        onClick={() => setCurrentProject(project)}
                        style={projectItemStyle(currentProject?.id === project.id)}
                      >
                        {project.name}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={emptyProjectStyle}>
                No project selected. Create or select a project to get started.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
