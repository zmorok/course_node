const navigationEvent = 'workify:navigation';
let snapshot;

export function getLocation() {
  const { pathname, search, hash } = window.location;
  const href = pathname + search + hash;
  if (snapshot?.href !== href) snapshot = Object.freeze({ href, pathname, search, hash });
  return snapshot;
}

export function subscribeLocation(listener) {
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  window.addEventListener(navigationEvent, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener(navigationEvent, listener);
  };
}

export function isAppUrl(href) {
  if (!href || String(href).startsWith('#')) return false;
  try {
    const url = new URL(href, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === window.location.origin &&
      !/^\/(?:api|assets)(?:\/|$)/.test(url.pathname) && url.pathname !== '/healthz';
  } catch { return false; }
}

export function shouldNavigate(event, { href, target, download } = {}) {
  return !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
    (!target || target === '_self') && download == null && isAppUrl(href);
}

export function navigate(href, { replace = false } = {}) {
  if (!isAppUrl(href)) throw new TypeError('Expected an application URL');
  const url = new URL(href, window.location.href);
  const next = url.pathname + url.search + url.hash;
  if (next === getLocation().href) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  window.dispatchEvent(new Event(navigationEvent));
}
