#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

if (process.env.FIGRANIUM_SKIP_BUILD === '1') {
  console.log('[prepare] Skipping frontend build (FIGRANIUM_SKIP_BUILD=1).');
  process.exit(0);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  { stdio: 'inherit', shell: false }
);

if (result.error) {
  console.error(`[prepare] Frontend build failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
