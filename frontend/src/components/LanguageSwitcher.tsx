import { useTranslation } from '../i18n';
import type { Locale } from '../i18n';
import styles from './LanguageSwitcher.module.css';

const localeFlags: Record<Locale, string> = {
  'zh-CN': '🇨🇳',
  'en-US': '🇺🇸',
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();
  
  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        title="Switch language / 切换语言"
      >
        {(['zh-CN', 'en-US'] as Locale[]).map((loc) => (
          <option key={loc} value={loc}>
            {localeFlags[loc]} {loc === 'zh-CN' ? '中文' : 'English'}
          </option>
        ))}
      </select>
    </div>
  );
}
