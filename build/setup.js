#!/usr/bin/env node
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

const RPC_URL = 'http://127.0.0.1:8114';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const log = (msg) => console.log(`[setup] ${msg}`);

function runCmd(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: process.platform === 'win32', ...options });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => {
      const txt = d.toString();
      stdout += txt;
      if (!options.silent) process.stdout.write(txt);
    });
    proc.stderr?.on('data', (d) => {
      const txt = d.toString();
      stderr += txt;
      if (!options.silent) process.stderr.write(txt);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${cmd} exited with ${code}`));
    });
    proc.on('error', reject);
  });
}

function resolveExecutable(name) {
  return name;
}

async function rpcCall(method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = http.request(
      RPC_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
              return;
            }
            resolve(parsed.result);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function isDevnetRunning() {
  try {
    const tip = await rpcCall('get_tip_block_number');
    return Boolean(tip);
  } catch {
    return false;
  }
}

async function waitForDevnet(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isDevnetRunning()) return;
    await sleep(2000);
  }
  throw new Error('Devnet failed to start in time');
}

async function main() {
  log('Preparing devnet runtime only (no contract deployment).');

  const alreadyRunning = await isDevnetRunning();
  if (!alreadyRunning) {
    log('Devnet not running. Cleaning stale data...');
    try {
      await runCmd(resolveExecutable('npx'), ['@offckb/cli', 'clean'], { cwd: ROOT_DIR, silent: true });
    } catch {
      // no-op
    }

    log('Starting devnet...');
    if (process.platform === 'win32') {
      await runCmd(
        'cmd.exe',
        ['/c', 'start', '"offckb-devnet"', '/min', resolveExecutable('npx'), '@offckb/cli', 'node'],
        { cwd: ROOT_DIR, silent: true },
      );
    } else {
      await runCmd('bash', ['-lc', 'nohup npx @offckb/cli node >/tmp/offckb-devnet.log 2>&1 < /dev/null &'], {
        cwd: ROOT_DIR,
        silent: true,
      });
    }
    await waitForDevnet();
    log('Devnet is ready.');
  } else {
    log('Devnet already running.');
  }

  log('Next step: deploy and sync artifacts with deployment/sync.mjs');
}

main().catch((err) => {
  console.error(`[setup] Error: ${err.message}`);
  process.exit(1);
});
