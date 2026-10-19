import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import {InvitationComposer} from './InvitationPages.jsx';
import { AvatarEditor,PortfolioPanel } from './PortfolioPanel.jsx';
import {PublicReviews} from './Reviews.jsx';

const fieldDefinitions = [
  ['firstName', 'Имя', 100, 'text', 'given-name'], ['lastName', 'Фамилия', 100, 'text', 'family-name'],
  ['username', 'Имя пользователя', 40, 'text', 'username'], ['email', 'Email', 254, 'email', 'email'],
  ['headline', 'Специализация', 200], ['phone', 'Телефон', 30, 'tel', 'tel'],
  ['city', 'Город', 100, 'text', 'address-level2'], ['country', 'Страна', 100, 'text', 'country-name'],
  ['description', 'О себе', 5000],
];
const asForm = profile => Object.fromEntries(fieldDefinitions.map(([name]) => [name, profile[name] ?? '']));
const sameIds = (left, right) => left.length === right.length && left.every(id => right.includes(id));

function ProfileIdentity({ profile, children }) {
  return <>
    <div className="profile-avatar" aria-hidden="true">{profile.avatarFileId?<img src={`/api/files/${profile.avatarFileId}`} alt=""/>:<>{profile.firstName.slice(0, 1)}{profile.lastName.slice(0, 1)}</>}</div>
    <h2>{profile.firstName} {profile.lastName}</h2>
    <p className="profile-handle">@{profile.username}</p>
    {profile.headline && <p className="profile-headline">{profile.headline}</p>}
    {(profile.city || profile.country) && <p className="profile-location">{[profile.city, profile.country].filter(Boolean).join(', ')}</p>}
    {children}
  </>;
}
function Problems({ problem }) {
  return problem ? <div className="form-error" role="alert">{problem.message}</div> : null;
}
function FieldProblem({ problem, name }) {
  const issue = problem?.details?.find(item => item.field === `body.${name}`);
  return issue ? <small className="field-error" id={`profile-${name}-error`}>{issue.message}</small> : null;
}

