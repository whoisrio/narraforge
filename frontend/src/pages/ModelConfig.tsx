import { useState, useEffect, useCallback } from 'react';
import { modelConfigApi } from '../services/api';
import type { ModelConfigs, ModelConfigFieldValue } from '../types';
import styles from './ModelConfig.module.css';

/** 单个提供商的编辑状态 */
interface ProviderEditState {
  expanded: boolean;
  fields: Record<string, string>;   // 字段名 → 当前输入值
  modified: Set<string>;            // 被修改过的字段
  saving: boolean;
}

export function ModelConfig() {
  const [configs, setConfigs] = useState<ModelConfigs | null>(null);
  const [editStates, setEditStates] = useState<Record<string, ProviderEditState>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 加载配置
  useEffect(() => {
    modelConfigApi.getAll().then(data => {
      setConfigs(data);
      // 初始化编辑状态
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
      showToast('加载配置失败', 'error');
    });
  }, []);

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
      // 只提交被修改的字段
      const updates: Record<string, string> = {};
      for (const field of state.modified) {
        updates[field] = state.fields[field];
      }

      // 收集该提供商的敏感字段名集合，供 API 层加密传输
      const sensitiveFieldKeys = new Set<string>();
      const providerFields = configs[provider]?.fields;
      if (providerFields) {
        for (const [k, v] of Object.entries(providerFields)) {
          if (v.sensitive) sensitiveFieldKeys.add(k);
        }
      }

      await modelConfigApi.update(provider, updates, sensitiveFieldKeys);

      // 更新本地状态：清空 modified，更新 configs 中的值
      setEditStates(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          saving: false,
          modified: new Set(),
        },
      }));

      // 重新加载配置以获取最新状态
      const freshConfigs = await modelConfigApi.getAll();
      setConfigs(freshConfigs);
      // 更新 fields 中的值（清除已输入的密码等）
      const fields: Record<string, string> = {};
      for (const [fieldKey, fieldVal] of Object.entries(freshConfigs[provider].fields)) {
        fields[fieldKey] = fieldVal.value === '********' ? '' : fieldVal.value;
      }
      setEditStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], fields },
      }));

      showToast('配置已保存', 'success');
    } catch {
      setEditStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], saving: false },
      }));
      showToast('保存失败', 'error');
    }
  }, [editStates, configs, showToast]);

  const handleReset = useCallback((provider: string) => {
    if (!configs) return;
    const providerData = configs[provider];
    const fields: Record<string, string> = {};
    for (const [fieldKey, fieldVal] of Object.entries(providerData.fields)) {
      fields[fieldKey] = fieldVal.value === '********' ? '' : fieldVal.value;
    }
    setEditStates(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        fields,
        modified: new Set(),
      },
    }));
  }, [configs]);

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (!configs) {
    return <div className={styles.loading}>配置加载失败</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>模型配置</h1>
        <p>管理各模型提供商的连接配置，界面设置优先，未配置时自动使用环境变量默认值</p>
      </div>

      <div className={styles.providerList}>
        {Object.entries(configs).map(([providerKey, provider]) => {
          const state = editStates[providerKey];
          if (!state) return null;

          const allConfigured = Object.values(provider.fields).every(f => f.has_value);
          const anyEnvDefault = Object.values(provider.fields).some(f => f.has_env_default && !f.value);
          const hasModified = state.modified.size > 0;

          return (
            <div key={providerKey} className={styles.providerCard}>
              <div
                className={styles.providerHeader}
                onClick={() => toggleExpand(providerKey)}
              >
                <span className={styles.providerIcon}>{provider.icon}</span>
                <div className={styles.providerInfo}>
                  <div className={styles.providerName}>{provider.label}</div>
                  <div className={styles.providerStatus}>
                    {allConfigured ? (
                      <span className={`${styles.statusBadge} ${styles.configured}`}>已配置</span>
                    ) : anyEnvDefault ? (
                      <span className={`${styles.statusBadge} ${styles.envDefault}`}>使用默认值</span>
                    ) : (
                      <span className={`${styles.statusBadge} ${styles.notConfigured}`}>未配置</span>
                    )}
                  </div>
                </div>
                <svg
                  className={`${styles.expandIcon} ${state.expanded ? styles.expanded : ''}`}
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
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

                  <div className={styles.saveRow}>
                    <button
                      className={`${styles.saveButton} ${styles.ghost}`}
                      onClick={() => handleReset(providerKey)}
                      disabled={!hasModified}
                    >
                      重置
                    </button>
                    <button
                      className={`${styles.saveButton} ${styles.primary}`}
                      onClick={() => handleSave(providerKey)}
                      disabled={state.saving || !hasModified}
                    >
                      {state.saving ? '保存中...' : '保存'}
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
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = meta.sensitive;

  const placeholder = meta.has_env_default
    ? '留空使用环境变量默认值'
    : '';

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldLabel}>
        <span>{meta.label}{modified ? ' *' : ''}</span>
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
      {meta.description && (
        <div className={styles.fieldDesc}>{meta.description}</div>
      )}
      <input
        className={styles.fieldInput}
        type={isPassword && !showPassword ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
      />
    </div>
  );
}
