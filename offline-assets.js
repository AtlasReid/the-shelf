import { cards } from './compatibility/cards.js';

// Keep this list aligned with the runtime import/asset closure. The check in
// checks/offline-check.mjs verifies every entry and local dependency.
export const OFFLINE_VERSION = '20261102-v1.0.0';
export const OFFLINE_ASSETS = Object.freeze([
  'index.html', 'scene.css', 'scene.js',
  'card-mesh.js', 'paper-material.js', 'lighting.js', 'solar-time.js',
  'light-control.js', 'light-control.css',
  'render-diagnostics.js', 'adaptive-quality.js', 'settings-panel.js', 'leaves.js', 'ground-motion.js',
  'preferences.js', 'reading-renderer.js',
  'motion.js', 'motion-editor.js',
  'offline.js', 'offline-assets.js', 'sw.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/fonts.css', 'fonts/dm-sans-latin.woff2', 'fonts/dm-sans-latin-ext.woff2',
  'fonts/manrope-latin.woff2', 'fonts/manrope-latin-ext.woff2',
  './vendor/three/three.module.js', './vendor/three/three.core.js',
  './compatibility/cards.js',
  ...new Set(cards.flatMap(card => [card.surfaces, card.previewSurfaces ?? {}, card.finishMaps ?? {}]
    .flatMap(surfaces => Object.values(surfaces).map(path => `./compatibility/${path}`)))),
]);

export function offlineURLs(base) {
  return OFFLINE_ASSETS.map(path => new URL(path, base).href);
}

export function offlineCachePrefix(base) {
  return `shelf-three-offline:${encodeURIComponent(new URL(base).pathname)}:`;
}

export function offlineCacheName(base) {
  return `${offlineCachePrefix(base)}${OFFLINE_VERSION}`;
}
