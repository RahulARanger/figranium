#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const runNpx = (args) => spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args,
  { stdio: 'inherit', shell: false }
);

const exitWithResult = (result, label) => {
  if (result.error) {
    console.error(`[postinstall] ${label} failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 1);
};

if (process.env.FIGRANIUM_SKIP_PLAYWRIGHT_INSTALL === '1') {
  console.log('[postinstall] Skipping Playwright install (FIGRANIUM_SKIP_PLAYWRIGHT_INSTALL=1).');
  process.exit(0);
}

if (process.env.VERCEL === '1') {
  console.log('[postinstall] Skipping Playwright install (VERCEL=1).');
  process.exit(0);
}

if (process.env.CI === '1') {
  console.log('[postinstall] Skipping Playwright install (CI=1).');
  process.exit(0);
}

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.log('[postinstall] Skipping Playwright download (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).');
  process.exit(0);
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
