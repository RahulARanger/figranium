#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { loadEnvFile } = require('../src/server/load-env');

// Load .env before changing into the installed package directory so `npx figranium`
// reads configuration from the user's current working directory.
loadEnvFile(process.cwd());

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

function runHealthCheck() {
  const packageJson = require('../package.json');
  const distIndexPath = path.join(rootDir, 'dist', 'index.html');
  const markerPath = path.join(rootDir, '.figranium-build.json');
  const hasDist = fs.existsSync(distIndexPath);
  let marker = null;

  if (fs.existsSync(markerPath)) {
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {
      marker = null;
    }
  }

  const versionMatches = marker && marker.packageVersion === packageJson.version;
  const buildPassed = marker && marker.status === 'passed';
  const healthy = hasDist && versionMatches && buildPassed;

  console.log(`Figranium health: ${healthy ? 'OK' : 'NOT READY'}`);
  console.log(`- Package version: ${packageJson.version}`);
  console.log(`- Frontend: ${hasDist ? 'present' : 'missing'}`);
  console.log(`- Build: ${buildPassed ? `passed at ${marker.builtAt}` : 'not recorded as passed'}`);
  console.log(`- Build version: ${marker ? marker.packageVersion : 'unknown'}`);
  process.exitCode = healthy ? 0 : 1;
}

const args = process.argv.slice(2);
const flags = {};
const params = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    let key = args[i].slice(2);
    let value = true;
    if (key.includes('=')) {
      const parts = key.split('=');
      key = parts[0];
      value = parts.slice(1).join('=');
    } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
      value = args[i + 1];
      i++;
    }
    flags[key] = value;
  } else {
    params.push(args[i]);
  }
}

if (params[0] === 'health' && params.length === 1 && Object.keys(flags).length === 0) {
  runHealthCheck();
  return;
}

if (flags.help || flags.h || (params.length === 0 && Object.keys(flags).length === 1 && flags.help)) {
  console.log(`
Figranium CLI - Deterministic Control for an Agentic World

Usage:
  figranium [options]
  figranium --scrape --url <url> [--selector <css>]
  figranium --agent --task <id>
  figranium --headful --url <url>

Options:
  --scrape              Run a one-off scrape task
  --agent               Run a one-off agent task
  --headful             Open a headful browser session for manual interaction
  --url <url>           Target URL for the task
  --task <id>           Run a saved task by its ID
  --selector <css>      CSS selector for scraping mode
  --wait <seconds>      Seconds to wait after page load
  --port <number>       Port for the web dashboard (default: 11345)
  --help, -h            Show this help message

Environment Variables:
  PORT                  Port for the server
  SESSION_SECRET        Secret for session encryption
  ALLOWED_IPS           Comma-separated list of allowed IPs

Examples:
  figranium                             # Starts web dashboard
  figranium --scrape --url google.com   # Scrapes Google homepage
  figranium --agent --task my-task-123  # Runs saved agent task
    `);
  process.exit(0);
}

async function start() {
  const isStandalone = flags.scrape || flags.agent || flags.headful || flags.task;

  if (isStandalone) {
    console.log('Figranium: Initializing standalone execution...');
    const { loadTasks, getTaskById } = require('../src/server/storage');

    let data = { ...flags };
    const url = flags.url || params[0];
    if (url) data.url = url;

    if (flags.task) {
      try {
        await loadTasks();
        const task = getTaskById(flags.task);
        if (!task) {
          console.error(`Error: Task "${flags.task}" not found.`);
          process.exit(1);
        }
        console.log(`Loaded task: ${task.name} (${task.mode})`);
        // Merge task data with flags (flags take precedence)
        data = { ...task, ...flags, actions: task.actions };
        if (task.mode === 'scrape' && !flags.agent) flags.scrape = true;
        if (task.mode === 'agent' && !flags.scrape) flags.agent = true;
      } catch (err) {
        console.error('Failed to load tasks:', err.message);
        process.exit(1);
      }
    }

    if (flags.scrape) {
      const { runScrape } = require('../scrape');
      console.log(`Mode: Scrape | URL: ${data.url}`);
      try {
        const result = await runScrape(data);
        console.log('\n--- Extraction Result ---');
        console.log(JSON.stringify(result.data || result, null, 2));
        process.exit(0);
      } catch (err) {
        console.error('Scrape failed:', err.message);
        process.exit(1);
      }
    } else if (flags.agent) {
      const { runAgent } = require('../src/agent/index');
      console.log(`Mode: Agent | URL: ${data.url || 'None'}`);
      try {
        const result = await runAgent(data);
        console.log('\n--- Agent Execution Finished ---');
        if (result.logs && result.logs.length > 0) {
          console.log('Logs:');
          result.logs.forEach(l => console.log(`  ${l}`));
        }
        console.log('\nData Output:');
        console.log(JSON.stringify(result.data || result, null, 2));
        process.exit(0);
      } catch (err) {
        console.error('Agent failed:', err.message);
        process.exit(1);
      }
    } else if (flags.headful) {
      const { runHeadful } = require('../headful');
      console.log(`Mode: Headful | URL: ${data.url}`);
      try {
        await runHeadful(data);
        process.exit(0);
      } catch (err) {
        console.error('Headful failed:', err.message);
        process.exit(1);
      }
    }
  } else {
    // Default: Start the server
    if (flags.port) process.env.PORT = flags.port;
    require(path.join(rootDir, 'server.js'));
  }
}

start().catch(err => {
  console.error('CLI Fatal Error:', err);
  process.exit(1);
});
