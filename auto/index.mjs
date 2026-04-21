#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';
import {
  createCredential,
  revokeCredential,
  serializeCredential,
  validateCredentialData,
} from '../contracts/src/ndcp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RPC_URL = 'http://127.0.0.1:8114';
const CONTRACT_NAME = 'ndcp';

const ISSUER_LOCK_ARG = '0x758d311c8483e0602dfad7b69d9053e3f917457d';
const RECIPIENT_LOCK_ARG = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';
const SECP256K1_CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';

function log(msg) {
  console.log(`[auto] ${msg}`);
}

function toHexQuantity(value) {
  if (typeof value === 'string') return value;
  return `0x${BigInt(value).toString(16)}`;
}

function bytesToHex(bytes) {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
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

function loadDeployment() {
  const scriptsPath = path.join(ROOT, 'deployment', 'scripts.json');
  if (!fs.existsSync(scriptsPath)) {
    throw new Error(`Missing deployment file: ${scriptsPath}. Run build/setup.js first.`);
  }
  const scripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
  const info = scripts?.devnet?.[CONTRACT_NAME];
  if (!info) {
    throw new Error(`No devnet deployment found for contract "${CONTRACT_NAME}".`);
  }
  return info;
}

async function assertDevnetAndContractLive(scriptInfo) {
  const tip = await rpcCall('get_tip_block_number');
  if (!tip) throw new Error('Devnet RPC not reachable at http://127.0.0.1:8114');

  const cellDep = scriptInfo.cellDeps?.[0]?.cellDep;
  if (!cellDep?.outPoint?.txHash) {
    throw new Error('Invalid deployment: missing cell dep out point');
  }

  const outPoint = {
    txHash: cellDep.outPoint.txHash,
    index: toHexQuantity(cellDep.outPoint.index),
  };

  let txStatus = null;
  for (let i = 0; i < 30; i += 1) {
    const tx = await rpcCall('get_transaction', [outPoint.txHash]);
    // CKB RPC uses snake_case (`tx_status`); keep camelCase fallback for compatibility.
    txStatus = tx?.tx_status?.status || tx?.txStatus?.status || null;
    if (txStatus === 'committed') break;
    await sleep(1000);
  }
  if (txStatus !== 'committed') {
    log(`Warning: deployment tx status is "${txStatus || 'unknown'}" for ${outPoint.txHash}`);
  }

  const live = await rpcCall('get_live_cell', [{ tx_hash: outPoint.txHash, index: outPoint.index }, true]);
  if (live?.status !== 'live') {
    log(`Warning: deployment code cell status is "${live?.status || 'unknown'}"`);
  }

  return outPoint;
}

function buildIssueTemplate(scriptInfo) {
  const now = Date.now();
  const credential = createCredential(
    '0x' + 'a1'.repeat(32),
    '0x' + 'b2'.repeat(32),
    ISSUER_LOCK_ARG,
    RECIPIENT_LOCK_ARG,
    new Uint8Array([0x10, 0x20, 0x30, 0x40]),
    now + 365 * 24 * 60 * 60 * 1000,
  );

  const dataBytes = serializeCredential(credential);
  const validation = validateCredentialData(dataBytes);
  if (!validation.valid) throw new Error(`Issue template data invalid: ${validation.error}`);

  const typeScript = {
    codeHash: scriptInfo.codeHash,
    hashType: scriptInfo.hashType,
    args: '0x',
  };

  const issueTemplate = {
    name: 'ndcp-issue-template',
    generatedAt: new Date().toISOString(),
    network: 'devnet',
    contract: CONTRACT_NAME,
    txSkeleton: {
      version: '0x0',
      cellDeps: scriptInfo.cellDeps,
      headerDeps: [],
      inputs: [
        {
          note: 'Fill with issuer funding inputs from live cells',
        },
      ],
      outputs: [
        {
          capacity: '0x0',
          lock: {
            codeHash: SECP256K1_CODE_HASH,
            hashType: 'type',
            args: ISSUER_LOCK_ARG,
          },
          type: typeScript,
        },
      ],
      outputsData: [bytesToHex(dataBytes)],
      witnesses: ['0x'],
    },
    metadata: {
      issuerLockArg: ISSUER_LOCK_ARG,
      recipientLockArg: RECIPIENT_LOCK_ARG,
      dataLength: dataBytes.length,
      flag: credential.flag,
    },
  };

  return { credential, issueTemplate };
}

function buildRevokeTemplate(scriptInfo, issuedCredential) {
  const revoked = revokeCredential(issuedCredential);
  const dataBytes = serializeCredential(revoked);
  const validation = validateCredentialData(dataBytes);
  if (!validation.valid) throw new Error(`Revoke template data invalid: ${validation.error}`);

  const revokeTemplate = {
    name: 'ndcp-revoke-template',
    generatedAt: new Date().toISOString(),
    network: 'devnet',
    contract: CONTRACT_NAME,
    txSkeleton: {
      version: '0x0',
      cellDeps: scriptInfo.cellDeps,
      headerDeps: [],
      inputs: [
        {
          note: 'Consume the previously issued NDCP cell',
        },
      ],
      outputs: [
        {
          capacity: '0x0',
          lock: {
            codeHash: SECP256K1_CODE_HASH,
            hashType: 'type',
            args: ISSUER_LOCK_ARG,
          },
          type: {
            codeHash: scriptInfo.codeHash,
            hashType: scriptInfo.hashType,
            args: '0x',
          },
        },
      ],
      outputsData: [bytesToHex(dataBytes)],
      witnesses: ['0x'],
    },
    metadata: {
      dataLength: dataBytes.length,
      flag: revoked.flag,
      revokeBitSet: (revoked.flag & 0x02) !== 0,
    },
  };

  return revokeTemplate;
}

function writeArtifacts(issueTemplate, revokeTemplate) {
  const outDir = path.join(ROOT, 'auto', 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  const issuePath = path.join(outDir, 'issue-template.json');
  const revokePath = path.join(outDir, 'revoke-template.json');

  fs.writeFileSync(issuePath, `${JSON.stringify(issueTemplate, null, 2)}\n`);
  fs.writeFileSync(revokePath, `${JSON.stringify(revokeTemplate, null, 2)}\n`);

  return { issuePath, revokePath };
}

async function main() {
  log('Loading deployment metadata...');
  const scriptInfo = loadDeployment();

  log('Checking running devnet and deployed code cell...');
  const deployedOutPoint = await assertDevnetAndContractLive(scriptInfo);

  log('Building issue and revoke transaction templates...');
  const { credential, issueTemplate } = buildIssueTemplate(scriptInfo);
  const revokeTemplate = buildRevokeTemplate(scriptInfo, credential);

  const paths = writeArtifacts(issueTemplate, revokeTemplate);
  log(`Issue template written: ${paths.issuePath}`);
  log(`Revoke template written: ${paths.revokePath}`);
  log(`Deployment out point: ${deployedOutPoint.txHash}:${deployedOutPoint.index}`);
  log('Template test passed on live devnet context.');
}

main().catch((err) => {
  console.error(`[auto] Error: ${err.message}`);
  process.exit(1);
});
