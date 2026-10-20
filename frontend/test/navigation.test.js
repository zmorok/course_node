import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocation, isAppUrl, navigate, shouldNavigate, subscribeLocation } from '../src/navigation.js';

function browser(context, initial = '/') {
  const original = globalThis.window;
  const target = new EventTarget();
  const history = [new URL(initial, 'http://localhost:5173')];
  let index = 0;
  Object.defineProperty(target, 'location', { get: () => history[index] });
  target.history = {
    pushState(_state, _title, url) { const next = new URL(url, target.location); history.splice(++index, Infinity, next); },
    replaceState(_state, _title, url) { history[index] = new URL(url, target.location); },
    back() { if (index > 0) { index--; target.dispatchEvent(new Event('popstate')); } },
    forward() { if (index + 1 < history.length) { index++; target.dispatchEvent(new Event('popstate')); } },
  };
  globalThis.window = target;
  context.after(() => { globalThis.window = original; });
  return target;
}

test('section, query and detail transitions preserve history and notify subscribers without a document load', (context) => {
  const target = browser(context), locations = [];
  const unsubscribe = subscribeLocation(() => locations.push(getLocation().href));
  const initial = getLocation();
  assert.strictEqual(getLocation(), initial);
  navigate('/projects?search=React&page=2');
  navigate('/projects/project-a');
  target.history.back();
  assert.equal(getLocation().search, '?search=React&page=2');
  target.history.forward();
  assert.equal(getLocation().pathname, '/projects/project-a');
  assert.deepEqual(locations, ['/projects?search=React&page=2', '/projects/project-a', '/projects?search=React&page=2', '/projects/project-a']);
  unsubscribe();
  navigate('/freelancers');
  assert.equal(locations.length, 4);
});

test('replace updates the current entry and repeated current links do not add history entries', (context) => {
  const target = browser(context, '/projects');
  navigate('/projects/a');
  navigate('/projects/b', { replace: true });
  navigate('/projects/b');
  target.history.back();
  assert.equal(getLocation().pathname, '/projects');
  target.history.forward();
  assert.equal(getLocation().pathname, '/projects/b');
});

test('only ordinary clicks on application links use client navigation', (context) => {
  browser(context);
  const click = { button: 0, defaultPrevented: false };
  assert(shouldNavigate(click, { href: '/me/orders?scope=history' }));
  for (const patch of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    assert(!shouldNavigate({ ...click, ...patch }, { href: '/projects' }));
  }
  for (const props of [{ target: '_blank' }, { download: '' }, { download: 'audit.json' }]) {
    assert(!shouldNavigate(click, { href: '/projects', ...props }));
  }
});

test('file downloads, external links and anchors retain browser behavior', (context) => {
  browser(context);
  for (const href of ['/api/files/id', '/api', '/assets/icon.svg', '/healthz', '#main-content', 'mailto:a@example.com', 'https://other.example/projects', 'javascript:void(0)', 'http://[invalid']) {
    assert.equal(isAppUrl(href), false, href);
  }
  assert(isAppUrl('http://localhost:5173/projects'));
  assert.throws(() => navigate('/api/files/id'), TypeError);
});
