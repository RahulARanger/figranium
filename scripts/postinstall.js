#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const buildMarkerPath = path.join(process.cwd(), '.figranium-build.json');

const runNpx = (args) => spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args,
  { stdio: 'inherit', shell: false }
);

const writeBuildMarker = () => {
  fs.writeFileSync(buildMarkerPath, `${JSON.stringify({
    status: 'passed',
    packageVersion: packageJson.version,
    builtAt: new Date().toISOString(),
    nodeVersion: process.version
  }, null, 2)}\n`);
};

const buildIfNeeded = () => {
  if (process.env.FIGRANIUM_SKIP_BUILD === '1') {
    console.log('[postinstall] Skipping frontend build (FIGRANIUM_SKIP_BUILD=1).');
    return 0;
  }

  const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
  if (fs.existsSync(distIndexPath)) {
    writeBuildMarker();
    console.log(`[postinstall] Frontend build is present for version ${packageJson.version}.`);
    return 0;
  }

  const tscPath = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  const vitePath = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(tscPath) || !fs.existsSync(vitePath)) {
    console.error('[postinstall] Frontend build is missing and build tools are unavailable.');
    console.error('[postinstall] GitHub installs should build during npm prepare; try reinstalling this package.');
    return 1;
  }

  console.log('[postinstall] Running frontend build.');
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build'],
    { stdio: 'inherit', shell: false }
  );

  if (result.error || result.status !== 0) {
    console.error(`[postinstall] Frontend build failed${result.error ? `: ${result.error.message}` : '.'}`);
    return typeof result.status === 'number' ? result.status : 1;
  }

  writeBuildMarker();
  console.log(`[postinstall] Frontend build passed for version ${packageJson.version}.`);
  return 0;
};

const exitWithResult = (result, label) => {
  if (result.error) {
    console.error(`[postinstall] ${label} failed: ${result.error.message}`);
    process.exit(1);
  }
  const installStatus = typeof result.status === 'number' ? result.status : 1;
  if (installStatus !== 0) process.exit(installStatus);
  process.exit(buildIfNeeded());
};

if (process.env.FIGRANIUM_SKIP_PLAYWRIGHT_INSTALL === '1') {
  console.log('[postinstall] Skipping Playwright install (FIGRANIUM_SKIP_PLAYWRIGHT_INSTALL=1).');
  process.exit(buildIfNeeded());
}

if (process.env.VERCEL === '1') {
  console.log('[postinstall] Skipping Playwright install (VERCEL=1).');
  process.exit(buildIfNeeded());
}

if (process.env.CI === '1') {
  console.log('[postinstall] Skipping Playwright install (CI=1).');
  process.exit(buildIfNeeded());
}

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.log('[postinstall] Skipping Playwright download (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).');
  process.exit(buildIfNeeded());
}

// CloakBrowser engine is opt-in; pre-fetch its stealth binary only when enabled.
if (process.env.USE_CLOAK_ENGINE === 'true') {
  exitWithResult(runNpx(['cloakbrowser', 'install']), 'CloakBrowser installation');
}

// Installing browser binaries is portable; installing OS packages is not.
// Native macOS and Windows installs should not need apt-get/sudo just to run
// Figranium. Docker sets FIGRANIUM_SKIP_PLAYWRIGHT_INSTALL=1 and provides its
// own browser/runtime dependencies in the image.
const browser = process.env.FIGRANIUM_PLAYWRIGHT_BROWSER || 'chromium';
const installArgs = ['playwright', 'install'];
if (process.env.FIGRANIUM_INSTALL_PLAYWRIGHT_DEPS === '1') {
  installArgs.push('--with-deps');
}
installArgs.push(browser);

console.log(`[postinstall] Installing Playwright browser: ${browser}`);
if (process.env.FIGRANIUM_INSTALL_PLAYWRIGHT_DEPS !== '1') {
  console.log('[postinstall] Skipping OS dependency installation. Set FIGRANIUM_INSTALL_PLAYWRIGHT_DEPS=1 on supported Linux hosts if needed.');
}

exitWithResult(runNpx(installArgs), 'Playwright installation');
