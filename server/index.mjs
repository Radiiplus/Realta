#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  createCredential,
  deserializeCredential,
  revokeCredential,
  serializeCredential,
  validateCredentialData,
} from './ndcp.mjs';
import {
  buildIssuanceClaimMessage,
  buildPlatformAuthPayload,
  buildPlatformAuthMessage,
  computePublicKeyId,
  hashPlatformAuthMessageHex,
  isChallengeExpired,
  isValidPublicKeyHex,
  verifyPlatformAuthSignature,
} from './rpauth.mjs';
import {
  downloadContentFromSupabase,
  initSupabasePortal,
  loadPortalDbFromSupabase,
  savePortalDbToSupabase,
  uploadContentToSupabase,
} from './supabase.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || 'http://localhost:5175').replace(/\/+$/, '');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5176,http://127.0.0.1:5176,http://localhost:5175,http://127.0.0.1:5175,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const VALID_NETWORKS = new Set(['devnet', 'testnet', 'mainnet']);
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'devnet';

const RPC_URLS = {
  devnet: process.env.CKB_RPC_DEVNET || 'http://127.0.0.1:8114',
  testnet: process.env.CKB_RPC_TESTNET || '',
  mainnet: process.env.CKB_RPC_MAINNET || '',
};

const DEFAULT_ISSUER_LOCK_ARG = '0x758d311c8483e0602dfad7b69d9053e3f917457d';
const DEFAULT_RECIPIENT_LOCK_ARG = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';
const SECP256K1_CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const SECP256K1_HASH_TYPE = 'type';
const FLAG_REVOKED = 0x02;
const DEFAULT_TX_FEE = 100000n;
const MIN_SECP_CHANGE_CAPACITY = 6100000000n;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key';
const RUST_TARGET = 'riscv64imac-unknown-none-elf';
const CKB_HASH_PERSONALIZATION = Buffer.from('ckb-default-hash');
const KYC_ENABLED = process.env.KYC_ENABLED === 'true';
const ENTITY_TYPES = new Set(['organization', 'individual']);
let portalDbCache = null;
let supabaseDbReady = false;
let supabasePersistTimer = null;
let ckbSdkUtilsCache = null;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-org-id, x-org-key, x-admin-key');

  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function runLocalCmd(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${cmd} exited with ${code}`));
    });
    proc.on('error', reject);
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function shellEscapeSingleQuotes(value) {
  return String(value || '').replace(/'/g, `'\\''`);
}

function runWslCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('wsl', ['bash', '-lc', command], {
      cwd: ROOT,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    const stdinText = typeof options.stdinText === 'string' ? options.stdinText : '';
    let stdinWritten = false;

    const maybeWriteStdin = () => {
      if (stdinWritten || !stdinText) return;
      proc.stdin?.write(stdinText);
      proc.stdin?.end();
      stdinWritten = true;
    };

    proc.stdout?.on('data', (d) => {
      const txt = d.toString();
      stdout += txt;
      maybeWriteStdin();
    });
    proc.stderr?.on('data', (d) => {
      const txt = d.toString();
      stderr += txt;
      const lower = txt.toLowerCase();
      if (lower.includes('password')) maybeWriteStdin();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `wsl exited with ${code}`));
    });
    proc.on('error', reject);
  });
}

function getCkbSdkUtils() {
  if (ckbSdkUtilsCache) return ckbSdkUtilsCache;
  try {
    ckbSdkUtilsCache = require('@nervosnetwork/ckb-sdk-utils');
    return ckbSdkUtilsCache;
  } catch {
    const resolved = require.resolve('@nervosnetwork/ckb-sdk-utils', {
      paths: [
        path.join(ROOT, 'public'),
        path.join(ROOT, 'build'),
        ROOT,
      ],
    });
    ckbSdkUtilsCache = require(resolved);
    return ckbSdkUtilsCache;
  }
}

function getContractBinaryPath(contractName) {
  const normalized = asTrimmedString(contractName || 'ndcp') || 'ndcp';
  return path.join(ROOT, 'contracts', normalized, 'target', RUST_TARGET, 'release', normalized);
}

function readContractBinary(contractName) {
  const binaryPath = getContractBinaryPath(contractName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Contract binary missing: ${binaryPath}. Build the contract first.`);
  }
  return {
    binaryPath,
    bytes: fs.readFileSync(binaryPath),
  };
}

function computeCkbDataHashHex(buffer) {
  const { blake2b } = getCkbSdkUtils();
  const hash = blake2b(32, null, null, CKB_HASH_PERSONALIZATION);
  hash.update(Buffer.from(buffer));
  return `0x${hash.digest('hex')}`;
}

function ensureAdminAuthorized(req) {
  const adminKey = asTrimmedString(req.headers['x-admin-key'] || '');
  if (!adminKey || adminKey !== ADMIN_API_KEY) {
    const err = new Error('Unauthorized: invalid x-admin-key.');
    err.statusCode = 401;
    throw err;
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJson(filePath);
  } catch {
    return null;
  }
}

function requestBaseUrl(req) {
  const proto = asTrimmedString(req.headers['x-forwarded-proto'] || '').toLowerCase() || 'http';
  const host = asTrimmedString(req.headers.host || '');
  if (!host) return FRONTEND_BASE_URL;
  return `${proto}://${host}`;
}

function buildIframeCode(embedUrl, width = 420, height = 260) {
  const src = asTrimmedString(embedUrl);
  if (!src) return '';
  const w = Number(width) > 0 ? Number(width) : 420;
  const h = Number(height) > 0 ? Number(height) : 260;
  return `<iframe src="${src}" width="${w}" height="${h}" style="border:0;overflow:hidden;" loading="lazy"></iframe>`;
}

function asTrimmedString(value) {
  return String(value ?? '').trim();
}

function asNullableTrimmedString(value) {
  const clean = asTrimmedString(value);
  return clean || null;
}

function normalizeEntityType(value) {
  const clean = asTrimmedString(value).toLowerCase();
  if (ENTITY_TYPES.has(clean)) return clean;
  return 'organization';
}

function buildProfileFromBody(body, current = {}) {
  const profile = {
    legalName: current.legalName || '',
    registrationNumber: current.registrationNumber || '',
    industry: current.industry || '',
    firstName: current.firstName || '',
    lastName: current.lastName || '',
    occupation: current.occupation || '',
    country: current.country || '',
    city: current.city || '',
    addressLine: current.addressLine || '',
    description: current.description || '',
    website: current.website || '',
    socialPlatform: current.socialPlatform || '',
    socialHandle: current.socialHandle || '',
    phone: current.phone || '',
  };

  const legacyTwitter = asTrimmedString(current.twitter || '');
  if (!profile.socialHandle && legacyTwitter) {
    profile.socialPlatform = profile.socialPlatform || 'x';
    profile.socialHandle = legacyTwitter;
  }

  const mutableFields = Object.keys(profile);
  for (const field of mutableFields) {
    if (body[field] !== undefined) {
      profile[field] = asTrimmedString(body[field]);
    }
  }
  if (body.twitter !== undefined && body.socialHandle === undefined) {
    profile.socialPlatform = profile.socialPlatform || 'x';
    profile.socialHandle = asTrimmedString(body.twitter);
  }
  return profile;
}

function generateRegistrationNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `REG-${stamp}-${rand}`;
}

function normalizeOrganizationRecord(org) {
  if (!org || typeof org !== 'object') return { org, changed: false };

  let changed = false;
  const next = { ...org };

  const normalizedEntityType = normalizeEntityType(next.entityType);
  if (next.entityType !== normalizedEntityType) {
    next.entityType = normalizedEntityType;
    changed = true;
  }

  const normalizedProfile = buildProfileFromBody({}, next.profile || {});
  if (JSON.stringify(normalizedProfile) !== JSON.stringify(next.profile || {})) {
    next.profile = normalizedProfile;
    changed = true;
  }

  if (next.entityType === 'organization') {
    if (!asTrimmedString(next.profile.legalName)) {
      next.profile.legalName = asTrimmedString(next.name);
      changed = true;
    }
    if (!asTrimmedString(next.profile.registrationNumber)) {
      next.profile.registrationNumber = generateRegistrationNumber();
      changed = true;
    }
  }

  if (!asTrimmedString(next.status)) {
    next.status = 'active';
    changed = true;
  }
  if (next.status !== 'active' && next.status !== 'delisted') {
    next.status = 'active';
    changed = true;
  }
  if (next.status === 'delisted') {
    if (!next.delistedAt) {
      next.delistedAt = next.updatedAt || nowIso();
      changed = true;
    }
  } else if (next.delistedAt) {
    next.delistedAt = null;
    changed = true;
  }

  return { org: next, changed };
}

function clonePortalDb(db) {
  return JSON.parse(JSON.stringify(db));
}

function seedPortalDbShape(db) {
  if (!db || typeof db !== 'object') return {
    organizations: {},
    verifications: {
      twitterChallenges: {},
      websiteChallenges: {},
    },
    kycSubmissions: {},
    contents: {},
    credentials: {},
    shareLinks: {},
    authChallenges: {},
    issuanceSessions: {},
  };
  if (!db.organizations || typeof db.organizations !== 'object') db.organizations = {};
  if (!db.verifications || typeof db.verifications !== 'object') {
    db.verifications = { twitterChallenges: {}, websiteChallenges: {} };
  }
  if (!db.verifications.twitterChallenges || typeof db.verifications.twitterChallenges !== 'object') {
    db.verifications.twitterChallenges = {};
  }
  if (!db.verifications.websiteChallenges || typeof db.verifications.websiteChallenges !== 'object') {
    db.verifications.websiteChallenges = {};
  }
  if (!db.kycSubmissions || typeof db.kycSubmissions !== 'object') db.kycSubmissions = {};
  if (!db.contents || typeof db.contents !== 'object') db.contents = {};
  if (!db.credentials || typeof db.credentials !== 'object') db.credentials = {};
  if (!db.shareLinks || typeof db.shareLinks !== 'object') db.shareLinks = {};
  if (!db.orgShareLinks || typeof db.orgShareLinks !== 'object') db.orgShareLinks = {};
  if (!db.authChallenges || typeof db.authChallenges !== 'object') db.authChallenges = {};
  if (!db.issuanceSessions || typeof db.issuanceSessions !== 'object') db.issuanceSessions = {};
  return db;
}

function scheduleSupabasePortalDbWrite() {
  if (!supabaseDbReady || !portalDbCache) return;
  if (supabasePersistTimer) clearTimeout(supabasePersistTimer);
  const snapshot = clonePortalDb(portalDbCache);
  supabasePersistTimer = setTimeout(async () => {
    try {
      await savePortalDbToSupabase(snapshot);
    } catch (err) {
      console.error(`[server] Supabase portal-db write failed: ${err.message || err}`);
    }
  }, 100);
}

function sanitizeUploadName(fileName) {
  const base = path.basename(String(fileName || 'document'));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'document.bin';
}

function decodeBase64Input(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('fileDataBase64 is required.');
  const match = /^data:.*;base64,(.*)$/i.exec(raw);
  const base64 = (match ? match[1] : raw).replace(/\s+/g, '');
  return Buffer.from(base64, 'base64');
}

