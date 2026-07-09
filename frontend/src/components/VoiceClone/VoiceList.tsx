import { useState, useEffect } from 'react';
import { voiceApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../../types';
import { voicePreviewAudioUrl } from '../../types';
import { Button, Modal, Input, Select, Loading, EmptyState, Card, Alert } from '../ui';

interface VoiceListProps {
  /** 当前选择的复刻引擎，控制 UI 呈现 */
  engine?: 'qwen' | 'mimo' | 'voxcpm';
  onRefresh?: () => void;
}

function getErrorDetail(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return fallback;
}

export function VoiceList({ engine = 'qwen', onRefresh }: VoiceListProps) {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceProfile | null>(null);
  const [registerName, setRegisterName] = useState('');
  const [registerRole, setRegisterRole] = useState('custom');
  const [registerResult, setRegisterResult] = useState<VoiceProfile | null>(null);
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
      const all = await voiceApi.list();
      // 根据引擎筛选已克隆的声音
      const cloned = all.filter(v => {
        if (v.voice?.voice_type !== 'clone') return false;
        if (engine === 'mimo') return v.voice?.model === 'mimo_tts';
        if (engine === 'voxcpm') return v.voice?.model === 'voxcpm';
        return v.voice?.model === 'cosyvoice' || (!v.voice?.model && (v.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id);
      });
      setVoices(cloned);
    } catch (err) {
      console.error('Failed to fetch voices:', err);
    } finally {
      setLoading(false);
    }
  };

  // 引擎切换时重新拉取
  useEffect(() => {
    setLoading(true);
    fetchVoices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, refreshCounter]);

  const handleSyncFromQwen = async () => {
    setSyncing(true);
    try {
      const result = await voiceApi.syncFromQwen();
      setSyncMessage({ type: 'success', text: result.message });
      fetchVoices();
      onRefresh?.();
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncMessage({ type: 'error', text: t('voiceList.syncFailed') });
    } finally {
      setSyncing(false);
    }
  };

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
      alert(t('voiceList.registrationFailed'));
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
    } catch (err: unknown) {
      // 409 表示描述重复，显示错误提示并保持编辑状态让用户修改
      const response = typeof err === 'object' && err !== null
        ? (err as { response?: { status?: number; data?: { detail?: unknown } } }).response
        : undefined;
      if (response?.status === 409) {
        setEditingError(getErrorDetail(err, t('voiceList.duplicateDescription')));
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

  const engineBadgeStyle = (eng?: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    background: eng === 'mimo' ? 'var(--color-primary-light, #e3f2fd)' : eng === 'voxcpm' ? '#fff3e0' : 'var(--color-success-light, #e8f5e9)',
    color: eng === 'mimo' ? 'var(--color-primary, #1976d2)' : eng === 'voxcpm' ? '#e65100' : 'var(--color-success, #2e7d32)',
    marginLeft: '6px',
  });

  if (loading) {
    return <Loading message={t('voiceList.loading')} />;
  }

  return (
    <div>
      <div style={headerStyle}>
        <h3 style={h3Style}>
          🎤 {engine === 'mimo' ? t('voiceList.titleMiMo') : engine === 'voxcpm' ? t('voiceList.titleVoxCPM') : t('voiceList.titleCosyVoice')}
        </h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          {/* Sync from Qwen 仅在 CosyVoice 模式下显示 */}
          {engine === 'qwen' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSyncFromQwen}
              disabled={syncing}
              loading={syncing}
            >
              {t('voiceList.syncFromQwen')}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={handleClearAllClick}
            disabled={voices.length === 0}
          >
            {t('voiceList.clearAll')}
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
          title={t('voiceList.noVoicesYet')}
          description={
            engine === 'mimo'
              ? t('voiceList.emptyDescMiMo')
              : t('voiceList.emptyDescDefault')
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          {voices.map((voice) => (
            <Card key={voice.id} style={voiceCardStyle}>
              <div style={voiceContentStyle}>
                <div style={voiceInfoStyle}>
                  <audio src={voicePreviewAudioUrl(voice.id)} controls style={{ height: '32px' }} />
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
                          {voice.name || ((voice.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string) || 'N/A'}
                        </div>
                        {voice.voice?.model && (
                          <span style={engineBadgeStyle(voice.voice.model)}>
                            {voice.voice?.model === 'mimo_tts' ? 'MiMo' : voice.voice?.model === 'voxcpm' ? 'VoxCPM' : 'Qwen'}
                          </span>
                        )}
                        <span
                          onClick={() => handleStartEdit(voice)}
                          style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.6 }}
                          title={t('voiceList.editDescription')}
                        >
                          ✏️
                        </span>
                      </div>
                    )}
                    <div style={voiceMetaStyle}>
                      {voice.voice?.voice_type === 'clone' ? (
                        <>
                          <span style={{ color: 'var(--color-success)', marginRight: 'var(--spacing-xs)' }}>✓ {t('voiceList.clonedBadge')}</span>
                          {voice.voice?.model === 'mimo_tts' && ` | ${t('voiceList.miMoInstantClone')}`}
                          {voice.created_at && ` | ${new Date(voice.created_at).toLocaleDateString()}`}
                        </>
                      ) : (
                        t('voiceList.notClonedYet')
                      )}
                    </div>
                  </div>
                </div>
                <div style={actionButtonsStyle}>
                  {voice.voice?.voice_type !== 'clone' && voice.voice?.model !== 'mimo_tts' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRegisterClick(voice)}
                    >
                      {t('voiceList.clone')}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteClick(voice.id)}
                  >
                    {t('voiceList.delete')}
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
        title={t('voiceList.cloneVoice')}
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCloseModal}>
              {registerResult ? t('voiceList.close') : t('common.cancel')}
            </Button>
            {!registerResult && (
              <Button
                variant="primary"
                onClick={handleRegister}
                loading={!!registeringId}
                disabled={!registerName.trim()}
              >
                {registeringId ? t('voiceList.cloning') : t('voiceList.clone')}
              </Button>
            )}
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-lg)' }}>
          {t('voiceList.cloneDescription')}
        </p>

        <Input
          label={t('voiceList.voiceName')}
          type="text"
          value={registerName}
          onChange={(e) => setRegisterName(e.target.value)}
          style={{ marginBottom: 'var(--spacing-md)' }}
        />

        <Select
          label={t('voiceList.role')}
          options={[
            { value: 'custom', label: t('voiceList.roleCustom') },
            { value: 'male', label: t('voiceList.roleMale') },
            { value: 'female', label: t('voiceList.roleFemale') },
          ]}
          value={registerRole}
          onChange={(e) => setRegisterRole(e.target.value as string)}
        />

        {registerResult && (
          <Alert variant="success" style={{ marginTop: 'var(--spacing-md)' }}>
            <div style={{ fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--spacing-xs)' }}>{t('voiceList.cloneSuccess')}</div>
            <div><strong>{t('voiceList.voiceId')}</strong> {registerResult.id}</div>
            <div><strong>{t('voiceList.model')}</strong> {registerResult.voice?.model || 'N/A'}</div>
            <div><strong>{t('voiceList.createdAt')}</strong> {new Date(registerResult.created_at).toLocaleString()}</div>
          </Alert>
        )}
      </Modal>

      {/* 删除确认弹窗 — 为什么需要确认：删除会同时移除云端音色和本地数据，不可恢复 */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={handleCancelDelete}
        title={t('voiceList.confirmDelete')}
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCancelDelete} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} loading={deleting}>
              {deleting ? t('voiceList.deleting') : t('voiceList.confirmDelete')}
            </Button>
          </div>
        }
      >
        <p style={{ marginBottom: 'var(--spacing-sm)' }}>
          {deleteTarget === null
            ? t('voiceList.confirmDeleteAll', { engine: engine === 'mimo' ? 'MiMo' : 'CosyVoice' })
            : t('voiceList.confirmDeleteSingle', { name: voices.find(v => v.id === deleteTarget)?.name || deleteTarget })}
        </p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          {t('voiceList.deleteWarning')}
        </p>
      </Modal>
    </div>
  );
}
