/**
 * 段级语音核对状态角标。
 *
 * 六态：⟳ 核对中（内存态，in-flight 派生）/ ✓ 一致 / ✗ 不一致 /
 * ⊘ 已忽略 / ！出错 / – 未核对（audio_key 不匹配时变体为「已过期」）。
 * 点击打开核对详情（由父级 onOpenDetail 决定）。
 */
import type { Segment } from '../../types';
import { resolveVerificationView } from '../../services/ttsVerify';
import { useTranslation } from '../../i18n';
import styles from './VerificationBadge.module.css';

interface VerificationBadgeProps {
  segment: Segment;
  /** 该段正在核对（页面由 in-flight 状态派生） */
  verifying?: boolean;
  onOpenDetail?: (segmentId: string) => void;
}

export function VerificationBadge({ segment, verifying, onOpenDetail }: VerificationBadgeProps) {
  const { t } = useTranslation();
  const view = resolveVerificationView(segment);

  let cls = styles.unverified;
  let label = t('ttsVerify.badge.unverified');
  let tooltip = t('ttsVerify.badge.unverifiedTooltip');

  if (verifying) {
    cls = styles.verifying;
    label = '⟳ ' + t('ttsVerify.badge.verifying');
    tooltip = t('ttsVerify.badge.verifyingTooltip');
  } else if (view.state === 'match' && view.verification) {
    cls = styles.match;
    label = '✓ ' + t('ttsVerify.badge.match');
    const pct = Math.round((view.verification.similarity ?? 1) * 100);
    tooltip = t('ttsVerify.badge.matchTooltip', { similarity: pct });
  } else if (view.state === 'mismatch' && view.verification) {
    cls = styles.mismatch;
    label = '✗ ' + t('ttsVerify.badge.mismatch');
    const pct = Math.round((view.verification.similarity ?? 0) * 100);
    tooltip = t('ttsVerify.badge.mismatchTooltip', { similarity: pct });
  } else if (view.state === 'ignored' && view.verification) {
    cls = styles.ignored;
    label = '⊘ ' + t('ttsVerify.badge.ignored');
    tooltip = t('ttsVerify.badge.ignoredTooltip');
  } else if (view.state === 'error' && view.verification) {
    cls = styles.error;
    label = '！ ' + t('ttsVerify.badge.error');
    tooltip = t('ttsVerify.badge.errorTooltip', { error: view.verification.error || '' });
  } else if (view.stale) {
    // 存在旧核对结果但音频已重新生成：按未核对处理 + 已过期提示
    cls = styles.stale;
    label = '– ' + t('ttsVerify.badge.stale');
    tooltip = t('ttsVerify.badge.staleTooltip');
  }

  return (
    <button
      type="button"
      className={`${styles.badge} ${cls}`}
      title={tooltip}
      onClick={(e) => { e.stopPropagation(); onOpenDetail?.(segment.id); }}
    >
      {label}
    </button>
  );
}