function sha256HexOfBuffer(buffer) {
  return `0x${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function guessMimeTypeFromName(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

function readPortalDb() {
  if (!portalDbCache) throw new Error('Portal DB is not initialized.');
  return clonePortalDb(seedPortalDbShape(clonePortalDb(portalDbCache)));
}

function writePortalDb(db) {
  if (!supabaseDbReady) throw new Error('Supabase portal DB is not ready.');
  const normalized = seedPortalDbShape(clonePortalDb(db));
  portalDbCache = normalized;
  scheduleSupabasePortalDbWrite();
}

async function initializePortalDbStorage() {
  initSupabasePortal();
  supabaseDbReady = true;

  try {
    const remoteDb = await loadPortalDbFromSupabase();
    if (remoteDb && typeof remoteDb === 'object') {
      portalDbCache = seedPortalDbShape(remoteDb);
      console.log('[server] Portal DB loaded from Supabase.');
    } else {
      portalDbCache = seedPortalDbShape({});
      await savePortalDbToSupabase(portalDbCache);
      console.log('[server] Supabase portal DB initialized with empty seed.');
    }
  } catch (err) {
    supabaseDbReady = false;
    throw new Error(`Supabase portal DB initialization failed: ${err.message || err}`);
  }
}

function computeTrustLevel(org) {
  const twitter = org?.verification?.twitter?.status === 'verified';
  const website = org?.verification?.website?.status === 'verified';
  const kyc = KYC_ENABLED && org?.verification?.kyc?.status === 'approved';
  const score = Number(twitter) + Number(website) + Number(kyc);
  let level = 'unverified';
  if (score === 1) level = 'basic';
  if (score === 2) level = 'strong';
  if (score >= 3) level = 'high';
  return { score, level, twitter, website, kyc };
}

function getMissingRequiredProfileFields(org) {
  const profile = org?.profile || {};
  const entityType = normalizeEntityType(org?.entityType);
  const missing = [];

  const pushIfMissing = (key, value) => {
    if (!asTrimmedString(value)) missing.push(key);
  };

  pushIfMissing('name', org?.name);
  pushIfMissing('contactEmail', org?.contactEmail);
  pushIfMissing('country', profile.country);
  pushIfMissing('city', profile.city);
  pushIfMissing('addressLine', profile.addressLine);
  pushIfMissing('website', profile.website);

  if (entityType === 'organization') {
    pushIfMissing('legalName', profile.legalName);
    pushIfMissing('registrationNumber', profile.registrationNumber);
    pushIfMissing('industry', profile.industry);
  } else {
    pushIfMissing('firstName', profile.firstName);
    pushIfMissing('lastName', profile.lastName);
    pushIfMissing('occupation', profile.occupation);
  }

  return missing;
}

function findOrganizationsByAuthKeyId(db, keyId) {
  const normalizedKeyId = asTrimmedString(keyId).toLowerCase();
  if (!normalizedKeyId) return [];
  return Object.values(db.organizations || {})
    .map((item) => normalizeOrganizationRecord(item).org)
    .filter((org) => String(org?.authBinding?.keyId || '').toLowerCase() === normalizedKeyId);
}

function findIssuanceSessionByToken(db, token) {
  const normalizedToken = asTrimmedString(token);
  if (!normalizedToken) return null;
  const sessions = Object.values(db.issuanceSessions || {});
  return sessions.find((session) => String(session?.token || '') === normalizedToken) || null;
}

function maybeExpireIssuanceSession(session, nowMs = Date.now()) {
  if (!session || typeof session !== 'object') return false;
  if (String(session.status || '').toLowerCase() !== 'pending') return false;
  const expiresMs = Date.parse(String(session.expiresAt || ''));
  if (!Number.isFinite(expiresMs)) return false;
  if (nowMs <= expiresMs) return false;
  session.status = 'expired';
  session.updatedAt = nowIso();
  return true;
}

function resolveShareCredentialPayload(db, shareSlug) {
  const slug = asTrimmedString(shareSlug);
  if (!slug) return null;
  const credentialId = db.shareLinks[slug];
  if (!credentialId) return null;
  const credential = db.credentials[credentialId];
  if (!credential || String(credential.status || '') === 'delisted') return null;
  const org = db.organizations[credential.orgId];
  const trust = org ? computeTrustLevel(org) : null;
  let orgShareSlug = null;
  for (const [slugKey, orgId] of Object.entries(db.orgShareLinks || {})) {
    if (String(orgId) === String(credential.orgId)) {
      orgShareSlug = slugKey;
      break;
    }
  }
  return {
    credentialId: credential.id,
    title: credential.title,
    status: credential.status,
    recipientDisplayName: credential.recipientDisplayName,
    recipientReference: credential.recipientReference || null,
    claimant: credential.claimant || null,
    orgId: credential.orgId,
    orgShareSlug,
    issuer: org ? {
      name: org.name,
      website: org.profile?.website || '',
      socialPlatform: org.profile?.socialPlatform || '',
      socialHandle: org.profile?.socialHandle || org.profile?.twitter || '',
    } : null,
    trust,
    network: credential.network,
    ndcpOutPoint: credential.ndcpOutPoint,
    issuanceSessionId: credential.issuanceSessionId || null,
    onChain: credential.onChain || null,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

function resolveShareOrganizationPayload(db, shareSlug) {
  const slug = asTrimmedString(shareSlug);
  if (!slug) return null;
  const orgId = db.orgShareLinks?.[slug];
  if (!orgId) return null;
  const rawOrg = db.organizations[orgId];
  const normalized = normalizeOrganizationRecord(rawOrg);
  const org = normalized.org;
  if (!org || String(org.status || 'active') === 'delisted') return null;
  const publicOrg = { ...org };
  delete publicOrg.apiKey;
  return {
    shareSlug: slug,
    organization: publicOrg,
    trust: computeTrustLevel(org),
  };
}

function findCredentialShareSlug(db, credentialId) {
  for (const [slug, id] of Object.entries(db.shareLinks || {})) {
    if (String(id) === String(credentialId)) return slug;
  }
  return null;
}

function findOrganizationShareSlug(db, orgId) {
  for (const [slug, id] of Object.entries(db.orgShareLinks || {})) {
    if (String(id) === String(orgId)) return slug;
  }
  return null;
}

function getOrgAuth(req, options = {}) {
  const allowDelisted = options.allowDelisted === true;
  const orgId = req.headers['x-org-id'];
  const orgKey = req.headers['x-org-key'];
  if (!orgId || !orgKey) {
    throw new Error('Missing org auth headers: x-org-id and x-org-key are required.');
  }
  const db = readPortalDb();
  const rawOrg = db.organizations[String(orgId)];
  const normalized = normalizeOrganizationRecord(rawOrg);
  const org = normalized.org;
  if (normalized.changed) {
    db.organizations[String(orgId)] = org;
    writePortalDb(db);
  }
  if (!org) throw new Error('Organization not found.');
  if (org.apiKey !== String(orgKey)) throw new Error('Invalid org API key.');
  if (org.status === 'delisted' && !allowDelisted) {
    throw new Error('Organization is delisted. Restore it before performing this action.');
  }
  return { db, org };
}

function tryGetOrgAuth(req) {
  const orgId = req.headers['x-org-id'];
  const orgKey = req.headers['x-org-key'];
  if (!orgId && !orgKey) return null;
  if (!orgId || !orgKey) {
    throw new Error('Provide both x-org-id and x-org-key headers when using org auth.');
  }
  return getOrgAuth(req);
}

function normalizeNetwork(value) {
  const network = String(value || DEFAULT_NETWORK).toLowerCase();
  if (!VALID_NETWORKS.has(network)) {
    throw new Error(`Invalid network "${value}". Use devnet, testnet, or mainnet.`);
  }
  return network;
}

function getRpcUrl(network) {
  const url = RPC_URLS[network];
  if (!url) {
    throw new Error(`RPC URL for ${network} is not configured. Set CKB_RPC_${network.toUpperCase()}.`);
  }
  return url;
}

function getEnvContractInfo(network, contractName = 'ndcp') {
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedContract = String(contractName || 'ndcp').trim().toUpperCase();
  const prefix = `CKB_${normalizedContract}_${normalizedNetwork.toUpperCase()}`;
  const codeHash = asTrimmedString(process.env[`${prefix}_CODE_HASH`]);
  const hashType = asTrimmedString(process.env[`${prefix}_HASH_TYPE`] || 'data2') || 'data2';
  const txHash = asTrimmedString(process.env[`${prefix}_TX_HASH`]);
  const index = asTrimmedString(process.env[`${prefix}_INDEX`]);
  const depType = asTrimmedString(process.env[`${prefix}_DEP_TYPE`] || 'code') || 'code';

  if (!codeHash || !txHash || !index) return null;

  return {
    codeHash,
    hashType,
    cellDeps: [
      {
        cellDep: {
          outPoint: {
            txHash,
            index: toHexQuantity(index),
          },
          depType,
        },
      },
    ],
  };
}

function getContractInfo(network, contractName = 'ndcp') {
  return getEnvContractInfo(network, contractName);
}

function matchesNdcpContractInfo(typeScript, ndcpInfo) {
  if (!typeScript || !ndcpInfo) return false;
  const codeHash = valueAt(typeScript, 'codeHash', 'code_hash');
  const hashType = String(valueAt(typeScript, 'hashType', 'hash_type') || '').toLowerCase();
  const expectedCodeHash = valueAt(ndcpInfo, 'codeHash', 'code_hash');
  const expectedHashType = String(valueAt(ndcpInfo, 'hashType', 'hash_type') || '').toLowerCase();
  return compareHash(codeHash, expectedCodeHash) && hashType === expectedHashType;
}

function valueAt(obj, camelKey, snakeKey) {
  if (!obj || typeof obj !== 'object') return undefined;
  return obj[camelKey] ?? obj[snakeKey];
}

function getOutPointHash(outPoint) {
  return valueAt(outPoint, 'txHash', 'tx_hash');
}

function getOutPointIndex(outPoint) {
  return valueAt(outPoint, 'index', 'index');
}

function extractTx(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Body must be a JSON object');
  }

  const direct = payload.tx ?? payload.transaction ?? payload.signedTx ?? payload.signed_tx;
  if (direct && typeof direct === 'object') {
    return direct;
  }

  if (payload.signed_transaction && typeof payload.signed_transaction === 'object') {
    return payload.signed_transaction;
  }

  throw new Error('Missing signed transaction. Provide tx, transaction, signedTx, or signed_tx in request body.');
}

function validateTxShape(tx) {
  const inputs = valueAt(tx, 'inputs', 'inputs');
  const outputs = valueAt(tx, 'outputs', 'outputs');
  const witnesses = valueAt(tx, 'witnesses', 'witnesses');

  if (!Array.isArray(inputs) || !Array.isArray(outputs) || !Array.isArray(witnesses)) {
    throw new Error('Invalid transaction shape: expected inputs, outputs, and witnesses arrays.');
  }
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeScript(script) {
  if (!script || typeof script !== 'object') return null;
  return {
    code_hash: pick(script, 'code_hash', 'codeHash'),
    hash_type: pick(script, 'hash_type', 'hashType'),
    args: pick(script, 'args'),
  };
}

function normalizeDepType(depType) {
  const raw = String(depType || '').trim();
  if (!raw) return 'code';
  if (raw === 'depGroup' || raw === 'dep_group') return 'dep_group';
  if (raw === 'code') return 'code';
  return raw;
}

function normalizeOutPoint(outPoint) {
  if (!outPoint || typeof outPoint !== 'object') return null;
  const indexRaw = pick(outPoint, 'index');
  return {
    tx_hash: pick(outPoint, 'tx_hash', 'txHash'),
    index: indexRaw === undefined || indexRaw === null ? indexRaw : toHexQuantity(indexRaw),
  };
}

function normalizeTransactionForRpc(tx) {
  const inputs = pick(tx, 'inputs') || [];
  const outputs = pick(tx, 'outputs') || [];
  const cellDeps = pick(tx, 'cell_deps', 'cellDeps') || [];
  const headerDeps = pick(tx, 'header_deps', 'headerDeps') || [];
  const outputsData = pick(tx, 'outputs_data', 'outputsData') || [];
  const witnesses = pick(tx, 'witnesses') || [];

  return {
    version: pick(tx, 'version') || '0x0',
    cell_deps: cellDeps.map((dep) => {
      const resolvedDep = pick(dep, 'cellDep', 'cell_dep') || dep;
      return {
        dep_type: normalizeDepType(pick(resolvedDep, 'dep_type', 'depType')),
        out_point: normalizeOutPoint(pick(resolvedDep, 'out_point', 'outPoint')),
      };
    }),
    header_deps: headerDeps,
    inputs: inputs.map((input) => ({
      since: pick(input, 'since') || '0x0',
      previous_output: normalizeOutPoint(pick(input, 'previous_output', 'previousOutput')),
    })),
    outputs: outputs.map((output) => ({
      capacity: pick(output, 'capacity'),
      lock: normalizeScript(pick(output, 'lock')),
      type: normalizeScript(pick(output, 'type')),
    })),
    outputs_data: outputsData,
    witnesses,
  };
}

function toCamelOutPoint(outPoint) {
  if (!outPoint) return null;
  return {
    txHash: pick(outPoint, 'txHash', 'tx_hash'),
    index: pick(outPoint, 'index'),
  };
}

function parseOutPointFromResolveError(message) {
  const match = /OutPoint\((0x[0-9a-fA-F]+)([0-9a-fA-F]{8})\)/.exec(String(message || ''));
  if (!match) return null;
  const txHash = match[1];
  const indexLeHex = match[2];
  const bytes = indexLeHex.match(/../g) || [];
  const be = bytes.reverse().join('') || '0';
  return {
    txHash,
    index: `0x${BigInt(`0x${be}`).toString(16)}`,
  };
}

function outPointKey(outPoint) {
  const txHash = String(pick(outPoint, 'txHash', 'tx_hash') || '').toLowerCase();
  const index = String(pick(outPoint, 'index') || '').toLowerCase();
  if (!txHash || index === '') return null;
  return `${txHash}:${index}`;
}

function cellDepOutPointSet(txLike) {
  const deps = valueAt(txLike, 'cellDeps', 'cell_deps') || [];
  const set = new Set();
  for (const dep of deps) {
    const normalized = normalizeCellDep(dep);
    const key = outPointKey(normalized?.cellDep?.outPoint);
    if (key) set.add(key);
  }
  return set;
}

async function checkInputsLive(rpcUrl, txForRpc) {
  const inputs = txForRpc.inputs || [];
  const checks = await Promise.all(
    inputs.map(async (input, i) => {
      const prev = input?.previous_output;
      const txHash = prev?.tx_hash;
      const index = prev?.index;
      if (!txHash || index === undefined) {
        return {
          inputIndex: i,
          outPoint: toCamelOutPoint(prev),
          status: 'invalid',
          reason: 'missing previous_output tx_hash/index',
        };
      }

      const live = await rpcCall(
        rpcUrl,
        'get_live_cell',
        [{ tx_hash: txHash, index }, false],
      );

      const status = live?.status || 'unknown';
      if (status !== 'live') {
        return {
          inputIndex: i,
          outPoint: { txHash, index },
          status,
        };
      }
      return null;
    }),
  );

  return checks.filter(Boolean);
}

function compareHash(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function compareIndex(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  return aStr === bStr || Number(aStr) === Number(bStr);
}

function txReferencesNdcp(tx, ndcpInfo) {
  const infoList = Array.isArray(ndcpInfo) ? ndcpInfo : [ndcpInfo];
  const validInfos = infoList.filter(Boolean);
  if (validInfos.length === 0) return false;

  const txOutputs = valueAt(tx, 'outputs', 'outputs') || [];
  const txCellDeps = valueAt(tx, 'cellDeps', 'cell_deps') || [];

  return validInfos.some((info) => {
    const codeHash = valueAt(info, 'codeHash', 'code_hash');
    const declaredDeps = valueAt(info, 'cellDeps', 'cell_deps') || [];

    const outputHasCodeHash = txOutputs.some((output) => {
      const type = valueAt(output, 'type', 'type');
      if (!type || typeof type !== 'object') return false;
      const outputCodeHash = valueAt(type, 'codeHash', 'code_hash');
      return compareHash(outputCodeHash, codeHash);
    });

    if (outputHasCodeHash) return true;

    return txCellDeps.some((dep) => {
      const depOutPoint = valueAt(dep, 'outPoint', 'out_point');
      if (!depOutPoint) return false;

      return declaredDeps.some((declared) => {
        const cellDep = valueAt(declared, 'cellDep', 'cell_dep');
        const declaredOutPoint = valueAt(cellDep, 'outPoint', 'out_point');
        if (!declaredOutPoint) return false;

        const depHash = getOutPointHash(depOutPoint);
        const declaredHash = getOutPointHash(declaredOutPoint);
        const depIndex = getOutPointIndex(depOutPoint);
        const declaredIndex = getOutPointIndex(declaredOutPoint);

        return compareHash(depHash, declaredHash) && compareIndex(depIndex, declaredIndex);
      });
    });
  });
}

async function rpcCall(rpcUrl, method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const transport = String(rpcUrl || '').startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      rpcUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}');
            if (parsed.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
              return;
            }
            resolve(parsed.result);
          } catch (err) {
            reject(new Error(`Invalid RPC response: ${err.message}`));
          }
        });
      },
    );

    req.on('error', (err) => reject(new Error(`RPC connection error: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function bytesToHex(bytes) {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) {
    throw new Error('Expected hex string with 0x prefix');
  }
  const clean = hex.slice(2);
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function normalizeDataHex(hex) {
  if (typeof hex !== 'string') throw new Error('Expected hex string');
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

function toHexQuantity(value) {
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  return `0x${BigInt(value).toString(16)}`;
}

function toBigIntQuantity(value, fieldName = 'value') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new Error(`Invalid ${fieldName}: expected numeric quantity.`);
}

function hexDataByteLength(hex) {
  const clean = normalizeDataHex(hex);
  return (clean.length - 2) / 2;
}

function scriptOccupiedBytes(script) {
  if (!script) return 0;
  const codeHash = asTrimmedString(pick(script, 'codeHash', 'code_hash'));
  const hashType = asTrimmedString(pick(script, 'hashType', 'hash_type'));
  const args = normalizeDataHex(pick(script, 'args') || '0x');
  if (!codeHash || !hashType) return 0;
  return 32 + 1 + hexDataByteLength(args);
}

function computeMinimalCellCapacity(lockScript, typeScript, dataHex) {
  const lockBytes = scriptOccupiedBytes(lockScript);
  const typeBytes = scriptOccupiedBytes(typeScript);
  const dataBytes = hexDataByteLength(dataHex);
  const occupiedBytes = 8 + lockBytes + typeBytes + dataBytes;
  return BigInt(occupiedBytes) * 100000000n;
}

function requireDevnet(network) {
  if (network !== 'devnet') {
    throw new Error('This NDCP endpoint is currently enabled for devnet only.');
  }
}

function parseCredentialStateFromDataHex(dataHex) {
  const dataBytes = hexToBytes(dataHex);
  const validation = validateCredentialData(dataBytes);
  if (!validation.valid) throw new Error(`Credential data invalid: ${validation.error}`);
  const parsed = deserializeCredential(dataBytes);
  const revoked = (parsed.flag & FLAG_REVOKED) !== 0;
  return { parsed, revoked };
}

function buildDefaultLock(args) {
  return {
    codeHash: SECP256K1_CODE_HASH,
    hashType: SECP256K1_HASH_TYPE,
    args,
  };
}

function normalizeLockForTemplate(lock, defaultArgs = DEFAULT_ISSUER_LOCK_ARG) {
  const script = lock || buildDefaultLock(defaultArgs);
  return {
    codeHash: pick(script, 'codeHash', 'code_hash') || SECP256K1_CODE_HASH,
    hashType: pick(script, 'hashType', 'hash_type') || SECP256K1_HASH_TYPE,
    args: normalizeDataHex(pick(script, 'args') || defaultArgs),
  };
}

function isSpendablePlainCapacityCell(cell) {
  const output = cell?.output;
  if (!output?.capacity) return false;
  if (output.type) return false;

  const dataLen = String(cell?.output_data_len ?? cell?.outputDataLen ?? '').trim().toLowerCase();
  if (dataLen && dataLen !== '0x0') return false;

  const dataContent = String(
    typeof cell?.output_data === 'string' ? cell.output_data : cell?.output_data?.content
    ?? cell?.outputData?.content
    ?? cell?.data?.content
    ?? '',
  ).trim().toLowerCase();
  if (dataContent && dataContent !== '0x') return false;

  return true;
}

async function collectLiveCellsByLock(rpcUrl, lockScript, neededCapacity, maxInputs = 32) {
  const target = toBigIntQuantity(neededCapacity, 'neededCapacity');
  const searchKey = {
    script: toRpcScript(lockScript),
    script_type: 'lock',
  };

  let cursor = null;
  let total = 0n;
  const inputs = [];

  while (inputs.length < maxInputs && total < target) {
    const page = await rpcCall(
      rpcUrl,
      'get_cells',
      [searchKey, 'asc', toHexQuantity(100), cursor],
    );
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    if (objects.length === 0) break;

    for (const cell of objects) {
      const outPoint = cell?.out_point;
      const output = cell?.output;
      if (!outPoint || !output?.capacity) continue;
      // Funding inputs must be plain spendable CKB cells with no type and no data payload.
      if (!isSpendablePlainCapacityCell(cell)) continue;

      const capacity = toBigIntQuantity(output.capacity, 'cell.capacity');
      inputs.push({
        previousOutput: {
          txHash: outPoint.tx_hash,
          index: outPoint.index,
        },
        since: '0x0',
        capacity,
      });
      total += capacity;
      if (inputs.length >= maxInputs || total >= target) break;
    }

    const nextCursor = page?.last_cursor;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return { inputs, totalCapacity: total };
}

async function sumLivePlainCapacityByLock(rpcUrl, lockScript, maxCells = 2000) {
  const searchKey = {
    script: toRpcScript(lockScript),
    script_type: 'lock',
  };

  let cursor = null;
  let total = 0n;
  let count = 0;
  let hasMore = false;

  while (count < maxCells) {
    const page = await rpcCall(
      rpcUrl,
      'get_cells',
      [searchKey, 'asc', toHexQuantity(100), cursor],
    );
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    if (objects.length === 0) break;

    for (const cell of objects) {
      const output = cell?.output;
      if (!output?.capacity) continue;
      if (!isSpendablePlainCapacityCell(cell)) continue;
      total += toBigIntQuantity(output.capacity, 'cell.capacity');
      count += 1;
      if (count >= maxCells) break;
    }

    const nextCursor = page?.last_cursor;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    hasMore = true;
  }

  return { totalCapacity: total, cellCount: count, truncated: hasMore && count >= maxCells };
}

function toRpcScript(script) {
  if (!script) return null;
  return {
    code_hash: pick(script, 'code_hash', 'codeHash'),
    hash_type: pick(script, 'hash_type', 'hashType'),
    args: pick(script, 'args'),
  };
}

function rpcScriptToCamel(script) {
  if (!script) return null;
  return {
    codeHash: pick(script, 'codeHash', 'code_hash'),
    hashType: pick(script, 'hashType', 'hash_type'),
    args: pick(script, 'args'),
  };
}

function normalizeCellDep(dep) {
  const resolved = pick(dep, 'cellDep', 'cell_dep') || dep;
  if (!resolved || typeof resolved !== 'object') return null;
  const outPoint = pick(resolved, 'outPoint', 'out_point');
  if (!outPoint) return null;
  const txHash = pick(outPoint, 'txHash', 'tx_hash');
  const index = pick(outPoint, 'index');
  const depType = pick(resolved, 'depType', 'dep_type') || 'code';
  if (!txHash || index === undefined || index === null) return null;
  return {
    cellDep: {
      outPoint: {
        txHash,
        index: toHexQuantity(index),
      },
      depType,
    },
  };
}

function mergeUniqueCellDeps(...depLists) {
  const merged = [];
  const seen = new Set();
  for (const list of depLists) {
    const deps = Array.isArray(list) ? list : [];
    for (const dep of deps) {
      const normalized = normalizeCellDep(dep);
      if (!normalized) continue;
      const outPoint = normalized.cellDep.outPoint;
      const key = `${String(outPoint.txHash).toLowerCase()}:${String(outPoint.index).toLowerCase()}:${normalized.cellDep.depType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

function getSecpLockCellDepFromEnv(network) {
  const suffix = String(network || '').toUpperCase();
  const txHash = process.env[`CKB_SECP256K1_CELL_DEP_${suffix}_TX_HASH`];
  const index = process.env[`CKB_SECP256K1_CELL_DEP_${suffix}_INDEX`];
  const depType = process.env[`CKB_SECP256K1_CELL_DEP_${suffix}_DEP_TYPE`] || 'dep_group';
  if (!txHash || index === undefined) return null;
  return normalizeCellDep({
    outPoint: { txHash, index },
    depType,
  });
}

function resolveSecpLockCellDep(network, body) {
  return normalizeCellDep(body?.lockCellDep)
    || getSecpLockCellDepFromEnv(network);
}

function assertValidTransferData(inputHex, outputHex) {
  const inputBytes = hexToBytes(normalizeDataHex(inputHex));
  const outputBytes = hexToBytes(normalizeDataHex(outputHex));

  const inValidation = validateCredentialData(inputBytes);
  if (!inValidation.valid) {
    throw new Error(`Invalid input credential payload: ${inValidation.error}`);
  }
  const outValidation = validateCredentialData(outputBytes);
  if (!outValidation.valid) {
    throw new Error(`Invalid output credential payload: ${outValidation.error}`);
  }

  const inputFlag = inputBytes[0];
  if ((inputFlag & FLAG_REVOKED) !== 0) {
    throw new Error('Transfer from revoked credential is not allowed.');
  }

  if (inputBytes.length !== outputBytes.length) {
    throw new Error('Transfer payload mismatch: input/output length differs.');
  }

  for (let i = 1; i < inputBytes.length; i += 1) {
    if (inputBytes[i] !== outputBytes[i]) {
      throw new Error('Transfer payload mismatch: only the flag byte can differ.');
    }
  }
}

function toPathWithoutQuery(pathname) {
  return String(pathname || '').replace(/\/+$/, '') || '/';
}

function parseTxSkeleton(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Body must be a JSON object');
  }

  const direct =
    payload.txSkeleton
    ?? payload.tx_skeleton
    ?? payload.template
    ?? payload.transactionSkeleton
    ?? payload.transaction_skeleton;

  if (direct && typeof direct === 'object') return direct;
  throw new Error('Missing txSkeleton in request body.');
}

function writeU32LE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

function normalizeHexEven(hex, fieldName = 'hex') {
  const clean = normalizeDataHex(hex);
  const raw = clean.slice(2);
  if (raw.length % 2 !== 0) throw new Error(`Invalid ${fieldName}: odd hex length.`);
  return clean;
}

function serializeBytes(hex) {
  const clean = normalizeHexEven(hex, 'bytes');
  const raw = Buffer.from(clean.slice(2), 'hex');
  return Buffer.concat([writeU32LE(raw.length), raw]);
}

function serializeBytesOpt(hexOrNull) {
  if (hexOrNull === null || hexOrNull === undefined) return Buffer.alloc(0);
  const clean = normalizeHexEven(hexOrNull, 'bytesOpt');
  if (clean === '0x') return Buffer.alloc(0);
  return serializeBytes(clean);
}

function buildWitnessArgsHex(lockHex, inputTypeHex = null, outputTypeHex = null) {
  const lock = serializeBytesOpt(lockHex);
  const inputType = serializeBytesOpt(inputTypeHex);
  const outputType = serializeBytesOpt(outputTypeHex);

  const headerSize = 16;
  const offsetLock = headerSize;
  const offsetInputType = offsetLock + lock.length;
  const offsetOutputType = offsetInputType + inputType.length;
  const totalSize = headerSize + lock.length + inputType.length + outputType.length;

  const table = Buffer.concat([
    writeU32LE(totalSize),
    writeU32LE(offsetLock),
    writeU32LE(offsetInputType),
    writeU32LE(offsetOutputType),
    lock,
    inputType,
    outputType,
  ]);

  return `0x${table.toString('hex')}`;
}

function withAttachedSignatures(templateTx, signatures) {
  const tx = {
    ...templateTx,
    witnesses: Array.isArray(templateTx.witnesses) ? [...templateTx.witnesses] : [],
  };

  if (!Array.isArray(signatures) || signatures.length === 0) return tx;

  for (const item of signatures) {
    const index = Number(item?.index);
    if (!Number.isInteger(index) || index < 0 || index >= tx.inputs.length) {
      throw new Error(`Invalid signature index: ${item?.index}`);
    }
    const sig = normalizeHexEven(item?.signature, 'signature');
    if (tx.witnesses.length <= index) {
      tx.witnesses.length = index + 1;
    }
    tx.witnesses[index] = buildWitnessArgsHex(sig);
  }

  while (tx.witnesses.length < tx.inputs.length) {
    tx.witnesses.push('0x');
  }

  return tx;
}

async function buildNdcpIssueTemplate(req, body, network) {
  requireDevnet(network);
  const rpcUrl = getRpcUrl(network);

  const ndcpInfo = getContractInfo(network, 'ndcp');
  if (!ndcpInfo) {
    throw new Error(`No ndcp deployment metadata found for ${network}.`);
  }
  // Ensure ndcp code deps are still live before building skeletons.
  for (const dep of ndcpInfo.cellDeps || []) {
    const outPoint = normalizeCellDep(dep)?.cellDep?.outPoint;
    if (!outPoint?.txHash || outPoint.index === undefined || outPoint.index === null) continue;
    const live = await rpcCall(
      rpcUrl,
      'get_live_cell',
      [{ tx_hash: outPoint.txHash, index: toHexQuantity(outPoint.index) }, false],
    );
    if (live?.status !== 'live') {
      throw new Error(`Stale NDCP cell dep outpoint: ${outPoint.txHash}:${toHexQuantity(outPoint.index)} status=${live?.status || 'unknown'}`);
    }
  }

  const payloadHex = normalizeDataHex(body.credentialDataHex || body.dataHex || '');
  const dataBytes = hexToBytes(payloadHex);
  const validation = validateCredentialData(dataBytes);
  if (!validation.valid) {
    throw new Error(`Invalid credential payload: ${validation.error}`);
  }

  const orgAuth = tryGetOrgAuth(req);
  const orgIssuerLockArg = orgAuth?.org?.issuerLockArg || null;
  const outputLock = normalizeLockForTemplate(
    body.lock,
    body.lockArgs || orgIssuerLockArg || DEFAULT_ISSUER_LOCK_ARG,
  );
  const fundingLock = normalizeLockForTemplate(
    body.fundingLock || body.fromLock,
    body.fundingLockArg || body.fromLockArg || pick(outputLock, 'args') || orgIssuerLockArg || DEFAULT_ISSUER_LOCK_ARG,
  );
  const fundingUsesSecp =
    compareHash(fundingLock.codeHash, SECP256K1_CODE_HASH)
    && String(fundingLock.hashType || '').toLowerCase() === SECP256K1_HASH_TYPE;
  const secpLockCellDep = fundingUsesSecp ? resolveSecpLockCellDep(network, body) : null;
  if (fundingUsesSecp && !secpLockCellDep) {
    throw new Error(
      `Missing secp256k1 lock cell dep for ${network}. Provide lockCellDep in request, or set CKB_SECP256K1_CELL_DEP_${network.toUpperCase()}_TX_HASH/INDEX/DEP_TYPE.`,
    );
  }

  const requestedOutputCapacity = body.capacity !== undefined && body.capacity !== null
    ? toBigIntQuantity(toHexQuantity(body.capacity), 'capacity')
    : null;
  const typeArgs = normalizeDataHex(body.typeArgs || '0x');
  const outputTypeScript = {
    codeHash: ndcpInfo.codeHash,
    hashType: ndcpInfo.hashType,
    args: typeArgs,
  };
  const minimalOutputCapacity = computeMinimalCellCapacity(outputLock, outputTypeScript, payloadHex);
  const outputCapacity = requestedOutputCapacity === null
    ? minimalOutputCapacity
    : (requestedOutputCapacity < minimalOutputCapacity ? minimalOutputCapacity : requestedOutputCapacity);
  const capacity = toHexQuantity(outputCapacity);
  const requestedFee = toBigIntQuantity(body.fee || toHexQuantity(DEFAULT_TX_FEE), 'fee');
  const requiredCapacity = outputCapacity + requestedFee;

  let selectedInputs = Array.isArray(body.inputs) ? body.inputs : null;
  let selectedTotal = null;
  let usedLiveCells = [];

  if (!selectedInputs) {
    const maxInputs = Number(body.maxInputs || 32);
    const collected = await collectLiveCellsByLock(
      rpcUrl,
      fundingLock,
      requiredCapacity,
      maxInputs,
    );
    selectedInputs = collected.inputs.map((input) => ({
      previousOutput: input.previousOutput,
      since: input.since,
    }));
    selectedTotal = collected.totalCapacity;
    usedLiveCells = collected.inputs.map((input) => ({
      txHash: input.previousOutput.txHash,
      index: input.previousOutput.index,
      capacity: toHexQuantity(input.capacity),
    }));

    if (selectedTotal < requiredCapacity) {
      throw new Error(
        `Not enough live capacity to build issue transaction. required=${toHexQuantity(requiredCapacity)} available=${toHexQuantity(selectedTotal)}`,
      );
    }
  }

  const outputs = [
    {
      capacity,
      lock: outputLock,
      type: {
        codeHash: ndcpInfo.codeHash,
        hashType: ndcpInfo.hashType,
        args: typeArgs,
      },
    },
  ];
  const outputsData = [payloadHex];

  let effectiveFee = requestedFee;
  if (selectedTotal !== null) {
    const tentativeChange = selectedTotal - requiredCapacity;
    if (tentativeChange >= MIN_SECP_CHANGE_CAPACITY) {
      outputs.push({
        capacity: toHexQuantity(tentativeChange),
        lock: fundingLock,
        type: null,
      });
      outputsData.push('0x');
    } else if (tentativeChange > 0n) {
      effectiveFee += tentativeChange;
    }
  }

  const witnesses =
    body.witnesses || Array.from({ length: selectedInputs.length }, () => '0x');
  const expiresAt = body.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const template = {
    version: '0x0',
    cellDeps: mergeUniqueCellDeps(
      secpLockCellDep ? [secpLockCellDep] : [],
      ndcpInfo.cellDeps,
    ),
    headerDeps: [],
    inputs: selectedInputs,
    outputs,
    outputsData,
    witnesses,
      metadata: {
        fundingLock,
        requestedOutputCapacity: requestedOutputCapacity === null ? null : toHexQuantity(requestedOutputCapacity),
        minimalOutputCapacity: toHexQuantity(minimalOutputCapacity),
        enforcedOutputCapacity: toHexQuantity(outputCapacity),
        fee: toHexQuantity(effectiveFee),
        requestedFee: toHexQuantity(requestedFee),
      inputCapacity: selectedTotal !== null ? toHexQuantity(selectedTotal) : null,
      autoCollectedInputs: !Array.isArray(body.inputs),
      usedLiveCells,
      expiresAt,
    },
  };

  return { network, template };
}

async function buildContractDeploymentTemplate(body, network) {
  const rpcUrl = getRpcUrl(network);
  const contractName = asTrimmedString(body.contractName || 'ndcp') || 'ndcp';
  const { binaryPath, bytes } = readContractBinary(contractName);
  const dataHex = bytesToHex(bytes);
  const codeHash = computeCkbDataHashHex(bytes);

  const fundingLock = normalizeLockForTemplate(
    body.fundingLock || body.lock || body.fromLock,
    body.fundingLockArg || body.lockArgs || body.fromLockArg || DEFAULT_ISSUER_LOCK_ARG,
  );
  const outputLock = normalizeLockForTemplate(
    body.outputLock || body.contractLock || body.lock,
    pick(fundingLock, 'args') || DEFAULT_ISSUER_LOCK_ARG,
  );
  const fundingUsesSecp =
    compareHash(fundingLock.codeHash, SECP256K1_CODE_HASH)
    && String(fundingLock.hashType || '').toLowerCase() === SECP256K1_HASH_TYPE;
  const secpLockCellDep = fundingUsesSecp ? resolveSecpLockCellDep(network, body) : null;
  if (fundingUsesSecp && !secpLockCellDep) {
    throw new Error(
      `Missing secp256k1 lock cell dep for ${network}. Provide lockCellDep in request, or set CKB_SECP256K1_CELL_DEP_${network.toUpperCase()}_TX_HASH/INDEX/DEP_TYPE.`,
    );
  }

  const requestedOutputCapacity = body.capacity !== undefined && body.capacity !== null
    ? toBigIntQuantity(toHexQuantity(body.capacity), 'capacity')
    : null;
  const minimalOutputCapacity = computeMinimalCellCapacity(outputLock, null, dataHex);
  const outputCapacity = requestedOutputCapacity === null
    ? minimalOutputCapacity
    : (requestedOutputCapacity < minimalOutputCapacity ? minimalOutputCapacity : requestedOutputCapacity);
  const requestedFee = toBigIntQuantity(body.fee || toHexQuantity(DEFAULT_TX_FEE), 'fee');
  const requiredCapacity = outputCapacity + requestedFee;

  let selectedInputs = Array.isArray(body.inputs) ? body.inputs : null;
  let selectedTotal = null;
  let usedLiveCells = [];

  if (!selectedInputs) {
    const maxInputs = Number(body.maxInputs || 32);
    const collected = await collectLiveCellsByLock(rpcUrl, fundingLock, requiredCapacity, maxInputs);
    selectedInputs = collected.inputs.map((input) => ({
      previousOutput: input.previousOutput,
      since: input.since,
    }));
    selectedTotal = collected.totalCapacity;
    usedLiveCells = collected.inputs.map((input) => ({
      txHash: input.previousOutput.txHash,
      index: input.previousOutput.index,
      capacity: toHexQuantity(input.capacity),
    }));
    if (selectedTotal < requiredCapacity) {
      throw new Error(
        `Not enough live capacity to build deployment transaction. required=${toHexQuantity(requiredCapacity)} available=${toHexQuantity(selectedTotal)}`,
      );
    }
  }

  const outputs = [
    {
      capacity: toHexQuantity(outputCapacity),
      lock: outputLock,
      type: null,
    },
  ];
  const outputsData = [dataHex];

  let effectiveFee = requestedFee;
  if (selectedTotal !== null) {
    const tentativeChange = selectedTotal - requiredCapacity;
    if (tentativeChange >= MIN_SECP_CHANGE_CAPACITY) {
      outputs.push({
        capacity: toHexQuantity(tentativeChange),
        lock: fundingLock,
        type: null,
      });
      outputsData.push('0x');
    } else if (tentativeChange > 0n) {
      effectiveFee += tentativeChange;
    }
  }

  const witnesses = body.witnesses || Array.from({ length: selectedInputs.length }, () => '0x');
  const expiresAt = body.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return {
    network,
    contractName,
    codeHash,
    hashType: 'data2',
    outputIndex: 0,
    binaryPath,
    binaryBytes: bytes.length,
    txSkeleton: {
      version: '0x0',
      cellDeps: mergeUniqueCellDeps(secpLockCellDep ? [secpLockCellDep] : []),
      headerDeps: [],
      inputs: selectedInputs,
      outputs,
      outputsData,
      witnesses,
      metadata: {
        contractName,
        codeHash,
        hashType: 'data2',
        binaryPath,
        binaryBytes: bytes.length,
        fundingLock,
        outputLock,
        minimalOutputCapacity: toHexQuantity(minimalOutputCapacity),
        enforcedOutputCapacity: toHexQuantity(outputCapacity),
        requiredCapacity: toHexQuantity(requiredCapacity),
        requestedOutputCapacity: requestedOutputCapacity === null ? null : toHexQuantity(requestedOutputCapacity),
        fee: toHexQuantity(effectiveFee),
        requestedFee: toHexQuantity(requestedFee),
        inputCapacity: selectedTotal !== null ? toHexQuantity(selectedTotal) : null,
        availableCapacity: selectedTotal !== null ? toHexQuantity(selectedTotal) : null,
        shortfall: selectedTotal !== null && selectedTotal < requiredCapacity
          ? toHexQuantity(requiredCapacity - selectedTotal)
          : toHexQuantity(0),
        autoCollectedInputs: !Array.isArray(body.inputs),
        usedLiveCells,
        expiresAt,
        secpLockCellDep,
      },
    },
  };
}

async function submitTransaction(network, body, signedTxInput) {
  const rpcUrl = getRpcUrl(network);
  const enforceContract = body.enforceContract !== false;
  const outputsValidator = body.outputsValidator || 'passthrough';
  const ndcpInfo = getContractInfo(network, 'ndcp');
  validateTxShape(signedTxInput);

  if (enforceContract) {
    if (!ndcpInfo) {
      throw new Error(`Cannot enforce NDCP interaction: no deployment metadata for ${network}.`);
    }
    if (!txReferencesNdcp(signedTxInput, ndcpInfo)) {
      throw new Error('Submitted transaction does not appear to reference NDCP code hash/cell dep.');
    }
  }

  const normalizedTx = normalizeTransactionForRpc(signedTxInput);
  const spentOrMissing = await checkInputsLive(rpcUrl, normalizedTx);
  if (spentOrMissing.length > 0) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        error: 'One or more transaction inputs are not live.',
        code: 'INPUTS_NOT_LIVE',
        network,
        details: spentOrMissing,
        hint: 'Build and sign a fresh transaction using current live cells.',
      },
    };
  }

  try {
    const txHash = await rpcCall(rpcUrl, 'send_transaction', [normalizedTx, outputsValidator]);
    return {
      ok: true,
      statusCode: 200,
      payload: {
        ok: true,
        network,
        rpcUrl,
        txHash,
        outputsValidator,
      },
    };
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('ScriptNotFound') && msg.includes(SECP256K1_CODE_HASH)) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: `secp256k1 lock script cell dep is missing for ${network}. Configure lockCellDep for build-tx.`,
          code: 'MISSING_LOCK_SCRIPT_CELL_DEP',
          network,
          details: { codeHash: SECP256K1_CODE_HASH },
          hint: `Set CKB_SECP256K1_CELL_DEP_${network.toUpperCase()}_TX_HASH/INDEX/DEP_TYPE (or pass lockCellDep in /build-tx).`,
        },
      };
    }
    if (msg.includes('TransactionFailedToResolve')) {
      const parsedOutPoint = parseOutPointFromResolveError(msg);
      const depOutPoints = cellDepOutPointSet(normalizedTx);
      const isDepOutPoint = parsedOutPoint && depOutPoints.has(outPointKey(parsedOutPoint));
      if (isDepOutPoint) {
        return {
          ok: false,
          statusCode: 409,
          payload: {
            error: 'Transaction references a stale/missing cell dep on-chain.',
            code: 'STALE_CELL_DEP',
            network,
            details: [{ outPoint: parsedOutPoint, status: 'unknown' }],
            hint: 'Refresh the env-based contract metadata for the current chain (or redeploy), then rebuild and resubmit.',
          },
        };
      }
      return {
        ok: false,
        statusCode: 409,
        payload: {
          error: 'Transaction inputs could not be resolved on-chain.',
          code: 'INPUTS_NOT_LIVE',
          network,
          details: parsedOutPoint ? [{ outPoint: parsedOutPoint, status: 'unknown' }] : [],
          hint: 'Build and sign a fresh transaction using current live cells, then resubmit.',
        },
      };
    }
    throw err;
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      const network = normalizeNetwork(url.searchParams.get('network'));
      const rpcUrl = getRpcUrl(network);
      const tip = await rpcCall(rpcUrl, 'get_tip_block_number');
      sendJson(res, 200, { ok: true, network, rpcUrl, tipBlockNumber: tip });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/networks') {
      sendJson(res, 200, {
        defaultNetwork: DEFAULT_NETWORK,
        networks: {
          devnet: { rpcUrl: RPC_URLS.devnet || null, configured: Boolean(RPC_URLS.devnet) },
          testnet: { rpcUrl: RPC_URLS.testnet || null, configured: Boolean(RPC_URLS.testnet) },
          mainnet: { rpcUrl: RPC_URLS.mainnet || null, configured: Boolean(RPC_URLS.mainnet) },
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/contract/ndcp') {
      const network = normalizeNetwork(url.searchParams.get('network'));
      const info = getContractInfo(network, 'ndcp');
      if (!info) {
        sendJson(res, 404, {
          error: `No ndcp deployment metadata for ${network}.`,
          hint: 'Check deployment metadata (ndcp) or deploy ndcp for this network.',
        });
        return;
      }
      sendJson(res, 200, { network, contract: 'ndcp', info });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/portal/content/file/')) {
      const fileToken = decodeURIComponent(url.pathname.slice('/portal/content/file/'.length));
      if (!fileToken || fileToken.includes('/') || fileToken.includes('\\') || fileToken.includes('..')) {
        sendJson(res, 400, { error: 'Invalid file token.' });
        return;
      }
      try {
        const remote = await downloadContentFromSupabase(fileToken);
        res.writeHead(200, {
          'Content-Type': remote.contentType || guessMimeTypeFromName(fileToken),
          'Content-Length': remote.buffer.length,
          'Cache-Control': 'private, max-age=31536000',
        });
        res.end(remote.buffer);
        return;
      } catch (err) {
        const msg = String(err?.message || err).toLowerCase();
        if (msg.includes('not found') || msg.includes('404')) {
          sendJson(res, 404, { error: 'File not found.' });
          return;
        }
        console.error(`[server] Supabase storage download failed for ${fileToken}: ${err.message || err}`);
        sendJson(res, 502, { error: 'Failed to load file from storage.' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v/')) {
      const shareSlug = decodeURIComponent(url.pathname.slice('/v/'.length));
      const db = readPortalDb();
      const payload = resolveShareCredentialPayload(db, shareSlug);
      if (!payload) {
        sendJson(res, 404, { error: 'Share link not found.' });
        return;
      }
      const accept = String(req.headers.accept || '').toLowerCase();
      if (accept.includes('text/html')) {
        res.writeHead(302, {
          Location: `${FRONTEND_BASE_URL}/public/verify/${encodeURIComponent(shareSlug)}${url.search || ''}`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/id/')) {
      const shareSlug = decodeURIComponent(url.pathname.slice('/id/'.length));
      const db = readPortalDb();
      const payload = resolveShareCredentialPayload(db, shareSlug);
      if (!payload) {
        sendJson(res, 404, { error: 'Identity card not found.' });
        return;
      }
      const accept = String(req.headers.accept || '').toLowerCase();
      if (accept.includes('text/html')) {
        res.writeHead(302, {
          Location: `${FRONTEND_BASE_URL}/public/id/${encodeURIComponent(shareSlug)}${url.search || ''}`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/o/')) {
      const shareSlug = decodeURIComponent(url.pathname.slice('/o/'.length));
      const db = readPortalDb();
      const payload = resolveShareOrganizationPayload(db, shareSlug);
      if (!payload) {
        sendJson(res, 404, { error: 'Organization card not found.' });
        return;
      }
      const accept = String(req.headers.accept || '').toLowerCase();
      if (accept.includes('text/html')) {
        res.writeHead(302, {
          Location: `${FRONTEND_BASE_URL}/public/org/${encodeURIComponent(shareSlug)}${url.search || ''}`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/portal/auth') {
      const body = await readJsonBody(req);
      const action = String(body.action || '').toLowerCase();

      if (action === 'bind_key') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        const publicKey = asTrimmedString(body.publicKey || body.publicKeyHex).toLowerCase();
        if (!isValidPublicKeyHex(publicKey)) {
          sendJson(res, 400, { error: 'publicKey must be a compressed/uncompressed secp256k1 hex key.' });
          return;
        }
        const keyId = computePublicKeyId(publicKey);
        org.authBinding = {
          scheme: 'realta-platform-auth-v1',
          publicKey,
          keyId,
          updatedAt: nowIso(),
        };
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, {
          orgId: org.id,
          authBinding: org.authBinding,
        });
        return;
      }

      if (action === 'unbind_key') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        org.authBinding = null;
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { orgId: org.id, authBinding: null });
        return;
      }

      if (action === 'request_challenge') {
        const providerId = asTrimmedString(body.providerId);
        if (!providerId) {
          sendJson(res, 400, { error: 'providerId is required.' });
          return;
        }
        const orgId = asTrimmedString(body.orgId);
        const db = readPortalDb();
        if (orgId && !db.organizations[orgId]) {
          sendJson(res, 404, { error: 'orgId not found.' });
          return;
        }
        const challengeId = `authc_${crypto.randomUUID()}`;
        const payload = buildPlatformAuthPayload({
          challengeId,
          providerId,
          scope: asTrimmedString(body.scope || 'portal_login') || 'portal_login',
          requestRef: asTrimmedString(body.requestRef || ''),
        });
        const message = buildPlatformAuthMessage(payload);
        const digestHex = hashPlatformAuthMessageHex(message);
        db.authChallenges[challengeId] = {
          ...payload,
          digestHex,
          orgId: orgId || null,
          status: 'pending',
          createdAt: nowIso(),
          consumedAt: null,
          verifiedOrgId: null,
          verifiedKeyId: null,
        };
        writePortalDb(db);
        sendJson(res, 201, {
          challenge: {
            challengeId,
            providerId: payload.providerId,
            orgId: orgId || null,
            scope: payload.scope,
            requestRef: payload.requestRef,
            issuedAt: payload.issuedAt,
            expiresAt: payload.expiresAt,
            nonce: payload.nonce,
            message,
            digestHex,
          },
        });
        return;
      }

      if (action === 'submit_proof') {
        const challengeId = asTrimmedString(body.challengeId);
        const publicKey = asTrimmedString(body.publicKey || body.publicKeyHex).toLowerCase();
        const signature = normalizeDataHex(body.signature || body.signatureHex || '');
        if (!challengeId) {
          sendJson(res, 400, { error: 'challengeId is required.' });
          return;
        }
        if (!isValidPublicKeyHex(publicKey)) {
          sendJson(res, 400, { error: 'publicKey must be a valid secp256k1 hex key.' });
          return;
        }
        if (!/^0x[0-9a-f]+$/i.test(signature)) {
          sendJson(res, 400, { error: 'signature must be hex.' });
          return;
        }

        const db = readPortalDb();
        const challenge = db.authChallenges[challengeId];
        if (!challenge) {
          sendJson(res, 404, { error: 'challengeId not found.' });
          return;
        }
        if (challenge.status !== 'pending') {
          sendJson(res, 409, { error: 'challenge already used.' });
          return;
        }
        if (isChallengeExpired(challenge)) {
          challenge.status = 'expired';
          challenge.consumedAt = nowIso();
          db.authChallenges[challengeId] = challenge;
          writePortalDb(db);
          sendJson(res, 409, { error: 'challenge expired.' });
          return;
        }

        const message = buildPlatformAuthMessage(challenge);
        const digestHex = hashPlatformAuthMessageHex(message);
        if (String(challenge.digestHex || '').toLowerCase() !== String(digestHex).toLowerCase()) {
          sendJson(res, 400, { error: 'challenge digest mismatch.' });
          return;
        }

        const valid = verifyPlatformAuthSignature({
          digestHex,
          signatureHex: signature,
          publicKeyHex: publicKey,
        });
        if (!valid) {
          sendJson(res, 401, { error: 'invalid signature for challenge.' });
          return;
        }

        const keyId = computePublicKeyId(publicKey);
        const orgCandidates = findOrganizationsByAuthKeyId(db, keyId)
          .filter((org) => (org.status || 'active') !== 'delisted');
        const matchedOrg = challenge.orgId
          ? orgCandidates.find((org) => org.id === challenge.orgId)
          : orgCandidates[0];

        if (!matchedOrg) {
          sendJson(res, 404, { error: 'No active user binding found for this key.' });
          return;
        }

        challenge.status = 'verified';
        challenge.consumedAt = nowIso();
        challenge.verifiedOrgId = matchedOrg.id;
        challenge.verifiedKeyId = keyId;
        challenge.publicKey = publicKey;
        challenge.signature = signature;
        db.authChallenges[challengeId] = challenge;
        writePortalDb(db);

        sendJson(res, 200, {
          ok: true,
          providerId: challenge.providerId,
          challengeId,
          verifiedAt: challenge.consumedAt,
          subject: {
            orgId: matchedOrg.id,
            name: matchedOrg.name,
            entityType: matchedOrg.entityType || 'organization',
            walletAddress: matchedOrg.walletAddress,
            status: matchedOrg.status || 'active',
            contactEmail: matchedOrg.contactEmail || null,
            trust: computeTrustLevel(matchedOrg),
          },
          proof: {
            scheme: 'realta-platform-auth-v1',
            keyId,
            digestHex,
          },
        });
        return;
      }

      sendJson(res, 400, {
        error: 'Invalid auth action.',
        supported: ['bind_key', 'unbind_key', 'request_challenge', 'submit_proof'],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/portal/issuance-session') {
      const body = await readJsonBody(req);
      const action = String(body.action || '').toLowerCase();

      if (action === 'create') {
        const { db, org } = getOrgAuth(req);
        const credentialType = asTrimmedString(body.credentialType || 'authenticity') || 'authenticity';
        const credentialTitle = asTrimmedString(body.credentialTitle || '');
        const note = asTrimmedString(body.note || '');
        const ttlMinutesRaw = Number(body.ttlMinutes || 15);
        const ttlMinutes = Number.isFinite(ttlMinutesRaw)
          ? Math.min(120, Math.max(5, Math.round(ttlMinutesRaw)))
          : 15;
        const now = Date.now();
        const sessionId = `isess_${crypto.randomUUID()}`;
        const token = crypto.randomBytes(18).toString('hex');
        const expiresAt = new Date(now + ttlMinutes * 60 * 1000).toISOString();
        db.issuanceSessions[sessionId] = {
          id: sessionId,
          token,
          orgId: org.id,
          orgName: org.name,
          credentialType,
          credentialTitle: credentialTitle || null,
          note: note || null,
          status: 'pending',
          nonce: crypto.randomBytes(12).toString('hex'),
          createdAt: nowIso(),
          expiresAt,
          updatedAt: nowIso(),
          userSubmission: null,
        };
        writePortalDb(db);
        const sessionUrl = `${FRONTEND_BASE_URL}/session/${token}`;
        sendJson(res, 201, { session: db.issuanceSessions[sessionId], sessionUrl });
        return;
      }

      if (action === 'list') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        const includeExpired = body.includeExpired === true;
        const nowMs = Date.now();
        let changed = false;
        for (const session of Object.values(db.issuanceSessions || {})) {
          if (session?.orgId !== org.id) continue;
          if (maybeExpireIssuanceSession(session, nowMs)) changed = true;
        }
        if (changed) writePortalDb(db);
        const sessions = Object.values(db.issuanceSessions || {})
          .filter((session) => session?.orgId === org.id)
          .filter((session) => includeExpired || String(session?.status || '').toLowerCase() !== 'expired')
          .sort((a, b) => new Date(String(b?.createdAt || 0)).getTime() - new Date(String(a?.createdAt || 0)).getTime());
        sendJson(res, 200, { sessions });
        return;
      }

      if (action === 'get') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        const sessionId = asTrimmedString(body.sessionId);
        const session = db.issuanceSessions[sessionId];
        if (!session || session.orgId !== org.id) {
          sendJson(res, 404, { error: 'session not found.' });
          return;
        }
        sendJson(res, 200, { session });
        return;
      }

      if (action === 'get_public') {
        const db = readPortalDb();
        const token = asTrimmedString(body.token);
        const session = findIssuanceSessionByToken(db, token);
        if (!session) {
          sendJson(res, 404, { error: 'session not found.' });
          return;
        }
        const expired = maybeExpireIssuanceSession(session, Date.now());
        if (expired) {
          db.issuanceSessions[session.id] = session;
          writePortalDb(db);
        }
        const publicStatus = expired ? 'expired' : session.status;
        sendJson(res, 200, {
          session: {
            id: session.id,
            orgId: session.orgId,
            orgName: session.orgName || null,
            credentialType: session.credentialType,
            credentialTitle: session.credentialTitle,
            note: session.note,
            nonce: session.nonce,
            status: publicStatus,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        });
        return;
      }

      if (action === 'submit_user') {
        const db = readPortalDb();
        const token = asTrimmedString(body.token);
        const session = findIssuanceSessionByToken(db, token);
        if (!session) {
          sendJson(res, 404, { error: 'session not found.' });
          return;
        }
        const nowMs = Date.now();
        const expired = nowMs > Date.parse(String(session.expiresAt || ''));
        if (expired) {
          session.status = 'expired';
          session.updatedAt = nowIso();
          db.issuanceSessions[session.id] = session;
          writePortalDb(db);
          sendJson(res, 409, { error: 'session expired.' });
          return;
        }
        if (session.status === 'submitted') {
          sendJson(res, 409, { error: 'session already completed.' });
          return;
        }
        const walletAddress = asTrimmedString(body.walletAddress);
        const publicKey = asTrimmedString(body.publicKey || body.publicKeyHex).toLowerCase();
        const signature = normalizeDataHex(body.signature || body.signatureHex || '');
        const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
        const fullName = asTrimmedString(profile.fullName || body.fullName);
        const email = asTrimmedString(profile.email || body.email);
        const reference = asTrimmedString(profile.reference || body.reference);
        const issuedAt = asTrimmedString(body.issuedAt || nowIso());

        if (!walletAddress) {
          sendJson(res, 400, { error: 'walletAddress is required.' });
          return;
        }
        if (!isValidPublicKeyHex(publicKey)) {
          sendJson(res, 400, { error: 'publicKey must be a valid secp256k1 key.' });
          return;
        }
        if (!/^0x[0-9a-f]+$/i.test(signature)) {
          sendJson(res, 400, { error: 'signature must be hex.' });
          return;
        }
        if (!fullName) {
          sendJson(res, 400, { error: 'profile.fullName is required.' });
          return;
        }

        const claimPayload = {
          sessionId: session.id,
          orgId: session.orgId,
          credentialType: session.credentialType,
          nonce: session.nonce,
          walletAddress,
          fullName,
          email,
          reference,
          issuedAt,
        };
        const message = buildIssuanceClaimMessage(claimPayload);
        const digestHex = hashPlatformAuthMessageHex(message);
        const valid = verifyPlatformAuthSignature({
          digestHex,
          signatureHex: signature,
          publicKeyHex: publicKey,
        });
        if (!valid) {
          sendJson(res, 401, { error: 'invalid signature for issuance claim.' });
          return;
        }

        session.status = 'submitted';
        session.updatedAt = nowIso();
        session.userSubmission = {
          walletAddress,
          publicKey,
          keyId: computePublicKeyId(publicKey),
          profile: {
            fullName,
            email: email || null,
            reference: reference || null,
          },
          message,
          digestHex,
          signature,
          submittedAt: nowIso(),
        };
        db.issuanceSessions[session.id] = session;
        writePortalDb(db);
        sendJson(res, 200, {
          ok: true,
          sessionId: session.id,
          status: session.status,
          orgId: session.orgId,
        });
        return;
      }

      sendJson(res, 400, {
        error: 'Invalid issuance-session action.',
        supported: ['create', 'list', 'get', 'get_public', 'submit_user'],
      });
      return;
    }

    // Grouped API surface (recommended)
    if (req.method === 'POST' && url.pathname === '/portal/org') {
      const body = await readJsonBody(req);
      const action = String(body.action || '').toLowerCase();

      if (action === 'register') {
        const entityType = normalizeEntityType(body.entityType);
        const profile = buildProfileFromBody(body);
        if (entityType === 'organization' && !asTrimmedString(profile.registrationNumber)) {
          profile.registrationNumber = generateRegistrationNumber();
        }
        const derivedDisplayName =
          entityType === 'individual'
            ? asTrimmedString(body.name || `${profile.firstName} ${profile.lastName}`.trim())
            : asTrimmedString(body.name || profile.legalName);
        const name = derivedDisplayName;
        const walletAddress = asTrimmedString(body.walletAddress);
        if (!name) {
          sendJson(res, 400, { error: 'name is required.' });
          return;
        }
        if (!walletAddress) {
          sendJson(res, 400, { error: 'walletAddress is required.' });
          return;
        }
        const db = readPortalDb();
        const orgId = `org_${crypto.randomUUID()}`;
        const apiKey = `orgsk_${crypto.randomUUID().replace(/-/g, '')}`;
        const issuerLockArg = body.issuerLockArg ? normalizeDataHex(body.issuerLockArg) : null;
        db.organizations[orgId] = {
          id: orgId,
          apiKey,
          status: 'active',
          delistedAt: null,
          entityType,
          name,
          walletAddress,
          issuerLockArg,
          contactEmail: asNullableTrimmedString(body.contactEmail),
          profile,
          verification: {
            twitter: { status: 'unverified', updatedAt: null },
            website: { status: 'unverified', updatedAt: null },
            kyc: { status: 'unverified', updatedAt: null, submissionId: null },
          },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        writePortalDb(db);
        sendJson(res, 201, { organization: db.organizations[orgId], auth: { orgId, apiKey } });
        return;
      }

      if (action === 'update' || action === 'profile') {
        const { db, org } = getOrgAuth(req);
        if (org.profileLockedAt) {
          sendJson(res, 423, { error: 'Profile is locked and can no longer be edited.' });
          return;
        }
        if (body.name !== undefined) org.name = asTrimmedString(body.name);
        if (body.contactEmail !== undefined) org.contactEmail = asNullableTrimmedString(body.contactEmail);
        if (body.issuerLockArg) org.issuerLockArg = normalizeDataHex(body.issuerLockArg);
        org.profile = buildProfileFromBody(body, org.profile || {});
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { organization: org, trust: computeTrustLevel(org) });
        return;
      }

      if (action === 'delist') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        if (org.status === 'delisted') {
          sendJson(res, 200, { organization: org, trust: computeTrustLevel(org) });
          return;
        }
        org.status = 'delisted';
        org.delistedAt = nowIso();
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { organization: org, trust: computeTrustLevel(org) });
        return;
      }

      if (action === 'relist') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        org.status = 'active';
        org.delistedAt = null;
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { organization: org, trust: computeTrustLevel(org) });
        return;
      }

      if (action === 'get' || action === 'trust') {
        const db = readPortalDb();
        const orgId = String(body.orgId || '');
        const normalized = normalizeOrganizationRecord(db.organizations[orgId]);
        const org = normalized.org;
        if (!org) {
          sendJson(res, 404, { error: 'Organization not found.' });
          return;
        }
        if (normalized.changed) {
          db.organizations[orgId] = org;
          writePortalDb(db);
        }
        if (action === 'trust') {
          sendJson(res, 200, { orgId, trust: computeTrustLevel(org), verification: org.verification });
          return;
        }
        const publicOrg = { ...org };
        delete publicOrg.apiKey;
        sendJson(res, 200, { organization: publicOrg, trust: computeTrustLevel(org) });
        return;
      }

      if (action === 'share_link') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        let shareSlug = findOrganizationShareSlug(db, org.id);
        if (!shareSlug) {
          shareSlug = asTrimmedString(body.shareSlug || '') || crypto.randomBytes(6).toString('hex');
          db.orgShareLinks[shareSlug] = org.id;
          writePortalDb(db);
        }
        const publicBase = requestBaseUrl(req);
        const shareUrl = `${publicBase}/o/${shareSlug}`;
        const embedUrl = `${publicBase}/o/${shareSlug}?embed=1`;
        sendJson(res, 200, {
          orgId: org.id,
          shareSlug,
          shareUrl,
          embedUrl,
          iframeCode: buildIframeCode(embedUrl, 420, 260),
          frontendUrl: `${FRONTEND_BASE_URL}/public/org/${shareSlug}`,
        });
        return;
      }

      if (action === 'share_get') {
        const db = readPortalDb();
        const slug = asTrimmedString(body.shareSlug || '');
        const payload = resolveShareOrganizationPayload(db, slug);
        if (!payload) {
          sendJson(res, 404, { error: 'Organization share link not found.' });
          return;
        }
        sendJson(res, 200, payload);
        return;
      }

      if (action === 'list_by_wallet') {
        const walletAddress = String(body.walletAddress || '').trim();
        const includeDelisted = body.includeDelisted === true;
        if (!walletAddress) {
          sendJson(res, 400, { error: 'walletAddress is required.' });
          return;
        }
        const db = readPortalDb();
        let changedAny = false;
        const organizations = Object.values(db.organizations)
          .filter((org) => String(org.walletAddress || '').toLowerCase() === walletAddress.toLowerCase())
          .filter((org) => includeDelisted || String(org.status || 'active') !== 'delisted')
          .map((item) => {
            const normalized = normalizeOrganizationRecord(item);
            const org = normalized.org;
            if (normalized.changed) {
              db.organizations[org.id] = org;
              changedAny = true;
            }
            return {
              id: org.id,
              entityType: org.entityType || 'organization',
              name: org.name,
              walletAddress: org.walletAddress,
              status: org.status || 'active',
              delistedAt: org.delistedAt || null,
              authBinding: org.authBinding || null,
              contactEmail: org.contactEmail || null,
              profileLockedAt: org.profileLockedAt || null,
              profile: org.profile || {},
              verification: org.verification,
              trust: computeTrustLevel(org),
              auth: {
                orgId: org.id,
                apiKey: org.apiKey,
              },
              createdAt: org.createdAt,
              updatedAt: org.updatedAt,
            };
          });
        if (changedAny) {
          writePortalDb(db);
        }
        sendJson(res, 200, {
          walletAddress,
          count: organizations.length,
          organizations,
        });
        return;
      }

      sendJson(res, 400, {
        error: 'Invalid org action.',
        supported: ['register', 'update', 'get', 'trust', 'list_by_wallet', 'delist', 'relist', 'share_link', 'share_get'],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/portal/verification') {
      const body = await readJsonBody(req);
      const method = String(body.method || '').toLowerCase();
      const action = String(body.action || '').toLowerCase();

      if (action === 'attest_profile') {
        const { db, org } = getOrgAuth(req);
        if (org.profileLockedAt) {
          sendJson(res, 409, { error: 'Profile already verified and locked.', profileLockedAt: org.profileLockedAt });
          return;
        }
        if (body.agree !== true) {
          sendJson(res, 400, { error: 'agree=true is required.' });
          return;
        }

        const missing = getMissingRequiredProfileFields(org);
        if (missing.length > 0) {
          sendJson(res, 400, {
            error: 'Required profile fields are incomplete.',
            missing,
          });
          return;
        }

        const lockedAt = nowIso();
        org.profileLockedAt = lockedAt;
        org.verification.twitter = { status: 'verified', updatedAt: lockedAt, proof: 'profile_attestation' };
        org.verification.website = { status: 'verified', updatedAt: lockedAt, proof: 'profile_attestation' };
        org.updatedAt = lockedAt;
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, {
          orgId: org.id,
          profileLockedAt: lockedAt,
          verification: org.verification,
          trust: computeTrustLevel(org),
        });
        return;
      }

      if (method === 'twitter' && action === 'request') {
        const { db, org } = getOrgAuth(req);
        const nonce = crypto.randomBytes(8).toString('hex');
        const challenge = `Realta NDCP verification for ${org.id} nonce:${nonce}`;
        db.verifications.twitterChallenges[org.id] = { challenge, nonce, createdAt: nowIso() };
        writePortalDb(db);
        sendJson(res, 200, { orgId: org.id, challenge });
        return;
      }

      if (method === 'twitter' && action === 'confirm') {
        const { db, org } = getOrgAuth(req);
        const submittedText = String(body.postText || '');
        const challenge = db.verifications.twitterChallenges[org.id]?.challenge;
        if (!challenge) {
          sendJson(res, 400, { error: 'No twitter challenge found. Request challenge first.' });
          return;
        }
        if (!submittedText.includes(challenge)) {
          sendJson(res, 400, { error: 'Challenge text not found in submitted postText.' });
          return;
        }
        org.verification.twitter = { status: 'verified', updatedAt: nowIso(), proof: body.postUrl || null };
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { orgId: org.id, verification: org.verification, trust: computeTrustLevel(org) });
        return;
      }

      if (method === 'website' && action === 'request') {
        const { db, org } = getOrgAuth(req);
        const token = crypto.randomBytes(16).toString('hex');
        const expectedPath = '/.well-known/realta-verification.txt';
        const challenge = `realta-org=${org.id};token=${token}`;
        db.verifications.websiteChallenges[org.id] = { token, expectedPath, challenge, createdAt: nowIso() };
        writePortalDb(db);
        sendJson(res, 200, { orgId: org.id, expectedPath, challenge });
        return;
      }

      if (method === 'website' && action === 'confirm') {
        const { db, org } = getOrgAuth(req);
        const proofText = String(body.proofText || '');
        const challenge = db.verifications.websiteChallenges[org.id]?.challenge;
        if (!challenge) {
          sendJson(res, 400, { error: 'No website challenge found. Request challenge first.' });
          return;
        }
        if (!proofText.includes(challenge)) {
          sendJson(res, 400, { error: 'Challenge text not found in submitted proofText.' });
          return;
        }
        org.verification.website = { status: 'verified', updatedAt: nowIso(), proof: body.proofUrl || null };
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 200, { orgId: org.id, verification: org.verification, trust: computeTrustLevel(org) });
        return;
      }

      if (method === 'kyc' && action === 'submit') {
        if (!KYC_ENABLED) {
          sendJson(res, 503, { error: 'KYC is temporarily disabled.' });
          return;
        }
        const { db, org } = getOrgAuth(req);
        const submissionId = `kyc_${crypto.randomUUID()}`;
        db.kycSubmissions[submissionId] = {
          id: submissionId,
          orgId: org.id,
          status: 'pending',
          submittedAt: nowIso(),
          submissionFeeTxHash: body.submissionFeeTxHash || null,
          documents: body.documents || [],
          seniorStaff: body.seniorStaff || [],
          note: body.note || null,
        };
        org.verification.kyc = { status: 'pending', updatedAt: nowIso(), submissionId };
        org.updatedAt = nowIso();
        db.organizations[org.id] = org;
        writePortalDb(db);
        sendJson(res, 202, { submission: db.kycSubmissions[submissionId], trust: computeTrustLevel(org) });
        return;
      }

      if (method === 'kyc' && action === 'review') {
        if (!KYC_ENABLED) {
          sendJson(res, 503, { error: 'KYC is temporarily disabled.' });
          return;
        }
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== ADMIN_API_KEY) {
          sendJson(res, 401, { error: 'Unauthorized: invalid x-admin-key.' });
          return;
        }
        const db = readPortalDb();
        const submissionId = String(body.submissionId || '');
        const decision = String(body.decision || '').toLowerCase();
        const submission = db.kycSubmissions[submissionId];
        if (!submission) {
          sendJson(res, 404, { error: 'KYC submission not found.' });
          return;
        }
        if (!['approved', 'rejected'].includes(decision)) {
          sendJson(res, 400, { error: 'decision must be approved or rejected.' });
          return;
        }
        submission.status = decision;
        submission.reviewedAt = nowIso();
        submission.reviewNote = body.reviewNote || null;
        const org = db.organizations[submission.orgId];
        if (org) {
          org.verification.kyc = { status: decision, updatedAt: nowIso(), submissionId };
          org.updatedAt = nowIso();
          db.organizations[org.id] = org;
        }
        db.kycSubmissions[submissionId] = submission;
        writePortalDb(db);
        sendJson(res, 200, { submission, orgTrust: org ? computeTrustLevel(org) : null });
        return;
      }

      sendJson(res, 400, {
        error: 'Invalid verification method/action.',
        examples: [
          { method: 'twitter', action: 'request' },
          { method: 'twitter', action: 'confirm' },
          { method: 'website', action: 'request' },
          { method: 'website', action: 'confirm' },
          { method: 'kyc', action: 'submit' },
          { method: 'kyc', action: 'review' },
        ],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/portal/content') {
      const body = await readJsonBody(req, 30 * 1024 * 1024);
      const action = String(body.action || '').toLowerCase();
      const { db, org } = getOrgAuth(req);
      if (action === 'upload') {
        const fileName = sanitizeUploadName(body.fileName || 'document.bin');
        const mimeType = asTrimmedString(body.mimeType) || guessMimeTypeFromName(fileName);
        const fileData = decodeBase64Input(body.fileDataBase64 || body.fileData || '');
        if (fileData.length === 0) {
          sendJson(res, 400, { error: 'Uploaded file is empty.' });
          return;
        }
        const expectedHash = body.contentHash ? normalizeDataHex(body.contentHash) : null;
        const computedHash = sha256HexOfBuffer(fileData);
        if (expectedHash && !compareHash(expectedHash, computedHash)) {
          sendJson(res, 400, { error: 'Provided contentHash does not match uploaded file bytes.' });
          return;
        }
        const fileToken = `${crypto.randomUUID()}-${fileName}`;
        try {
          await uploadContentToSupabase(fileToken, fileData, mimeType);
        } catch (err) {
          console.error(`[server] Supabase storage upload failed for ${fileToken}: ${err.message || err}`);
          sendJson(res, 502, { error: 'Failed to upload file to storage.' });
          return;
        }
        const pointer = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/portal/content/file/${fileToken}`;
        const contentId = `content_${crypto.randomUUID()}`;
        db.contents[contentId] = {
          id: contentId,
          orgId: org.id,
          pointerType: 'web2',
          pointer,
          contentHash: computedHash,
          title: body.title || fileName,
          mimeType,
          fileName,
          fileSize: fileData.length,
          createdAt: nowIso(),
        };
        writePortalDb(db);
        sendJson(res, 201, { content: db.contents[contentId] });
        return;
      }

      if (action === 'publish') {
        const pointerType = String(body.pointerType || '').toLowerCase();
        if (!['ckbfs', 'ipfs', 'web2'].includes(pointerType)) {
          sendJson(res, 400, { error: 'pointerType must be one of: ckbfs, ipfs, web2.' });
          return;
        }
        const pointer = String(body.pointer || '');
        const contentHash = normalizeDataHex(body.contentHash || '');
        if (!pointer) {
          sendJson(res, 400, { error: 'pointer is required.' });
          return;
        }
        const contentId = `content_${crypto.randomUUID()}`;
        db.contents[contentId] = {
          id: contentId,
          orgId: org.id,
          pointerType,
          pointer,
          contentHash,
          title: body.title || '',
          mimeType: body.mimeType || null,
          createdAt: nowIso(),
        };
        writePortalDb(db);
        sendJson(res, 201, { content: db.contents[contentId] });
        return;
      }

      sendJson(res, 400, { error: 'Invalid content action.', supported: ['publish', 'upload'] });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/portal/credential') {
      const body = await readJsonBody(req);
      const action = String(body.action || '').toLowerCase();

      if (action === 'link_onchain') {
        const { db, org } = getOrgAuth(req);
        const network = normalizeNetwork(body.network || 'devnet');
        requireDevnet(network);
        const rpcUrl = getRpcUrl(network);
        const ndcpInfo = getContractInfo(network, 'ndcp');
        if (!ndcpInfo) {
          sendJson(res, 404, { error: 'No ndcp deployment metadata for devnet.' });
          return;
        }
        const outPoint = body.ndcpOutPoint || {
          txHash: body.txHash,
          index: body.index,
        };
        if (!outPoint?.txHash || outPoint.index === undefined || outPoint.index === null) {
          sendJson(res, 400, { error: 'ndcpOutPoint { txHash, index } (or txHash + index) is required.' });
          return;
        }
        const index = toHexQuantity(outPoint.index);
        const cell = await rpcCall(rpcUrl, 'get_live_cell', [{ tx_hash: outPoint.txHash, index }, true]);
        if (cell?.status !== 'live') {
          sendJson(res, 400, { error: `Target cell is not live (status=${cell?.status || 'unknown'}).` });
          return;
        }
        const output = cell?.cell?.output;
        const typeScript = rpcScriptToCamel(output?.type);
        if (!matchesNdcpContractInfo(typeScript, ndcpInfo)) {
          sendJson(res, 400, { error: 'Target cell is not an NDCP type-script cell.' });
          return;
        }
        const dataHex = cell?.cell?.data?.content || '0x';
        const { parsed, revoked } = parseCredentialStateFromDataHex(dataHex);
        const trust = computeTrustLevel(org);
        if (trust.score === 0) {
          sendJson(res, 400, { error: 'Issuer organization is unverified. Complete at least one verification level first.' });
          return;
        }
        if (org.issuerLockArg && parsed.issuerLockArg && !compareHash(org.issuerLockArg, parsed.issuerLockArg)) {
          sendJson(res, 400, { error: 'On-chain issuerLockArg does not match organization issuerLockArg.' });
          return;
        }
        if (body.contentId) {
          const content = db.contents[body.contentId];
          if (!content) {
            sendJson(res, 404, { error: 'contentId not found.' });
            return;
          }
          if (!compareHash(content.contentHash, parsed.contentHash)) {
            sendJson(res, 400, { error: 'On-chain contentHash does not match selected content record.' });
            return;
          }
        }
        const issuanceSessionId = asTrimmedString(body.issuanceSessionId);
        if (!issuanceSessionId) {
          sendJson(res, 400, { error: 'issuanceSessionId is required. User identity must come from signed session submission.' });
          return;
        }
        const issuanceSession = db.issuanceSessions?.[issuanceSessionId];
        if (!issuanceSession) {
          sendJson(res, 404, { error: 'issuanceSessionId not found.' });
          return;
        }
        if (issuanceSession.orgId !== org.id) {
          sendJson(res, 403, { error: 'Issuance session does not belong to this organization.' });
          return;
        }
        if (issuanceSession.status !== 'submitted') {
          sendJson(res, 409, { error: 'Issuance session is not ready. User must submit signed identity first.' });
          return;
        }
        if (Date.now() > Date.parse(String(issuanceSession.expiresAt || ''))) {
          sendJson(res, 409, { error: 'Issuance session has expired.' });
          return;
        }
        const claimant = issuanceSession.userSubmission?.profile || {};
        if (!asTrimmedString(claimant.fullName)) {
          sendJson(res, 400, { error: 'Issuance session submission is missing user fullName.' });
          return;
        }
        const credentialId = body.credentialId || `cred_${crypto.randomUUID()}`;
        const shareSlug = body.shareSlug || crypto.randomBytes(6).toString('hex');
        db.credentials[credentialId] = {
          id: credentialId,
          orgId: org.id,
          network,
          title: body.title || 'Credential',
          recipientDisplayName: claimant.fullName || null,
          recipientReference: claimant.reference || issuanceSession.userSubmission?.walletAddress || null,
          ndcpOutPoint: { txHash: outPoint.txHash, index },
          onChain: {
            issuerLockArg: parsed.issuerLockArg,
            recipientLockArg: parsed.recipientLockArg,
            contentHash: parsed.contentHash,
            ckbfsPointer: parsed.ckbfsPointer,
            ndcpCodeHash: ndcpInfo.codeHash,
            ndcpHashType: ndcpInfo.hashType,
            issuedAt: parsed.issuedAt,
            expiresAt: parsed.expiresAt ?? null,
            flag: parsed.flag,
            revoked,
          },
          contentId: body.contentId || null,
          issuanceSessionId,
          claimant: {
            walletAddress: issuanceSession.userSubmission?.walletAddress || null,
            fullName: claimant.fullName || null,
            email: claimant.email || null,
            reference: claimant.reference || null,
            keyId: issuanceSession.userSubmission?.keyId || null,
          },
          status: revoked ? 'revoked' : 'issued',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        issuanceSession.status = 'issued';
        issuanceSession.linkedCredentialId = credentialId;
        issuanceSession.updatedAt = nowIso();
        db.issuanceSessions[issuanceSession.id] = issuanceSession;
        db.shareLinks[shareSlug] = credentialId;
        writePortalDb(db);
        sendJson(res, 201, {
          credential: db.credentials[credentialId],
          shareUrl: `${FRONTEND_BASE_URL}/v/${shareSlug}`,
        });
        return;
      }

      if (action === 'revoke_record') {
        const { db, org } = getOrgAuth(req);
        const credential = db.credentials[String(body.credentialId || '')];
        if (!credential) {
          sendJson(res, 404, { error: 'credentialId not found.' });
          return;
        }
        if (credential.orgId !== org.id) {
          sendJson(res, 403, { error: 'Credential does not belong to this organization.' });
          return;
        }
        credential.status = 'revoked';
        credential.revokedAt = nowIso();
        credential.revokeTxHash = body.revokeTxHash || null;
        credential.updatedAt = nowIso();
        db.credentials[credential.id] = credential;
        writePortalDb(db);
        sendJson(res, 200, { credential });
        return;
      }

      if (action === 'delist_record') {
        const { db, org } = getOrgAuth(req);
        const credential = db.credentials[String(body.credentialId || '')];
        if (!credential) {
          sendJson(res, 404, { error: 'credentialId not found.' });
          return;
        }
        if (credential.orgId !== org.id) {
          sendJson(res, 403, { error: 'Credential does not belong to this organization.' });
          return;
        }
        credential.status = 'delisted';
        credential.delistedAt = nowIso();
        credential.updatedAt = nowIso();
        db.credentials[credential.id] = credential;
        writePortalDb(db);
        sendJson(res, 200, { credential });
        return;
      }

      if (action === 'undelist_record') {
        const { db, org } = getOrgAuth(req);
        const credential = db.credentials[String(body.credentialId || '')];
        if (!credential) {
          sendJson(res, 404, { error: 'credentialId not found.' });
          return;
        }
        if (credential.orgId !== org.id) {
          sendJson(res, 403, { error: 'Credential does not belong to this organization.' });
          return;
        }
        credential.status = credential?.onChain?.revoked ? 'revoked' : 'issued';
        credential.delistedAt = null;
        credential.updatedAt = nowIso();
        db.credentials[credential.id] = credential;
        writePortalDb(db);
        sendJson(res, 200, { credential });
        return;
      }

      if (action === 'list') {
        const { db, org } = getOrgAuth(req);
        const includeDelisted = body.includeDelisted === true;
        const credentials = Object.values(db.credentials || {})
          .filter((credential) => credential?.orgId === org.id)
          .filter((credential) => includeDelisted || String(credential?.status || '') !== 'delisted')
          .sort((a, b) => {
            const at = new Date(String(a?.createdAt || 0)).getTime();
            const bt = new Date(String(b?.createdAt || 0)).getTime();
            return bt - at;
          });
        sendJson(res, 200, { credentials });
        return;
      }

      if (action === 'get') {
        const db = readPortalDb();
        const credential = db.credentials[String(body.credentialId || '')];
        if (!credential) {
          sendJson(res, 404, { error: 'Credential not found.' });
          return;
        }
        if (String(credential.status || '') === 'delisted') {
          sendJson(res, 404, { error: 'Credential not found.' });
          return;
        }
        const org = db.organizations[credential.orgId];
        const issuer = org ? { id: org.id, name: org.name, website: org.profile?.website || '' } : null;
        sendJson(res, 200, { credential, issuer, issuerTrust: org ? computeTrustLevel(org) : null });
        return;
      }

      if (action === 'share_get') {
        const db = readPortalDb();
        const slug = String(body.shareSlug || '');
        const payload = resolveShareCredentialPayload(db, slug);
        if (!payload) {
          sendJson(res, 404, { error: 'Share link not found.' });
          return;
        }
        sendJson(res, 200, payload);
        return;
      }

      if (action === 'share_link') {
        const { db, org } = getOrgAuth(req, { allowDelisted: true });
        const credentialId = asTrimmedString(body.credentialId);
        if (!credentialId) {
          sendJson(res, 400, { error: 'credentialId is required.' });
          return;
        }
        const credential = db.credentials[credentialId];
        if (!credential) {
          sendJson(res, 404, { error: 'Credential not found.' });
          return;
        }
        if (String(credential.orgId) !== String(org.id)) {
          sendJson(res, 403, { error: 'Credential does not belong to this organization.' });
          return;
        }
        let shareSlug = findCredentialShareSlug(db, credentialId);
        if (!shareSlug) {
          shareSlug = asTrimmedString(body.shareSlug || '') || crypto.randomBytes(6).toString('hex');
          db.shareLinks[shareSlug] = credentialId;
          writePortalDb(db);
        }
        const publicBase = requestBaseUrl(req);
        const shareUrl = `${publicBase}/id/${shareSlug}`;
        const embedUrl = `${publicBase}/id/${shareSlug}?embed=1`;
        sendJson(res, 200, {
          credentialId,
          shareSlug,
          shareUrl,
          embedUrl,
          iframeCode: buildIframeCode(embedUrl, 420, 280),
          verifyUrl: `${publicBase}/v/${shareSlug}`,
          frontendIdentityUrl: `${FRONTEND_BASE_URL}/public/id/${shareSlug}`,
        });
        return;
      }

      sendJson(res, 400, {
        error: 'Invalid credential action.',
        supported: ['link_onchain', 'revoke_record', 'delist_record', 'undelist_record', 'list', 'get', 'share_get', 'share_link'],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/issue/payload') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      requireDevnet(network);

      const contentHash = normalizeDataHex(body.contentHash || `0x${'a1'.repeat(32)}`);
      const ckbfsPointer = normalizeDataHex(body.ckbfsPointer || `0x${'b2'.repeat(32)}`);
      const issuerLockArg = normalizeDataHex(body.issuerLockArg || DEFAULT_ISSUER_LOCK_ARG);
      const recipientLockArg = normalizeDataHex(body.recipientLockArg || DEFAULT_RECIPIENT_LOCK_ARG);
      const verificationDataHex = body.verificationDataHex ? normalizeDataHex(body.verificationDataHex) : '0x';
      const verificationData = hexToBytes(verificationDataHex);
      const expiresAt = body.expiresAt ?? undefined;

      const credential = createCredential(
        contentHash,
        ckbfsPointer,
        issuerLockArg,
        recipientLockArg,
        verificationData,
        expiresAt,
      );
      if (body.issuedAt !== undefined) {
        credential.issuedAt = body.issuedAt;
      }

      const data = serializeCredential(credential);
      const validation = validateCredentialData(data);
      if (!validation.valid) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      sendJson(res, 200, {
        network,
        credential,
        dataHex: bytesToHex(data),
        dataLength: data.length,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/revoke/payload') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      requireDevnet(network);

      const dataHex = normalizeDataHex(body.credentialDataHex || body.dataHex || '');
      const parsed = deserializeCredential(hexToBytes(dataHex));
      const revoked = revokeCredential(parsed);
      const revokedData = serializeCredential(revoked);
      const validation = validateCredentialData(revokedData);
      if (!validation.valid) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      sendJson(res, 200, {
        network,
        revokedCredential: revoked,
        dataHex: bytesToHex(revokedData),
        dataLength: revokedData.length,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/tx-template/issue') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      try {
        const built = await buildNdcpIssueTemplate(req, body, network);
        sendJson(res, 200, built);
        return;
      } catch (err) {
        const msg = String(err?.message || err);
        const isCellQueryFailure = msg.includes('get_cells') || msg.includes('RPC');
        const isInsufficient = msg.includes('Not enough live capacity');
        sendJson(res, isInsufficient ? 409 : isCellQueryFailure ? 502 : 400, {
          error: msg,
          code: isInsufficient ? 'INSUFFICIENT_LIVE_CAPACITY' : isCellQueryFailure ? 'LIVE_CELL_QUERY_FAILED' : 'BUILD_TX_FAILED',
          network,
        });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/build-tx') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));

      try {
        const built = await buildNdcpIssueTemplate(req, body, network);
        const txSkeleton = built.template;
        const signingEntries = txSkeleton.inputs.length > 0
          ? [
              {
                index: 0,
                type: 'witness_args_lock',
                algorithm: 'ckb-secp256k1-blake160-sighash_all',
                message: null,
              },
            ]
          : [];

        sendJson(res, 200, {
          network: built.network,
          txSkeleton,
          signingEntries,
          meta: {
            usedLiveCells: built.template?.metadata?.usedLiveCells || [],
            expiresAt: built.template?.metadata?.expiresAt || null,
          },
        });
        return;
      } catch (err) {
        const msg = String(err?.message || err);
        const isCellQueryFailure = msg.includes('get_cells') || msg.includes('RPC');
        const isInsufficient = msg.includes('Not enough live capacity');
        const isStaleCellDep = msg.includes('Stale NDCP cell dep outpoint');
        sendJson(res, isInsufficient ? 409 : isCellQueryFailure ? 502 : 400, {
          error: msg,
          code: isInsufficient
            ? 'INSUFFICIENT_LIVE_CAPACITY'
            : isCellQueryFailure
              ? 'LIVE_CELL_QUERY_FAILED'
              : isStaleCellDep
                ? 'STALE_CELL_DEP'
                : 'BUILD_TX_FAILED',
          network,
        });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/wallet/live-capacity') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      const rpcUrl = getRpcUrl(network);

      const lock = normalizeLockForTemplate(
        body.lock || body.fundingLock || body.fromLock,
        body.lockArgs || body.fundingLockArg || body.fromLockArg || DEFAULT_ISSUER_LOCK_ARG,
      );
      const requestedOutputCapacity = body.capacity !== undefined && body.capacity !== null
        ? toBigIntQuantity(toHexQuantity(body.capacity), 'capacity')
        : null;
      let minimalOutputCapacity = null;
      if (body.credentialDataHex || body.dataHex) {
        const ndcpInfo = getContractInfo(network, 'ndcp');
        if (!ndcpInfo) {
          throw new Error(`No ndcp deployment metadata found for ${network}.`);
        }
        const payloadHex = normalizeDataHex(body.credentialDataHex || body.dataHex || '');
        const payloadBytes = hexToBytes(payloadHex);
        const validation = validateCredentialData(payloadBytes);
        if (!validation.valid) {
          throw new Error(`Invalid credential payload: ${validation.error}`);
        }
        const typeArgs = normalizeDataHex(body.typeArgs || '0x');
        minimalOutputCapacity = computeMinimalCellCapacity(
          lock,
          { codeHash: ndcpInfo.codeHash, hashType: ndcpInfo.hashType, args: typeArgs },
          payloadHex,
        );
      }
      const outputCapacity = minimalOutputCapacity === null
        ? (requestedOutputCapacity ?? toBigIntQuantity('0', 'capacity'))
        : (
          requestedOutputCapacity === null
            ? minimalOutputCapacity
            : (requestedOutputCapacity < minimalOutputCapacity ? minimalOutputCapacity : requestedOutputCapacity)
        );
      const fee = toBigIntQuantity(toHexQuantity(body.fee || toHexQuantity(DEFAULT_TX_FEE)), 'fee');
      const requiredCapacity = toBigIntQuantity(
        toHexQuantity(body.requiredCapacity || (outputCapacity + fee)),
        'requiredCapacity',
      );

      const maxCells = Number(body.maxCells || 2000);
      const available = await sumLivePlainCapacityByLock(rpcUrl, lock, maxCells);
      const sufficient = available.totalCapacity >= requiredCapacity;
      const shortfall = sufficient ? 0n : (requiredCapacity - available.totalCapacity);

      sendJson(res, 200, {
        ok: true,
        network,
        fundingLock: lock,
        requestedOutputCapacity: requestedOutputCapacity === null ? null : toHexQuantity(requestedOutputCapacity),
        minimalOutputCapacity: minimalOutputCapacity === null ? null : toHexQuantity(minimalOutputCapacity),
        enforcedOutputCapacity: toHexQuantity(outputCapacity),
        requiredCapacity: toHexQuantity(requiredCapacity),
        availableCapacity: toHexQuantity(available.totalCapacity),
        shortfall: toHexQuantity(shortfall),
        sufficient,
        scannedPlainCells: available.cellCount,
        truncated: available.truncated,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/tx-template/revoke') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      requireDevnet(network);

      const payloadHex = normalizeDataHex(body.revokedDataHex || body.credentialDataHex || body.dataHex || '');
      const dataBytes = hexToBytes(payloadHex);
      const validation = validateCredentialData(dataBytes);
      if (!validation.valid) {
        sendJson(res, 400, { error: `Invalid revoked payload: ${validation.error}` });
        return;
      }

      const prevOutPoint = body.inputOutPoint;
      if (!prevOutPoint) {
        sendJson(res, 400, { error: 'Missing inputOutPoint { txHash, index } for revoke template.' });
        return;
      }
      const ndcpInfo = getContractInfo(network, 'ndcp');
      if (!ndcpInfo) {
        sendJson(res, 404, { error: `No ndcp deployment metadata found for ${network}.` });
        return;
      }

      const lock = body.lock || buildDefaultLock(DEFAULT_ISSUER_LOCK_ARG);
      const capacity = toHexQuantity(body.capacity || '0x174876e800');
      const typeArgs = normalizeDataHex(body.typeArgs || '0x');

      const template = {
        version: '0x0',
        cellDeps: ndcpInfo.cellDeps,
        headerDeps: [],
        inputs: [
          {
            previousOutput: {
              txHash: prevOutPoint.txHash,
              index: toHexQuantity(prevOutPoint.index),
            },
            since: '0x0',
          },
        ],
        outputs: [
          {
            capacity,
            lock,
            type: {
              codeHash: ndcpInfo.codeHash,
              hashType: ndcpInfo.hashType,
              args: typeArgs,
            },
          },
        ],
        outputsData: [payloadHex],
        witnesses: body.witnesses || ['0x'],
      };

      sendJson(res, 200, { network, template });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/transfer/payload') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      requireDevnet(network);

      const inputDataHex = normalizeDataHex(body.inputCredentialDataHex || body.inputDataHex || '');
      const outputDataHex = normalizeDataHex(body.outputCredentialDataHex || body.outputDataHex || inputDataHex);
      assertValidTransferData(inputDataHex, outputDataHex);

      const inputCredential = deserializeCredential(hexToBytes(inputDataHex));
      const outputCredential = deserializeCredential(hexToBytes(outputDataHex));

      sendJson(res, 200, {
        network,
        inputDataHex,
        outputDataHex,
        inputCredential,
        outputCredential,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ndcp/tx-template/transfer') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      requireDevnet(network);

      const prevOutPoint = body.inputOutPoint;
      if (!prevOutPoint) {
        sendJson(res, 400, { error: 'Missing inputOutPoint { txHash, index } for transfer template.' });
        return;
      }
      const ndcpInfo = getContractInfo(network, 'ndcp');
      if (!ndcpInfo) {
        sendJson(res, 404, { error: `No ndcp deployment metadata found for ${network}.` });
        return;
      }

      const inputDataHex = normalizeDataHex(body.inputCredentialDataHex || body.inputDataHex || '');
      const outputDataHex = normalizeDataHex(body.outputCredentialDataHex || body.outputDataHex || inputDataHex);
      try {
        assertValidTransferData(inputDataHex, outputDataHex);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }

      const lock = body.lock || buildDefaultLock(DEFAULT_ISSUER_LOCK_ARG);
      const capacity = toHexQuantity(body.capacity || '0x174876e800');
      const typeArgs = normalizeDataHex(body.typeArgs || '0x');

      const template = {
        version: '0x0',
        cellDeps: ndcpInfo.cellDeps,
        headerDeps: [],
        inputs: [
          {
            previousOutput: {
              txHash: prevOutPoint.txHash,
              index: toHexQuantity(prevOutPoint.index),
            },
            since: '0x0',
          },
        ],
        outputs: [
          {
            capacity,
            lock,
            type: {
              codeHash: ndcpInfo.codeHash,
              hashType: ndcpInfo.hashType,
              args: typeArgs,
            },
          },
        ],
        outputsData: [outputDataHex],
        witnesses: body.witnesses || ['0x'],
        metadata: {
          inputDataHex,
        },
      };

      sendJson(res, 200, { network, template });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/ndcp/cell/')) {
      const rest = url.pathname.slice('/ndcp/cell/'.length);
      const [txHash, indexRaw] = rest.split('/');
      if (!txHash || !indexRaw) {
        sendJson(res, 400, { error: 'Use /ndcp/cell/<txHash>/<index>' });
        return;
      }

      const network = normalizeNetwork(url.searchParams.get('network'));
      requireDevnet(network);
      const rpcUrl = getRpcUrl(network);
      const ndcpInfo = getContractInfo(network, 'ndcp');
      if (!ndcpInfo) {
        sendJson(res, 404, { error: `No ndcp deployment metadata found for ${network}.` });
        return;
      }

      const index = toHexQuantity(indexRaw);
      const cell = await rpcCall(rpcUrl, 'get_live_cell', [{ tx_hash: txHash, index }, true]);
      const status = cell?.status || 'unknown';
      if (status !== 'live') {
        sendJson(res, 200, { network, status, outPoint: { txHash, index } });
        return;
      }

      const output = cell?.cell?.output || null;
      const typeScript = rpcScriptToCamel(output?.type);
      const isNdcpType = matchesNdcpContractInfo(typeScript, ndcpInfo);
      const dataHex = cell?.cell?.data?.content || '0x';

      let parsed = null;
      let validation = null;
      if (dataHex !== '0x') {
        const dataBytes = hexToBytes(dataHex);
        validation = validateCredentialData(dataBytes);
        if (validation.valid) {
          parsed = deserializeCredential(dataBytes);
        }
      }

      sendJson(res, 200, {
        network,
        status,
        outPoint: { txHash, index },
        isNdcpType,
        output: {
          capacity: output?.capacity,
          lock: rpcScriptToCamel(output?.lock),
          type: typeScript,
        },
        dataHex,
        parsedCredential: parsed,
        validation,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/tx/') && url.pathname.endsWith('/status')) {
      const cleanPath = toPathWithoutQuery(url.pathname);
      const txHash = cleanPath.slice('/tx/'.length, -'/status'.length);
      if (!txHash || !txHash.startsWith('0x')) {
        sendJson(res, 400, { error: 'Invalid tx hash path. Use /tx/<0x...>/status' });
        return;
      }

      const network = normalizeNetwork(url.searchParams.get('network'));
      const rpcUrl = getRpcUrl(network);
      const result = await rpcCall(rpcUrl, 'get_transaction', [txHash]);
      const txStatus = result?.tx_status?.status || result?.txStatus?.status || 'unknown';
      const blockHash = result?.tx_status?.block_hash || result?.txStatus?.block_hash || null;
      let blockNumber = null;
      let confirmations = 0;
      if (blockHash && txStatus === 'committed') {
        const header = await rpcCall(rpcUrl, 'get_header', [blockHash]);
        blockNumber = header?.inner?.number || header?.number || null;
        if (blockNumber) {
          const tip = await rpcCall(rpcUrl, 'get_tip_block_number');
          const conf = toBigIntQuantity(tip) - toBigIntQuantity(blockNumber) + 1n;
          confirmations = Number(conf > 0n ? conf : 0n);
        }
      }

      const state =
        txStatus === 'committed' ? 'committed'
          : txStatus === 'rejected' ? 'rejected'
            : txStatus === 'unknown' ? 'unknown'
              : 'pending';

      sendJson(res, 200, {
        txHash,
        state,
        network,
        blockNumber,
        confirmations,
        txStatus,
        blockHash,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/tx/')) {
      const txHash = url.pathname.slice('/tx/'.length);
      if (!txHash || !txHash.startsWith('0x')) {
        sendJson(res, 400, { error: 'Invalid tx hash path. Use /tx/<0x...>' });
        return;
      }

      const network = normalizeNetwork(url.searchParams.get('network'));
      const rpcUrl = getRpcUrl(network);
      const result = await rpcCall(rpcUrl, 'get_transaction', [txHash]);

      sendJson(res, 200, {
        network,
        rpcUrl,
        txHash,
        txStatus: result?.tx_status?.status || result?.txStatus?.status || null,
        transaction: result,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/tx/submit') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      const tx = extractTx(body);
      const result = await submitTransaction(network, body, tx);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/submit-tx') {
      const body = await readJsonBody(req);
      const network = normalizeNetwork(body.network || url.searchParams.get('network'));
      const txSkeleton = parseTxSkeleton(body);
      const expiresAt = txSkeleton?.metadata?.expiresAt || body?.expiresAt;
      if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.now() > Date.parse(expiresAt)) {
        sendJson(res, 409, {
          error: 'Transaction template expired. Please rebuild transaction with fresh live inputs.',
          code: 'TX_TEMPLATE_EXPIRED',
          network,
          expiresAt,
        });
        return;
      }

      let txToSubmit = txSkeleton;
      if (Array.isArray(body.signedWitnesses)) {
        if (body.signedWitnesses.length < (txSkeleton.inputs?.length || 0)) {
          sendJson(res, 400, {
            error: 'signedWitnesses length is smaller than inputs length.',
            code: 'INVALID_SIGNED_WITNESSES',
          });
          return;
        }
        txToSubmit = {
          ...txSkeleton,
          witnesses: body.signedWitnesses,
        };
      } else if (Array.isArray(body.signatures)) {
        txToSubmit = withAttachedSignatures(txSkeleton, body.signatures);
      } else {
        sendJson(res, 400, {
          error: 'Provide either signedWitnesses or signatures in submit request.',
          code: 'MISSING_SIGNATURES',
        });
        return;
      }

      const result = await submitTransaction(network, body, txToSubmit);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (err) {
    sendJson(res, Number(err?.statusCode || 400), { error: err.message });
  }
}

let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializePortalDbStorage();
  }
  return initPromise;
}

export async function serverHandler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  await ensureInitialized();
  return handleRequest(req, res).catch((err) => {
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === __filename;
}

if (isMainModule()) {
  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await ensureInitialized();
  server.listen(PORT, HOST, () => {
    console.log(`[server] Listening on http://${HOST}:${PORT}`);
    console.log(`[server] Default network: ${DEFAULT_NETWORK}`);
    console.log(`[server] RPC devnet: ${RPC_URLS.devnet || '(not set)'}`);
    console.log(`[server] RPC testnet: ${RPC_URLS.testnet || '(not set)'}`);
    console.log(`[server] RPC mainnet: ${RPC_URLS.mainnet || '(not set)'}`);
    console.log(`[server] Portal DB mode: supabase`);
    console.log(`[server] Content storage mode: supabase-storage`);
  });
}
