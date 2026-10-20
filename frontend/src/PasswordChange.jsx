import { navigate } from './navigation.js';
import { uiMessage, t, locale } from "./i18n.js";import React, { useState } from 'react';
import { api, logout } from './api.js';
import { ErrorMessage } from './Ui.jsx';

export function PasswordChange() {
  const [draft, setDraft] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [busy, setBusy] = useState(false),[error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();setError(null);
    if (draft.newPassword !== draft.repeat) {setError({ message: uiMessage("Новые пароли не совпадают") });return;}
    setBusy(true);
    try {await api('/me/password', { method: 'POST', body: { currentPassword: draft.currentPassword, newPassword: draft.newPassword } });await logout();navigate('/?passwordChanged=1');}
    catch (problem) {setError(problem);setBusy(false);}
  }
  return <section className="profile-card"><h2>{t("Смена пароля")}</h2><p className="profile-help">{t("После смены пароля потребуется войти заново на всех устройствах.")}</p><ErrorMessage error={error} /><form onSubmit={submit}><fieldset disabled={busy}>
    {[['currentPassword', t("Текущий пароль")], ['newPassword', t("Новый пароль")], ['repeat', t("Повторите новый пароль")]].map(([key, label]) => <div className="field" key={key}><label htmlFor={`password-${key}`}>{label}</label><input id={`password-${key}`} type="password" required minLength={key === 'currentPassword' ? 1 : 12} maxLength={128} autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></div>)}
    <p className="profile-help">{t("От 12 до 128 символов.")}</p><button>{busy ? t("Сохраняем…") : t("Изменить пароль")}</button></fieldset></form></section>;
}
