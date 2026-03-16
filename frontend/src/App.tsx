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
import type { TimelineProject } from './types';

function App() {
  const [activeTab, setActiveTab] = useState<'clone' | 'tts' | 'timeline'>('clone');
  const [voiceRefreshKey, setVoiceRefreshKey] = useState(0);

  // Timeline state
  const [projects, setProjects] = useState<TimelineProject[]>([]);
  const [currentProject, setCurrentProject] = useState<TimelineProject | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

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

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Header */}
      <header style={{
        background: 'white',
        borderBottom: '1px solid #eee',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>
          🎙️ Voice Clone Studio
        </h1>
        <nav style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('clone')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'clone' ? '#1976d2' : 'transparent',
              color: activeTab === 'clone' ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🔊 Voice Clone
          </button>
          <button
            onClick={() => setActiveTab('tts')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'tts' ? '#1976d2' : 'transparent',
              color: activeTab === 'tts' ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            📝 TTS
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'timeline' ? '#1976d2' : 'transparent',
              color: activeTab === 'timeline' ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🎬 Timeline
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {/* Voice Clone Tab */}
        {activeTab === 'clone' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div>
              <h2 style={{ marginBottom: '16px' }}>Clone Your Voice</h2>
              <AudioUploader onUploadComplete={() => setVoiceRefreshKey(k => k + 1)} />
              <div style={{ marginTop: '24px' }}>
                <AudioRecorder onRecordComplete={() => setVoiceRefreshKey(k => k + 1)} />
              </div>
            </div>
            <VoiceList key={voiceRefreshKey} onRefresh={() => setVoiceRefreshKey(k => k + 1)} />
          </div>
        )}

        {/* TTS Tab */}
        {activeTab === 'tts' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <TTSControls />
            <ModelSelector />
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>Video Timeline</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleCreateProject}
                  style={{
                    padding: '8px 16px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
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
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                <div>
                  <VideoPlayer
                    url={currentProject.video_url}
                  />
                  {currentProject.video_url && (
                    <div style={{ marginTop: '24px' }}>
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
                  <h3>Projects</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        onClick={() => setCurrentProject(project)}
                        style={{
                          padding: '12px',
                          border: currentProject?.id === project.id ? '2px solid #1976d2' : '1px solid #eee',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: currentProject?.id === project.id ? '#e3f2fd' : 'white',
                        }}
                      >
                        {project.name}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>
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