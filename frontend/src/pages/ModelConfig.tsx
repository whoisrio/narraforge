import { useState, useEffect, useCallback } from 'react';
import { modelConfigApi } from '../services/api';
import type { ModelConfigs, ModelConfigFieldValue } from '../types';
import { useTranslation } from '../i18n';
import styles from './ModelConfig.module.css';

/** 每个 provider 对应的图标文件名（放在 frontend/public/ 下） */
const PROVIDER_ICONS: Record<string, string> = {
  qwen_tts: 'qwen-ai-logo.png',
  mimo_tts: 'mi-co-id-logo.png',
  llm: 'model.png',
};

/** 单个提供商的编辑状态 */
interface ProviderEditState {
  expanded: boolean;
  fields: Record<string, string>;
  modified: Set<string>;
  saving: boolean;
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  qwen_tts: '阿里云 DashScope 语音合成，支持 CosyVoice 高质量克隆与 Qwen TTS',
  mimo_tts: '小米 MiMo 语音合成服务，支持多语言高质量 TTS',
  llm: 'LLM 字幕模型，用于智能文本分段与情感分析',
};

export function ModelConfig() {
  const [configs, setConfigs] = useState<ModelConfigs | null>(null);
  const [editStates, setEditStates] = useState<Record<string, ProviderEditState>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { t } = useTranslation();

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 加载配置
  useEffect(() => {
    modelConfigApi.getAll().then(data => {
      setConfigs(data);
      const states: Record<string, ProviderEditState> = {};
      for (const [provider, providerData] of Object.entries(data)) {
        const fields: Record<string, string> = {};
        for (const [fieldKey, fieldVal] of Object.entries(providerData.fields)) {
          fields[fieldKey] = fieldVal.value === '********' ? '' : fieldVal.value;
        }
        states[provider] = {
          expanded: false,
          fields,
          modified: new Set(),
          saving: false,
        };
      }
      setEditStates(states);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
      showToast(t('modelConfig.loadFailed'), 'error');
    });
  }, [t, showToast]);

  const toggleExpand = useCallback((provider: string) => {
    setEditStates(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        expanded: !prev[provider].expanded,
      },
    }));
  }, []);

  const handleFieldChange = useCallback((provider: string, field: string, value: string) => {
    setEditStates(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        fields: { ...prev[provider].fields, [field]: value },
        modified: new Set(prev[provider].modified).add(field),
      },
    }));
  }, []);

  const handleSave = useCallback(async (provider: string) => {
    const state = editStates[provider];
    if (!state || state.modified.size === 0 || !configs) return;

    setEditStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], saving: true },
    }));

    try {
      const updates: Record<string, string> = {};
      for (const field of state.modified) {
        updates[field] = state.fields[field];
      }

      const sensitiveFieldKeys = new Set<string>();
      const providerFields = configs[provider]?.fields;
      if (providerFields) {
        for (const [k, v] of Object.entries(providerFields)) {
          if (v.sensitive) sensitiveFieldKeys.add(k);
        }
      }

      await modelConfigApi.update(provider, updates, sensitiveFieldKeys);

      setEditStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], saving: false, modified: new Set() },
      }));

      const freshConfigs = await modelConfigApi.getAll();
      setConfigs(freshConfigs);
      const fields: Record<string, string> = {};
      for (const [fieldKey, fieldVal] of Object.entries(freshConfigs[provider].fields)) {
        fields[fieldKey] = fieldVal.value === '********' ? '' : fieldVal.value;
      }
      setEditStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], fields },
      }));

      showToast(t('modelConfig.configLoaded'), 'success');
    } catch {
      setEditStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], saving: false },
      }));
      showToast(t('modelConfig.saveFailed'), 'error');
    }
  }, [editStates, configs, showToast, t]);

  const handleReset = useCallback((provider: string) => {
    if (!configs) return;
    const providerData = configs[provider];
    const fields: Record<string, string> = {};
    for (const [fieldKey, fieldVal] of Object.entries(providerData.fields)) {
      fields[fieldKey] = fieldVal.value === '********' ? '' : fieldVal.value;
    }
    setEditStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], fields, modified: new Set() },
    }));
  }, [configs]);

  if (loading) {
    return <div className={styles.loading}>{t('modelConfig.loading')}</div>;
  }

  if (!configs) {
    return <div className={styles.loading}>{t('modelConfig.loadFailed')}</div>;
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('modelConfig.title')}</h1>
        <p className={styles.pageDesc}>
          {t('modelConfig.description')}
        </p>
      </div>

      {/* Provider Cards */}
      <div className={styles.providerList}>
        {Object.entries(configs).map(([providerKey, provider]) => {
          const state = editStates[providerKey];
          if (!state) return null;

          const allConfigured = Object.values(provider.fields).every(f => f.has_value);
          const anyEnvDefault = Object.values(provider.fields).some(f => f.has_env_default && !f.value);
          const hasModified = state.modified.size > 0;

          let statusLabel = t('modelConfig.status.notConfigured');
          let statusClass = styles.configured;
          if (allConfigured) {
            statusLabel = t('modelConfig.status.configured');
            statusClass = styles.configured;
          } else if (anyEnvDefault) {
            statusLabel = t('modelConfig.status.usingDefault');
            statusClass = styles.envDefault;
          } else {
            statusLabel = t('modelConfig.status.notConfigured');
            statusClass = styles.notConfigured;
          }

          return (
            <div key={providerKey} className={styles.providerCard}>
              <div
                className={styles.providerHeader}
                onClick={() => toggleExpand(providerKey)}
              >
                <div className={styles.providerIconWrap}>
                  {PROVIDER_ICONS[providerKey] ? (
                    <img
                      src={`/${PROVIDER_ICONS[providerKey]}`}
                      alt={provider.label}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className={styles.providerIconFallback}>{provider.icon}</span>
                  )}
                </div>
                <div className={styles.providerMeta}>
                  <div className={styles.providerName}>{provider.label}</div>
                  <div className={styles.providerDesc}>
                    {PROVIDER_DESCRIPTIONS[providerKey] ?? ''}
                  </div>
                </div>
                <span className={`${styles.statusBadge} ${statusClass}`}>
                  {statusLabel}
                </span>
                <svg
                  className={`${styles.expandChevron} ${state.expanded ? styles.expanded : ''}`}
                  width="18" height="18" viewBox="0 0 16 16" fill="none"
                >
                  <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              {state.expanded && (
                <div className={styles.providerBody}>
                  {Object.entries(provider.fields).map(([fieldKey, fieldMeta]) => (
                    <ConfigField
                      key={fieldKey}
                      meta={fieldMeta}
                      value={state.fields[fieldKey] ?? ''}
                      modified={state.modified.has(fieldKey)}
                      onChange={(v) => handleFieldChange(providerKey, fieldKey, v)}
                    />
                  ))}

                  <div className={styles.actionBar}>
                    <button
                      className={`${styles.btn} ${styles.btnGhost}`}
                      onClick={() => handleReset(providerKey)}
                      disabled={!hasModified}
                    >
                      {t('modelConfig.reset')}
                    </button>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => handleSave(providerKey)}
                      disabled={state.saving || !hasModified}
                    >
                      {state.saving ? t('modelConfig.saving') : t('modelConfig.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

/** 单个配置字段渲染 */
function ConfigField({
  meta,
  value,
  modified,
  onChange,
}: {
  meta: ModelConfigFieldValue;
  value: string;
  modified: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = meta.sensitive;
  const hasValue = value.length > 0;

  const placeholder = meta.has_env_default
    ? t('modelConfig.placeholder')
    : '';

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldHeader}>
        <span className={styles.fieldLabel}>{meta.label}</span>
        {modified && <span className={styles.fieldModified}>{t('modelConfig.modified')}</span>}
      </div>
      {meta.description && (
        <div className={styles.fieldDesc}>{meta.description}</div>
      )}
      <div className={`${styles.fieldInputWrapper} ${hasValue ? styles.hasValue : ''}`}>
        <input
          className={styles.fieldInput}
          type={isPassword && !showPassword ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          data-1p-ignore
        />
        {isPassword && (
          <button
            className={styles.passwordToggle}
            onClick={() => setShowPassword(!showPassword)}
            type="button"
          >
            {showPassword ? '隐藏' : '显示'}
          </button>
        )}
      </div>
    </div>
  );
}
