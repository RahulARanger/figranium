#!/usr/bin/env node
'use strict';

const net = require('net');
const { spawn } = require('child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = new Set();
let shuttingDown = false;

const canBind = (host, port) => new Promise((resolve, reject) => {
  const tester = net.createServer();
  tester.unref();
  tester.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      resolve(false);
    } else {
      reject(error);
    }
  });
  tester.once('listening', () => {
    tester.close(() => resolve(true));
  });
  tester.listen({ host, port });
});

const isPortAvailable = async (port) => {
  if (!await canBind('127.0.0.1', port)) return false;
  try {
    return await canBind('::1', port);
  } catch (error) {
    if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') return true;
    throw error;
  }
};

const findAvailablePort = async (requestedPort) => {
  for (let port = requestedPort; port < requestedPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available local port found starting at ${requestedPort}.`);
};

const start = (label, args, env) => {
  const child = spawn(npmCommand, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false
  });

  children.add(child);
  child.once('error', (error) => {
    console.error(`[local] ${label} failed to start: ${error.message}`);
    if (!shuttingDown) shutdown(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      const exitCode = typeof code === 'number' ? code : 1;
      console.error(`[local] ${label} stopped${signal ? ` after ${signal}` : ` with exit code ${exitCode}`}.`);
      shutdown(exitCode);
    }
  });
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // The child may already have exited.
    }
  }

  const forceExit = setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore children that already exited.
      }
    }
    process.exit(exitCode);
  }, 3000);
  forceExit.unref();

  if (children.size === 0) process.exit(exitCode);
};

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

const main = async () => {
  const requestedBackendPort = Number(process.env.PORT || process.env.VITE_BACKEND_PORT || 11345);
  const requestedFrontendPort = Number(process.env.VITE_DEV_PORT || 5173);
  const backendPort = await findAvailablePort(requestedBackendPort);
  const frontendPort = await findAvailablePort(requestedFrontendPort);
  const localEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    AUTH_REQUIRED: process.env.AUTH_REQUIRED || 'false',
    PORT: String(backendPort),
    VITE_BACKEND_PORT: String(backendPort),
    VITE_DEV_PORT: String(frontendPort)
  };

  console.log(`[local] Starting API server on http://localhost:${backendPort}`);
  console.log(`[local] Starting Vite UI on http://localhost:${frontendPort}`);
  console.log('[local] Press Ctrl+C to stop both processes.');

  start('API server', ['run', 'server'], localEnv);
  start('Vite UI', ['run', 'dev:ui'], localEnv);
};

main().catch((error) => {
  console.error(`[local] ${error.message}`);
  process.exit(1);
});
