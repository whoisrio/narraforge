import { useState, useEffect } from 'react';
import { voiceApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
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

  // 删除确认弹窗状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // null 表示"全部删除"，string 表示删除单条
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 内联编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [editingError, setEditingError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const { refreshCounter, triggerRefresh } = useVoiceRefresh();

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
  }, [refreshCounter]);

  // 为什么用 Modal 而非 confirm()：
  // confirm() 的 UI 不可定制且在不同浏览器下表现不一致，Modal 可以统一风格并提供更清晰的操作提示
  const handleDeleteClick = (id: string) => {
    setDeleteTarget(id);
    setShowDeleteConfirm(true);
  };

  const handleClearAllClick = () => {
    setDeleteTarget(null); // null 表示全部删除
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      if (deleteTarget === null) {
        // 全部删除：逐个删除，某个失败也继续
        for (const voice of [...voices]) {
          try {
            await voiceApi.delete(voice.id);
          } catch (err) {
            console.error(`Failed to delete voice ${voice.id}:`, err);
          }
        }
        setVoices([]);
      } else {
        // 单条删除
        await voiceApi.delete(deleteTarget);
      }
      fetchVoices();
      triggerRefresh();
      onRefresh?.();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
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
      triggerRefresh();
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

  // 内联编辑：开始编辑声音描述
  const handleStartEdit = (voice: VoiceProfile) => {
    setEditingId(voice.id);
    setEditingDescription(voice.description || '');
    setEditingError('');  // 清除上次错误
  };

  // 内联编辑：取消编辑
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingDescription('');
    setEditingError('');
  };

  // 内联编辑：保存描述
  const handleSaveDescription = async (voiceId: string) => {
    const voice = voices.find(v => v.id === voiceId);
    if (!voice) return;
    // 值没变化则不请求
    if (editingDescription.trim() === (voice.description || '')) {
      setEditingId(null);
      return;
    }

    setSavingId(voiceId);
    try {
      await voiceApi.updateDescription(voiceId, editingDescription.trim());
      // 更新本地 state 避免重新请求
      setVoices(prev => prev.map(v =>
        v.id === voiceId ? { ...v, description: editingDescription.trim() || undefined } : v
      ));
      triggerRefresh(); // 通知 TTS 页面刷新声音列表
      setEditingId(null);
      setEditingError('');
    } catch (err: any) {
      // 409 表示描述重复，显示错误提示并保持编辑状态让用户修改
      if (err?.response?.status === 409) {
        setEditingError(err.response.data?.detail || '该描述已用于其他声音');
      } else {
        console.error('Failed to save description:', err);
        setEditingId(null);
      }
    } finally {
      setSavingId(null);
    }
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
    color: 'var(--color-text-primary)',
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
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncFromQwen}
            disabled={syncing}
            loading={syncing}
          >
            🔄 Sync from Qwen
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleClearAllClick}
            disabled={voices.length === 0}
          >
            🗑️ Clear All
          </Button>
        </div>
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
                    {editingId === voice.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="text"
                          value={editingDescription}
                          onChange={(e) => setEditingDescription(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveDescription(voice.id);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          disabled={savingId === voice.id}
                          autoFocus
                          style={{
                            padding: '2px 6px',
                            fontSize: 'var(--font-size-base)',
                            fontWeight: 'var(--font-weight-medium)',
                            border: '1px solid var(--color-primary)',
                            borderRadius: '4px',
                            width: '200px',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text-primary)',
                          }}
                        />
                        <Button variant="ghost" size="sm" onClick={() => handleSaveDescription(voice.id)} disabled={savingId === voice.id}>✓</Button>
                        <Button variant="ghost" size="sm" onClick={handleCancelEdit}>✕</Button>
                        {editingError && (
                          <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                            {editingError}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={voiceNameStyle}>
                          {voice.description || voice.qwen_voice_id || 'N/A'}
                        </div>
                        <span
                          onClick={() => handleStartEdit(voice)}
                          style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.6 }}
                          title="编辑描述"
                        >
                          ✏️
                        </span>
                      </div>
                    )}
                    <div style={voiceMetaStyle}>
                      {voice.is_cloned ? (
                        <>
                          <span style={{ color: 'var(--color-success)', marginRight: 'var(--spacing-xs)' }}>✓ Cloned</span>
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
                    onClick={() => handleDeleteClick(voice.id)}
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

      {/* 删除确认弹窗 — 为什么需要确认：删除会同时移除 Qwen 云端音色和本地数据，不可恢复 */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={handleCancelDelete}
        title="确认删除"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCancelDelete} disabled={deleting}>
              取消
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} loading={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </div>
        }
      >
        <p style={{ marginBottom: 'var(--spacing-sm)' }}>
          {deleteTarget === null
            ? '确定要删除所有克隆声音吗？'
            : `确定要删除声音 "${voices.find(v => v.id === deleteTarget)?.name || deleteTarget}" 吗？`}
        </p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          此操作会同步删除 Qwen 云端的音色数据，不可撤销。
        </p>
      </Modal>
    </div>
  );
}
