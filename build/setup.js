#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

const RPC_URL = 'http://127.0.0.1:8114';
const CONTRACT_NAME = 'ndcp';
const RUST_TARGET = 'riscv64imac-unknown-none-elf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CONTRACT_DIR_WIN = path.join(ROOT_DIR, 'contracts', CONTRACT_NAME);
const ROOT_DIR_WSL = toWslPath(ROOT_DIR);
const CONTRACT_DIR_WSL = `${ROOT_DIR_WSL}/contracts/${CONTRACT_NAME}`;
const CONTRACT_BIN_WSL = `${CONTRACT_DIR_WSL}/target/${RUST_TARGET}/release/${CONTRACT_NAME}`;
const CONTRACT_BIN_WIN = path.join(CONTRACT_DIR_WIN, 'target', RUST_TARGET, 'release', CONTRACT_NAME);
const DEPLOYMENT_DIR_WIN = path.join(ROOT_DIR, 'deployment');

const GENESIS_ACCOUNTS = [
  {
    privkey: '0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6',
    address: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwg2cen8extgq8s5puft8vf40px3f599cytcyd8',
    lockArg: '0x8e42b1999f265a0078503c4acec4d5e134534297',
  },
  {
    privkey: '0x9f315d5a9618a39fdc487c7a67a8581d40b045bd7a42d83648ca80ef3b2cb4a1',
    address: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt435c3epyrupszm7khk6weq5lrlyt52lg48ucew',
    lockArg: '0x758d311c8483e0602dfad7b69d9053e3f917457d',
  },
  {
    privkey: '0x59ddda57ba06d6e9c5fa9040bdb98b4b098c2fce6520d39f51bc5e825364697a',
    address: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvarm0tahu0qfkq6ktuf3wd8azaas0h24c9myfz6',
    lockArg: '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557',
  },
];

const DEPLOYER = GENESIS_ACCOUNTS[1];
const ISSUER = GENESIS_ACCOUNTS[1];
const RECIPIENT = GENESIS_ACCOUNTS[2];

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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `${cmd} exited with ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

function resolveExecutable(name) {
  if (process.platform === 'win32') return name;
  return name;
}

function toWslPath(winPath) {
  const resolved = path.resolve(winPath);
  const normalized = resolved.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):(.*)$/);
  if (!match) return normalized;
  const drive = match[1].toLowerCase();
  const rest = match[2];
  return `/mnt/${drive}${rest}`;
}

function shellEscapeSingleQuotes(s) {
  return s.replace(/'/g, `'\\''`);
}

function runWslBash(command, options = {}) {
  const escaped = shellEscapeSingleQuotes(command);
  return new Promise((resolve, reject) => {
    const proc = spawn('wsl', ['bash', '-lc', escaped], { shell: false });
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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `wsl exited with ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

async function rpcCall(method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = http.request(
      RPC_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
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

async function buildContract() {
  if (!fs.existsSync(CONTRACT_DIR_WIN)) {
    throw new Error(`Contract directory missing: ${CONTRACT_DIR_WIN}`);
  }
  log(`Building ${CONTRACT_NAME} contract in WSL...`);
  await runWslBash(
    `cd ${CONTRACT_DIR_WSL} && rustup target add ${RUST_TARGET} && cargo build --release --target ${RUST_TARGET}`,
  );
}

async function deployContract() {
  if (fs.existsSync(DEPLOYMENT_DIR_WIN)) {
    fs.rmSync(DEPLOYMENT_DIR_WIN, { recursive: true, force: true });
  }
  log(`Deploying ${CONTRACT_NAME} with deployer account...`);
  if (process.platform === 'win32') {
    await runCmd(
      resolveExecutable('npx'),
      ['@offckb/cli', 'deploy', '--network', 'devnet', '--target', CONTRACT_BIN_WIN, '--privkey', DEPLOYER.privkey, '--yes'],
      { cwd: ROOT_DIR },
    );
    return;
  }

  await runWslBash([
    `cd ${ROOT_DIR_WSL}`,
    `npx @offckb/cli deploy --network devnet --target ${CONTRACT_BIN_WSL} --privkey ${DEPLOYER.privkey} --yes`,
  ].join(' && '));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function verifyDeployment() {
  const scriptsPath = path.join(DEPLOYMENT_DIR_WIN, 'scripts.json');
  if (!fs.existsSync(scriptsPath)) {
    throw new Error(`Deployment file not found: ${scriptsPath}`);
  }
  const scripts = readJson(scriptsPath);
  const scriptInfo = scripts?.devnet?.[CONTRACT_NAME];
  if (!scriptInfo) {
    throw new Error(`Deployment entry for ${CONTRACT_NAME} missing in scripts.json`);
  }
  const outPoint = scriptInfo.cellDeps?.[0]?.cellDep?.outPoint;
  if (!outPoint?.txHash) {
    throw new Error('Deployment cell dep outPoint missing');
  }
  return scriptInfo;
}

async function main() {
  log('Starting setup flow...');
  log(`Deployer address: ${DEPLOYER.address}`);
  log(`Issuer address: ${ISSUER.address}`);
  log(`Recipient address: ${RECIPIENT.address}`);

  const alreadyRunning = await isDevnetRunning();
  if (!alreadyRunning) {
    log('Devnet not running. Cleaning stale data...');
    try {
      if (process.platform === 'win32') {
        await runCmd(resolveExecutable('npx'), ['@offckb/cli', 'clean'], { cwd: ROOT_DIR, silent: true });
      } else {
        await runCmd('npx', ['@offckb/cli', 'clean'], { cwd: ROOT_DIR, silent: true });
      }
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

  await buildContract();
  await deployContract();

  const scriptInfo = verifyDeployment();
  log(`Deployment complete for ${CONTRACT_NAME}.`);
  log(`Code hash: ${scriptInfo.codeHash}`);
  log(`OutPoint tx: ${scriptInfo.cellDeps[0].cellDep.outPoint.txHash}`);
}

main().catch((err) => {
  console.error(`[setup] Error: ${err.message}`);
  process.exit(1);
});
