import React from 'react';

// Designer-curated Heroicons SVGs; inline rendering preserves currentColor in both themes.
const sources = import.meta.glob('./assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });
export function Icon({ name, className = '' }) {
  const source = sources[`./assets/icons/${name}.svg`];
  if (!source) return null;
  return <span className={`icon ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: source }} />;
}
