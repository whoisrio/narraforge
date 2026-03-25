import { useState, useEffect } from 'react';
import { configApi } from '../../services/api';
import type { TTSConfig } from '../../types';
import { Button, Input, Card, EmptyState } from '../ui';

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

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 'var(--spacing-md)',
  };

  const h3Style = {
    margin: 0,
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const formContainerStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--spacing-sm)',
  };

  const configItemStyle = (isDefault: boolean) => ({
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 'var(--spacing-md)',
    border: isDefault ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: isDefault ? 'rgba(76, 175, 80, 0.1)' : 'var(--color-surface)',
    cursor: 'pointer' as const,
    transition: 'background-color var(--transition-fast), border-color var(--transition-fast)',
  });

  const defaultBadgeStyle = {
    marginLeft: 'var(--spacing-sm)',
    fontSize: '10px',
    background: 'var(--color-success)',
    color: 'white',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 'var(--font-weight-medium)',
  };

  const handleConfigClick = (config: TTSConfig) => {
    onSelect?.(config);
  };

  if (loading) {
    return <Card><h3 style={h3Style}>🤖 Model Configuration</h3><div style={{ padding: 'var(--spacing-xl)' }}>Loading models...</div></Card>;
  }

  return (
    <Card>
      <div style={headerStyle}>
        <h3 style={h3Style}>🤖 Model Configuration</h3>
        <Button
          variant={showForm ? 'ghost' : 'primary'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : '+ Add Model'}
        </Button>
      </div>

      {showForm && (
        <div style={{ ...formContainerStyle, padding: 'var(--spacing-md)', background: 'rgba(25, 118, 210, 0.05)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)' }}>
          <Input
            label="Model name"
            type="text"
            placeholder="Enter model name"
            value={newConfig.name}
            onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
          />
          <Input
            label="Provider"
            type="text"
            placeholder="qwen/azure/openai"
            value={newConfig.provider}
            onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}
          />
          <Input
            label="Model name"
            type="text"
            placeholder="qwen-tts"
            value={newConfig.model_name}
            onChange={(e) => setNewConfig({ ...newConfig, model_name: e.target.value })}
          />
          <Button
            variant="primary"
            fullWidth
            onClick={handleCreate}
            disabled={!newConfig.name.trim()}
          >
            Create
          </Button>
        </div>
      )}

      {configs.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="No Models Configured"
          description="Add a model configuration to get started."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
          {configs.map((config) => (
            <div
              key={config.id}
              style={configItemStyle(config.is_default)}
              onClick={() => handleConfigClick(config)}
            >
              <div>
                <div style={{ fontWeight: 'var(--font-weight-medium)', display: 'flex', alignItems: 'center' }}>
                  {config.name}
                  {config.is_default && <span style={defaultBadgeStyle}>DEFAULT</span>}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  {config.provider} / {config.model_name}
                </div>
              </div>
              {!config.is_default && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(config.id); }}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
