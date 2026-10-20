import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { getLocation, navigate, shouldNavigate, subscribeLocation } from './navigation.js';

export function useLocation() {
  return useSyncExternalStore(subscribeLocation, getLocation);
}

export function Link({ href, onClick, target, download, ...props }) {
  return <a {...props} href={href} target={target} download={download} onClick={(event) => {
    onClick?.(event);
    if (!shouldNavigate(event, { href, target, download })) return;
    event.preventDefault();
    navigate(href);
  }} />;
}

export function RouteFocus() {
  const { pathname, search } = useLocation();
  const previous = useRef(pathname + search);
  useEffect(() => {
    if (previous.current === pathname + search) return;
    previous.current = pathname + search;
    document.querySelectorAll('.nav-more[open]').forEach((menu) => menu.removeAttribute('open'));
    window.scrollTo(0, 0);
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname, search]);
  return null;
}
