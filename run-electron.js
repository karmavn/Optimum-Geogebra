#!/usr/bin/env node
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
if (args.length === 0) {
  args.push('.');
}

const child = spawn(electronPath, args, {
  env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (err) => {
  console.error('[run-electron] Failed to spawn Electron:', err.message);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
