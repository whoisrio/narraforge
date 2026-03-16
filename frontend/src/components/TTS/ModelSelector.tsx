import { useState, useEffect } from 'react';
import { configApi } from '../../services/api';
import type { TTSConfig } from '../../types';

interface ModelSelectorProps {
  onSelect?: (config: TTSConfig) => void;
}

export function ModelSelector({ onSelect }: ModelSelectorProps) {
  const [configs, setConfigs] = useState<TTSConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newConfig, setNewConfig] = useState({
    name: '',
    provider: 'qwen',
    model_name: 'qwen-tts',
    speed: 1.0,
    volume: 80,
    pitch: 0,
    emotion: 'neutral',
  });

  const fetchConfigs = async () => {
    try {
      const list = await configApi.listModels();
      setConfigs(list);
    } catch (err) {
      console.error('Failed to fetch configs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleCreate = async () => {
    try {
      await configApi.createModel(newConfig);
      setNewConfig({ name: '', provider: 'qwen', model_name: 'qwen-tts', speed: 1.0, volume: 80, pitch: 0, emotion: 'neutral' });
      setShowForm(false);
      fetchConfigs();
    } catch (err) {
      console.error('Create failed:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this model config?')) return;
    try {
      await configApi.deleteModel(id);
      fetchConfigs();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  if (loading) return <div>Loading models...</div>;

  return (
    <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3>🤖 Model Configuration</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            background: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ Add Model'}
        </button>
      </div>

      {showForm && (
        <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Model name"
            value={newConfig.name}
            onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
            style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <input
            type="text"
            placeholder="Provider (qwen/azure/openai)"
            value={newConfig.provider}
            onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}
            style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <input
            type="text"
            placeholder="Model name"
            value={newConfig.model_name}
            onChange={(e) => setNewConfig({ ...newConfig, model_name: e.target.value })}
            style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <button
            onClick={handleCreate}
            style={{
              width: '100%',
              padding: '8px',
              background: '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Create
          </button>
        </div>
      )}

      {configs.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
          No models configured. Add a model to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {configs.map((config) => (
            <div
              key={config.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                border: config.is_default ? '2px solid #4caf50' : '1px solid #eee',
                borderRadius: '4px',
                background: config.is_default ? '#f1f8e9' : 'white',
                cursor: 'pointer',
              }}
              onClick={() => onSelect?.(config)}
            >
              <div>
                <div style={{ fontWeight: '500' }}>
                  {config.name}
                  {config.is_default && <span style={{ marginLeft: '8px', fontSize: '10px', background: '#4caf50', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>DEFAULT</span>}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {config.provider} / {config.model_name}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(config.id); }}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  background: '#ffebee',
                  color: '#c62828',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
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