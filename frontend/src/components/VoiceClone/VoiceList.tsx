import { useState, useEffect } from 'react';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';

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
  const [registerResult, setRegisterResult] = useState<any>(null);

  // 获取已克隆的声音列表（优先从 Qwen 同步）
  const fetchVoices = async () => {
    try {
      // 总是先尝试同步
      try {
        setSyncing(true);
        await voiceApi.syncFromQwen();
      } catch (e) {
        console.warn('Sync from Qwen failed, using local data:', e);
      } finally {
        setSyncing(false);
      }

      // 获取所有声音，然后过滤
      const all = await voiceApi.list();
      // 只显示已克隆的
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
      alert(result.message);
      fetchVoices();
      onRefresh?.();
    } catch (err) {
      console.error('Sync failed:', err);
      alert('Sync failed, please try again');
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
      // 调用注册接口
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
      // 刷新列表
      fetchVoices();
    } catch (err) {
      console.error('Register failed:', err);
      alert('Voice registration failed, please try again');
    } finally {
      setRegisteringId(null);
    }
  };

  if (loading || syncing) return <div>{syncing ? 'Syncing from Qwen...' : 'Loading voices...'}</div>;

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3>🎤 Cloned Voices</h3>
        <button
          onClick={handleSyncFromQwen}
          disabled={syncing}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            background: syncing ? '#ccc' : '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: syncing ? 'not-allowed' : 'pointer',
          }}
        >
          {syncing ? 'Syncing...' : '🔄 Sync from Qwen'}
        </button>
      </div>
      {voices.length === 0 ? (
        <div style={{ color: '#666', padding: '20px', textAlign: 'center' }}>
          No voices yet. Upload or record audio to clone.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {voices.map((voice) => (
            <div
              key={voice.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                border: '1px solid #eee',
                borderRadius: '8px',
                background: 'white',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <audio src={voice.audio_url} controls style={{ height: '32px' }} />
                <div>
                  <div style={{ fontWeight: '500' }}>{voice.name}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {voice.is_cloned ? (
                      <>
                        <span style={{ color: '#4caf50' }}>✓ Cloned</span>
                        {' | '}ID: {voice.qwen_voice_id || 'N/A'}
                        {' | '}Role: {voice.role}
                        {voice.cloned_at && ` | ${new Date(voice.cloned_at).toLocaleDateString()}`}
                      </>
                    ) : (
                      'Not cloned yet'
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {!voice.is_cloned && (
                  <button
                    onClick={() => handleRegisterClick(voice)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      background: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Clone
                  </button>
                )}
                <button
                  onClick={() => handleDelete(voice.id)}
                  style={{
                    padding: '6px 12px',
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
            </div>
          ))}
        </div>
      )}

      {/* 克隆注册对话框 */}
      {showRegisterDialog && selectedVoice && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'white',
            padding: '24px',
            borderRadius: '8px',
            width: '400px',
            maxWidth: '90%',
          }}>
            <h3 style={{ marginTop: 0 }}>Clone Voice</h3>
            <p style={{ color: '#666', fontSize: '14px' }}>
              Submit your audio to Qwen for voice cloning. This will create a persistent voice ID.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Voice Name:
              </label>
              <input
                type="text"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Role:
              </label>
              <select
                value={registerRole}
                onChange={(e) => setRegisterRole(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                }}
              >
                <option value="custom">Custom</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>

            {registerResult && (
              <div style={{ marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px', fontSize: '12px' }}>
                <div style={{ color: '#4caf50', fontWeight: '500', marginBottom: '8px' }}>✓ Clone Successful!</div>
                <div><strong>Voice ID:</strong> {registerResult.qwen_voice_id}</div>
                <div><strong>Role:</strong> {registerResult.role}</div>
                <div><strong>Cloned at:</strong> {registerResult.cloned_at ? new Date(registerResult.cloned_at).toLocaleString() : 'N/A'}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowRegisterDialog(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  background: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {registerResult ? 'Close' : 'Cancel'}
              </button>
              {!registerResult && (
                <button
                  onClick={handleRegister}
                  disabled={!!registeringId || !registerName.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    background: registeringId || !registerName.trim() ? '#ccc' : '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: registeringId || !registerName.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {registeringId ? 'Cloning...' : 'Clone'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}