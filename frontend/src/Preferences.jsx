import React, { useSyncExternalStore } from 'react';
import { t } from './i18n.js';
import { getPreferencesSnapshot, subscribePreferences, setLanguage, setTheme } from './preferences.js';

export function usePreferences() {
  const snapshot = useSyncExternalStore(subscribePreferences, getPreferencesSnapshot);
  const [language, theme] = snapshot.split(':');
  return { language, theme };
}

export function Preferences() {
  const { language, theme } = usePreferences();
  return <div className="preferences">
    <label htmlFor="interface-language">{t('Язык интерфейса')}
      <select id="interface-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
        <option value="ru">{t('Русский')}</option><option value="en">English</option>
      </select>
    </label>
    <button type="button" className="secondary" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? t('Светлая тема') : t('Тёмная тема')}
    </button>
  </div>;
}
