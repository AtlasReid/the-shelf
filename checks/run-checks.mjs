import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suites = [
  'scan-catalog-check.mjs',
  'card-mesh-check.mjs',
  'solar-time-check.mjs',
  'lighting-check.mjs',
  'pickup-check.mjs',
  'ground-motion-check.mjs',
  'leaves-check.mjs',
  'preferences-check.mjs',
  'motion-check.mjs',
  'reading-renderer-check.mjs',
  'adaptive-quality-check.mjs',
  'render-diagnostics-check.mjs',
  'offline-check.mjs',
  'server-check.mjs',
];

for (const suite of suites) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], {stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`All ${suites.length} check suites passed.`);
