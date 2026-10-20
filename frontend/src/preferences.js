const listeners = new Set();
let volatileLanguage, volatileTheme;

export function getLanguage() {
  if (volatileLanguage) return volatileLanguage;
  try { return globalThis.localStorage?.getItem('workify-language') === 'en' ? 'en' : 'ru'; }
  catch { return 'ru'; }
}
export function getTheme() {
  if (volatileTheme) return volatileTheme;
  try { return globalThis.localStorage?.getItem('workify-theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
export const getPreferencesSnapshot = () => `${getLanguage()}:${getTheme()}`;
export function applyPreferences() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLanguage();
  document.documentElement.dataset.theme = getTheme();
  document.title = getLanguage() === 'en' ? 'Workify — projects and orders' : 'Workify — проекты и заказы';
}
function notify() {
  applyPreferences();
  for (const listener of listeners) listener();
}
function storageChanged(event) {
  if (event.key !== null && !['workify-language', 'workify-theme'].includes(event.key)) return;
  volatileLanguage = volatileTheme = undefined;
  notify();
}
export function subscribePreferences(listener) {
  if (!listeners.size) globalThis.window?.addEventListener('storage', storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) globalThis.window?.removeEventListener('storage', storageChanged);
  };
}
export function setLanguage(value) {
  if (!['ru', 'en'].includes(value)) return;
  try {
    if (!globalThis.localStorage) throw new Error('Storage unavailable');
    globalThis.localStorage.setItem('workify-language', value);
    volatileLanguage = undefined;
  } catch { volatileLanguage = value; }
  notify();
}
export function setTheme(value) {
  if (!['light', 'dark'].includes(value)) return;
  try {
    if (!globalThis.localStorage) throw new Error('Storage unavailable');
    globalThis.localStorage.setItem('workify-theme', value);
    volatileTheme = undefined;
  } catch { volatileTheme = value; }
  notify();
}
applyPreferences();
