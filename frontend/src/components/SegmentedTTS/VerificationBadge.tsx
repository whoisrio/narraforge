/**
 * 段级语音核对状态角标。
 *
 * 六态：⟳ 核对中（内存态，in-flight 派生）/ ✓ 一致 / ✗ 不一致 /
 * ⊘ 已忽略 / ！出错 / – 未核对（audio_key 不匹配时变体为「已过期」）。
 *
 * 双职责角标：未核对/已过期时点击直接发起核对（onVerify），
 * 已有结果时点击打开核对详情（onOpenDetail）——紧凑列表里不额外占一个按钮位。
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
  /** 未核对/已过期时点击直接发起核对；缺省时未核对点击回退为打开详情 */
  onVerify?: (segmentId: string) => void;
  /** 紧凑模式：只显示符号，完整状态放 tooltip（避免挤压行内文本布局） */
  compact?: boolean;
}

export function VerificationBadge({ segment, verifying, onOpenDetail, onVerify, compact }: VerificationBadgeProps) {
  const { t } = useTranslation();
  const view = resolveVerificationView(segment);

  let cls = styles.unverified;
  let symbol = '–';
  let label = t('ttsVerify.badge.unverified');
  let tooltip = t('ttsVerify.badge.unverifiedTooltip');

  if (verifying) {
    cls = styles.verifying;
    symbol = '⟳';
    label = t('ttsVerify.badge.verifying');
    tooltip = t('ttsVerify.badge.verifyingTooltip');
  } else if (view.state === 'match' && view.verification) {
    cls = styles.match;
    symbol = '✓';
    label = t('ttsVerify.badge.match');
    const pct = Math.round((view.verification.similarity ?? 1) * 100);
    tooltip = t('ttsVerify.badge.matchTooltip', { similarity: pct });
  } else if (view.state === 'mismatch' && view.verification) {
    cls = styles.mismatch;
    symbol = '✗';
    label = t('ttsVerify.badge.mismatch');
    const pct = Math.round((view.verification.similarity ?? 0) * 100);
    tooltip = t('ttsVerify.badge.mismatchTooltip', { similarity: pct });
  } else if (view.state === 'ignored' && view.verification) {
    cls = styles.ignored;
    symbol = '⊘';
    label = t('ttsVerify.badge.ignored');
    tooltip = t('ttsVerify.badge.ignoredTooltip');
  } else if (view.state === 'error' && view.verification) {
    cls = styles.error;
    symbol = '！';
    label = t('ttsVerify.badge.error');
    tooltip = t('ttsVerify.badge.errorTooltip', { error: view.verification.error || '' });
  } else if (view.stale) {
    // 存在旧核对结果但音频已重新生成：按未核对处理 + 已过期提示
    cls = styles.stale;
    label = t('ttsVerify.badge.stale');
    tooltip = t('ttsVerify.badge.staleTooltip');
  }

  // 未核对/已过期 + onVerify → 点击直接核对；核对中不重复触发
  const canTriggerVerify = !!onVerify && !verifying && view.state === 'unverified';
  if (canTriggerVerify) {
    tooltip = view.stale
      ? t('ttsVerify.badge.staleVerifyTooltip')
      : t('ttsVerify.badge.unverifiedVerifyTooltip');
  }

  const handleClick = () => {
    if (verifying) return; // in-flight：不重复触发也不开详情
    if (canTriggerVerify) onVerify?.(segment.id);
    else onOpenDetail?.(segment.id);
  };

  return (
    <button
      type="button"
      className={`${styles.badge} ${cls}`}
      title={tooltip}
      aria-label={compact ? tooltip : undefined}
      onClick={(e) => { e.stopPropagation(); handleClick(); }}
    >
      {compact ? symbol : `${symbol} ${label}`}
    </button>
  );
}
