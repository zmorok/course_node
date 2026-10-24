import React, { useSyncExternalStore } from 'react';
import { t } from './i18n.js';
import { getPreferencesSnapshot, subscribePreferences, setLanguage, setTheme } from './preferences.js';
import { Icon } from './Icon.jsx';

export function usePreferences() {
  const snapshot = useSyncExternalStore(subscribePreferences, getPreferencesSnapshot);
  const [language, theme] = snapshot.split(':');
  return { language, theme };
}

export function Preferences() {
  const { language, theme } = usePreferences();
  return <div className="preferences">
    <label htmlFor="interface-language"><span className="sr-only">{t('Язык интерфейса')}</span>
      <select id="interface-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
        <option value="ru">RU</option><option value="en">EN</option>
      </select>
    </label>
    <button type="button" className="icon-button" aria-label={theme === 'dark' ? t('Светлая тема') : t('Тёмная тема')} title={theme === 'dark' ? t('Светлая тема') : t('Тёмная тема')} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  </div>;
}
