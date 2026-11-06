import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="language-switcher">
      <Languages aria-hidden="true" size={18} />
      <span className="sr-only">{t('language.label')}</span>
      <select value={i18n.resolvedLanguage} onChange={event => void i18n.changeLanguage(event.target.value)}>
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
  );
}