export function ProfilePage({ user, onUserChange }) {
  const [profile, setProfile] = useState(null), [catalog, setCatalog] = useState([]);
  const [draft, setDraft] = useState({}), [selected, setSelected] = useState([]), [savedIds, setSavedIds] = useState([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(null), [attempt, setAttempt] = useState(0);
  const [profileError, setProfileError] = useState(null), [skillsError, setSkillsError] = useState(null);
  const [message, setMessage] = useState(''), [skillsMessage, setSkillsMessage] = useState('');
  const [saving, setSaving] = useState(false), [savingSkills, setSavingSkills] = useState(false), [search, setSearch] = useState('');
  const isClient = user.role === 'CLIENT';
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(null);
    Promise.all([api('/me/profile'), isClient ? api('/skills') : Promise.resolve({ skills: [] })]).then(([data, reference]) => {
      if (!active) return;
      setProfile(data.profile); setDraft(asForm(data.profile)); setCatalog(reference.skills);
      const ids = data.profile.skills.map(skill => skill.id);
      setSelected(ids); setSavedIds(ids);
    }).catch(error => { if (active) setLoadError(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id, isClient, attempt]);

  if (loading) return <div className="profile-card" role="status">Загружаем профиль…</div>;
  if (loadError) return <section className="profile-card"><h1>Не удалось открыть профиль</h1><Problems problem={loadError} /><button onClick={() => setAttempt(value => value + 1)}>Повторить</button></section>;
  const original = asForm(profile);
  const dirty = fieldDefinitions.some(([name]) => draft[name] !== original[name]);
  const skillsDirty = !sameIds(selected, savedIds);
  const emailChanged = draft.email.toLowerCase().trim() !== profile.email.toLowerCase();
  const busy = saving || savingSkills;
  const filtered = catalog.filter(skill => `${skill.name} ${skill.slug}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const fieldHasProblem = name => Boolean(profileError?.details?.some(item => item.field === `body.${name}`));
  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setProfileError(null); setMessage('');
    const body = Object.fromEntries(fieldDefinitions.filter(([name]) => draft[name] !== original[name]).map(([name]) => [name, draft[name]]));
    if (emailChanged) body.currentPassword = currentPassword;
    try {
      const result = await api('/me/profile', { method: 'PATCH', body });
      setProfile(result.profile); setDraft(asForm(result.profile)); setCurrentPassword(''); setMessage('Профиль сохранён');
      onUserChange({ ...user, email: result.profile.email, username: result.profile.username,
        firstName: result.profile.firstName, lastName: result.profile.lastName });
    } catch (error) { setProfileError(error); }
    finally { setSaving(false); }
  }
  async function saveSkills(event) {
    event.preventDefault(); setSavingSkills(true); setSkillsError(null); setSkillsMessage('');
    try {
      const result = await api('/me/skills', { method: 'PUT', body: { skillIds: selected } });
      const ids = result.profile.skills.map(skill => skill.id);
      setSelected(ids); setSavedIds(ids); setProfile(previous => ({ ...previous, skills: result.profile.skills }));
      setSkillsMessage('Навыки сохранены');
    } catch (error) { setSkillsError(error); }
    finally { setSavingSkills(false); }
  }
  return <>
    <div className="profile-page-heading"><div><p className="eyebrow">Ваше рабочее пространство</p><h1>{isClient ? 'Мой профиль' : 'Профиль аккаунта'}</h1>
      <p className="profile-subtitle">{isClient ? 'Расскажите о себе и выберите навыки для будущих проектов.' : 'Ваши персональные и контактные данные.'}</p></div>
      <a className="text-link" href="/">← К аккаунту</a></div>
    <div className="profile-layout">
      <div className="profile-editor">
        <section className="profile-card" aria-labelledby="profile-data-title">
          <h2 id="profile-data-title">Личные данные</h2><p className="profile-help">Email и телефон видны только вам. Для смены email потребуется текущий пароль.</p>
          <Problems problem={profileError} />
          <form onSubmit={saveProfile}>
            <fieldset disabled={busy}><div className="profile-fields">
              {fieldDefinitions.map(([name, label, max, type = 'text', complete]) => <div className={`field profile-field-${name}`} key={name}>
                <label htmlFor={`profile-${name}`}>{label}</label>
                {name === 'description' ? <textarea id={`profile-${name}`} name={name} rows={5} maxLength={max} value={draft[name]}
                  aria-invalid={fieldHasProblem(name)} aria-describedby={fieldHasProblem(name) ? `profile-${name}-error` : undefined}
                  onChange={event => { setDraft(previous => ({ ...previous, [name]: event.target.value })); setMessage(''); }} />
                  : <input id={`profile-${name}`} name={name} type={type} maxLength={max} autoComplete={complete}
                    required={['firstName', 'lastName', 'username', 'email'].includes(name)} minLength={name === 'username' ? 3 : undefined}
                    pattern={name === 'username' ? '[A-Za-z0-9_]{3,40}' : undefined} value={draft[name]}
                    aria-invalid={fieldHasProblem(name)} aria-describedby={fieldHasProblem(name) ? `profile-${name}-error` : undefined}
                    onChange={event => { setDraft(previous => ({ ...previous, [name]: event.target.value })); setMessage(''); }} />}
                {name === 'username' && <small>3–40 символов: латиница, цифры и _</small>}
                {name === 'description' && <small>{draft.description.length} / 5000 символов</small>}
                <FieldProblem problem={profileError} name={name} />
              </div>)}
              {emailChanged && <div className="field profile-field-currentPassword"><label htmlFor="profile-currentPassword">Текущий пароль для смены email</label>
                <input id="profile-currentPassword" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required
                  value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} aria-invalid={fieldHasProblem('currentPassword')}
                  aria-describedby={fieldHasProblem('currentPassword') ? 'profile-currentPassword-error' : undefined} />
                <FieldProblem problem={profileError} name="currentPassword" /></div>}
            </div><div className="profile-form-actions">
              <button type="submit" disabled={!dirty}>{saving ? 'Сохраняем…' : 'Сохранить профиль'}</button>
              <button type="button" className="secondary" disabled={!dirty} onClick={() => { setDraft(original); setCurrentPassword(''); setProfileError(null); setMessage(''); }}>Отменить изменения</button>
            </div></fieldset>
          </form><p className="save-message" role="status">{message}</p>
        </section>
        {isClient && <section className="profile-card" aria-labelledby="profile-skills-title">
          <div className="skills-heading"><div><h2 id="profile-skills-title">Навыки</h2><p className="profile-help">Выберите технологии, с которыми вы работаете.</p></div><span className="skills-count">{selected.length} / 50</span></div>
          <Problems problem={skillsError} /><form onSubmit={saveSkills}><fieldset disabled={busy}>
            <div className="field skill-search"><label htmlFor="skill-search">Найти навык</label><input id="skill-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>
            <div className="skill-options">{filtered.map(skill => <label className={selected.includes(skill.id) ? 'skill-option selected' : 'skill-option'} key={skill.id}>
              <input type="checkbox" checked={selected.includes(skill.id)} disabled={selected.length >= 50 && !selected.includes(skill.id)}
                onChange={event => { const checked = event.target.checked; setSelected(previous => checked ? [...previous, skill.id] : previous.filter(id => id !== skill.id)); setSkillsMessage(''); }} />{skill.name}</label>)}</div>
            {!filtered.length && <p className="profile-help">Навыки не найдены. Попробуйте другое название.</p>}
            <div className="profile-form-actions"><button type="submit" disabled={!skillsDirty}>{savingSkills ? 'Сохраняем…' : 'Сохранить навыки'}</button>
              <button type="button" className="secondary" disabled={!skillsDirty} onClick={() => { setSelected(savedIds); setSkillsError(null); setSkillsMessage(''); }}>Отменить выбор</button></div>
          </fieldset></form><p className="save-message" role="status">{skillsMessage}</p>
        </section>}
        {isClient&&<PortfolioPanel userId={user.id} editable/>}
      </div>
      <aside className="profile-card profile-summary" aria-label="Сохранённые данные профиля">
        <ProfileIdentity profile={profile}><span className="role-badge">{isClient ? 'Клиент' : 'Администратор'}</span></ProfileIdentity>
        {isClient&&<AvatarEditor fileId={profile.avatarFileId} onChange={avatarFileId=>setProfile(previous=>({...previous,avatarFileId}))}/>}
        {isClient && <><div className="profile-tags">{profile.skills.map(skill => <span key={skill.id}>{skill.name}</span>)}</div>
          <a className="profile-public-link text-link" href={`/users/${user.id}`} target="_blank" rel="noopener noreferrer">Открыть публичный профиль ↗</a>
          <p className="profile-help">Так ваши сохранённые данные увидят другие пользователи.</p></>}
      </aside>
    </div>
  </>;
}

export function PublicProfilePage({ userId,user }) {
  const [profile, setProfile] = useState(null), [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setProfile(null); setError(null);
    api(`/users/${encodeURIComponent(userId)}`).then(data => { if (active) setProfile(data.profile); }).catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [userId, attempt]);
  if (error) return <section className="profile-card"><h1>Не удалось открыть профиль</h1><Problems problem={error} />
    {error.status !== 404 && <button onClick={() => setAttempt(value => value + 1)}>Повторить</button>}<a className="text-link" href="/">На главную</a></section>;
  if (!profile) return <div className="profile-card" role="status">Загружаем профиль…</div>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">Люди Workify</p><h1>Профиль клиента</h1></div><a className="text-link" href="/">← На главную</a></div>
    <div className="public-profile-layout"><section className="profile-card public-profile-identity"><ProfileIdentity profile={profile} />
      <div className="profile-ratings"><div><strong>{profile.customerRating ?? '—'}</strong><span>Как заказчик</span><small>Отзывов: {profile.customerReviewCount}</small></div>
        <div><strong>{profile.freelancerRating ?? '—'}</strong><span>Как исполнитель</span><small>Отзывов: {profile.freelancerReviewCount}</small></div></div></section>
      <div className="profile-editor"><section className="profile-card"><h2>О себе</h2><p className="public-description">{profile.description || 'Пользователь пока не добавил описание.'}</p></section>
        <section className="profile-card"><h2>Навыки</h2>{profile.skills.length ? <div className="profile-tags">{profile.skills.map(skill => <span key={skill.id}>{skill.name}</span>)}</div> : <p className="profile-help">Навыки пока не указаны.</p>}</section><PublicReviews key={userId} userId={userId}/><InvitationComposer key={`${profile.id}-${user?.id??'guest'}`} profile={profile} user={user}/><PortfolioPanel userId={userId}/></div></div>
  </>;
}
