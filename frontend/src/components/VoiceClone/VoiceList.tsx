import { useState, useEffect } from 'react';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';
import { Button, Modal, Input, Select, Loading, EmptyState, Card, Alert } from '../ui';

interface VoiceListProps {
  onRefresh?: () => void;
}

export function VoiceList({ onRefresh }: VoiceListProps) {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceProfile | null>(null);
  const [registerName, setRegisterName] = useState('');
  const [registerRole, setRegisterRole] = useState('custom');
  const [registerResult, setRegisterResult] = useState<{ qwen_voice_id?: string; role?: string; cloned_at?: string } | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchVoices = async () => {
    try {
      try {
        setSyncing(true);
        await voiceApi.syncFromQwen();
      } catch (e) {
        console.warn('Sync from Qwen failed, using local data:', e);
      } finally {
        setSyncing(false);
      }

      const all = await voiceApi.list();
      const cloned = all.filter(v => v.is_cloned && v.qwen_voice_id);
      setVoices(cloned);
    } catch (err) {
      console.error('Failed to fetch voices:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFromQwen = async () => {
    setSyncing(true);
    try {
      const result = await voiceApi.syncFromQwen();
      setSyncMessage({ type: 'success', text: result.message });
      fetchVoices();
      onRefresh?.();
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncMessage({ type: 'error', text: 'Sync failed, please try again' });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchVoices();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this voice?')) return;
    try {
      await voiceApi.delete(id);
      fetchVoices();
      onRefresh?.();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleRegisterClick = (voice: VoiceProfile) => {
    setSelectedVoice(voice);
    setRegisterName(voice.name);
    setRegisterRole('custom');
    setRegisterResult(null);
    setShowRegisterDialog(true);
  };

  const handleRegister = async () => {
    if (!selectedVoice) return;
    setRegisteringId(selectedVoice.id);
    try {
      const result = await fetch('/api/clone/create-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_id: selectedVoice.id,
          name: registerName,
          role: registerRole,
        }),
      }).then(r => r.json());
      setRegisterResult(result);
      fetchVoices();
    } catch (err) {
      console.error('Register failed:', err);
      alert('Voice registration failed, please try again');
    } finally {
      setRegisteringId(null);
    }
  };

  const handleCloseModal = () => {
    setShowRegisterDialog(false);
    setSelectedVoice(null);
    setRegisterResult(null);
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--spacing-lg)',
  };

  const h3Style: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const voiceCardStyle: React.CSSProperties = {
    marginBottom: 'var(--spacing-md)',
  };

  const voiceContentStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-md)',
  };

  const voiceInfoStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-md)',
    flex: 1,
  };

  const voiceNameStyle: React.CSSProperties = {
    fontWeight: 'var(--font-weight-medium)',
    fontSize: 'var(--font-size-base)',
  };

  const voiceMetaStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  };

  const actionButtonsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--spacing-sm)',
  };

  if (loading || syncing) {
    return <Loading message={syncing ? 'Syncing from Qwen...' : 'Loading voices...'} />;
  }

  return (
    <div>
      <div style={headerStyle}>
        <h3 style={h3Style}>🎤 Cloned Voices</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSyncFromQwen}
          disabled={syncing}
          loading={syncing}
        >
          🔄 Sync from Qwen
        </Button>
      </div>

      {syncMessage && (
        <Alert variant={syncMessage.type} onDismiss={() => setSyncMessage(null)}>
          {syncMessage.text}
        </Alert>
      )}

      {voices.length === 0 ? (
        <EmptyState
          icon="🎙️"
          title="No Voices Yet"
          description="Upload or record audio to clone (1) voice."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          {voices.map((voice) => (
            <Card key={voice.id} style={voiceCardStyle}>
              <div style={voiceContentStyle}>
                <div style={voiceInfoStyle}>
                  <audio src={voice.audio_url} controls style={{ height: '32px' }} />
                  <div>
                    <div style={voiceNameStyle}>{voice.name}</div>
                    <div style={voiceMetaStyle}>
                      {voice.is_cloned ? (
                        <>
                          <span style={{ color: 'var(--color-success)', marginRight: 'var(--spacing-xs)' }}>✓ Cloned</span>
                          ID: {voice.qwen_voice_id || 'N/A'}
                          {' | '}Role: {voice.role}
                          {voice.cloned_at && ` | ${new Date(voice.cloned_at).toLocaleDateString()}`}
                        </>
                      ) : (
                        'Not cloned yet'
                      )}
                    </div>
                  </div>
                </div>
                <div style={actionButtonsStyle}>
                  {!voice.is_cloned && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRegisterClick(voice)}
                    >
                      Clone
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(voice.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={showRegisterDialog && selectedVoice !== null}
        onClose={handleCloseModal}
        title="Clone Voice"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCloseModal}>
              {registerResult ? 'Close' : 'Cancel'}
            </Button>
            {!registerResult && (
              <Button
                variant="primary"
                onClick={handleRegister}
                loading={!!registeringId}
                disabled={!registerName.trim()}
              >
                {registeringId ? 'Cloning...' : 'Clone'}
              </Button>
            )}
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-lg)' }}>
          Submit (1) audio to Qwen for voice cloning. This will create a persistent voice ID.
        </p>

        <Input
          label="Voice Name"
          type="text"
          value={registerName}
          onChange={(e) => setRegisterName(e.target.value)}
          style={{ marginBottom: 'var(--spacing-md)' }}
        />

        <Select
          label="Role"
          options={[
            { value: 'custom', label: 'Custom' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          value={registerRole}
          onChange={(e) => setRegisterRole(e.target.value as string)}
        />

        {registerResult && (
          <Alert variant="success" style={{ marginTop: 'var(--spacing-md)' }}>
            <div style={{ fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--spacing-xs)' }}>✓ Clone Successful!</div>
            <div><strong>Voice ID:</strong> {registerResult.qwen_voice_id}</div>
            <div><strong>Role:</strong> {registerResult.role}</div>
            <div><strong>Cloned at:</strong> {registerResult.cloned_at ? new Date(registerResult.cloned_at).toLocaleString() : 'N/A'}</div>
          </Alert>
        )}
      </Modal>
    </div>
  );
}
