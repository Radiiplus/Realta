#!/usr/bin/env node
import http from 'http';
import { spawn } from 'child_process';

const DEFAULT_NETWORK = 'devnet';
const DEFAULT_DEVNET_RPC = 'http://127.0.0.1:8114';
const DEFAULT_FUNDER_PRIVKEY =
  '0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6';

function log(msg) {
  console.log(`[fund] ${msg}`);
}

function printUsage() {
  console.log(`Usage:
  node auto/fund.mjs <walletAddress> <amountInCKB> [--privkey <0x...>] [--network devnet]

Examples:
  node auto/fund.mjs ckt1... 200
  node auto/fund.mjs ckt1... 50 --privkey 0xabc...
  node auto/fund.mjs ckt1... 75 --network devnet

Notes:
  - Default network is devnet.
  - If --privkey is not provided, script uses FUNDER_PRIVKEY env var,
    otherwise it falls back to the seeded devnet issuer key from build/setup.js.
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const positionals = [];
  let privkey = '';
  let network = DEFAULT_NETWORK;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--privkey' || a === '--from-privkey') {
      privkey = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (a === '--network') {
      network = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      throw new Error(`Unknown option: ${a}`);
    }
    positionals.push(a);
  }

  if (positionals.length < 2) {
    throw new Error('Missing required args: <walletAddress> <amountInCKB>');
  }

  const walletAddress = String(positionals[0] || '').trim();
  const amountInCKB = String(positionals[1] || '').trim();

  if (!walletAddress) throw new Error('walletAddress is required.');
  if (!/^(ckt|ckb)1[0-9a-z]+$/i.test(walletAddress)) {
    throw new Error('walletAddress must be a ckt1... or ckb1... address.');
  }

  const amount = Number(amountInCKB);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amountInCKB must be a positive number.');
  }

  const normalizedPrivkey = String(
    privkey || process.env.FUNDER_PRIVKEY || DEFAULT_FUNDER_PRIVKEY,
  ).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivkey)) {
    throw new Error('Funder private key must be a 0x-prefixed 32-byte hex string.');
  }

  return {
    walletAddress,
    amountInCKB: String(amount),
    network: network || DEFAULT_NETWORK,
    privkey: normalizedPrivkey,
  };
}

async function rpcCall(rpcUrl, method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(
      rpcUrl,
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

async function assertNetworkReachable(network) {
  if (network !== 'devnet') return;
  await rpcCall(DEFAULT_DEVNET_RPC, 'get_tip_block_number');
}

function runCmd(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: process.platform === 'win32', ...options });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      process.stdout.write(text);
    });
    proc.stderr?.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      process.stderr.write(text);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `${cmd} exited with ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log(`Network: ${args.network}`);
  log(`Funding: ${args.walletAddress}`);
  log(`Amount: ${args.amountInCKB} CKB`);

  log('Checking network reachability...');
  await assertNetworkReachable(args.network);

  log('Sending transfer...');
  await runCmd(
    'npx',
    [
      '@offckb/cli',
      'transfer',
      args.walletAddress,
      args.amountInCKB,
      '--network',
      args.network,
      '--privkey',
      args.privkey,
    ],
    { cwd: process.cwd() },
  );

  log('Transfer submitted. Fetching updated balance...');
  await runCmd(
    'npx',
    ['@offckb/cli', 'balance', args.walletAddress, '--network', args.network],
    { cwd: process.cwd() },
  );
}

main().catch((err) => {
  console.error(`[fund] Error: ${err.message}`);
  process.exit(1);
});
