import crypto from 'crypto';
import ellipticPkg from 'elliptic';

const { ec: EC } = ellipticPkg;

const secp = new EC('secp256k1');

export const PLATFORM_AUTH_DOMAIN = 'realta.platform.auth';
export const PLATFORM_AUTH_VERSION = 'v1';
export const PLATFORM_ISSUANCE_DOMAIN = 'realta.issuance.session';
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function normalizeHex(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.startsWith('0x') ? clean : `0x${clean}`;
}

function hexToBuffer(value) {
  const hex = normalizeHex(value);
  if (!/^0x[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Expected even-length hex string.');
  }
  return Buffer.from(hex.slice(2), 'hex');
}

function toHex(buffer) {
  return `0x${Buffer.from(buffer).toString('hex')}`;
}

export function isValidPublicKeyHex(value) {
  const hex = normalizeHex(value);
  if (!/^0x[0-9a-f]+$/.test(hex)) return false;
  const rawLen = (hex.length - 2) / 2;
  if (rawLen !== 33 && rawLen !== 65) return false;
  const firstByte = hex.slice(2, 4);
  if (rawLen === 33) return firstByte === '02' || firstByte === '03';
  return firstByte === '04';
}

export function buildPlatformAuthPayload({
  challengeId,
  providerId,
  scope = 'portal_login',
  requestRef = '',
  ttlMs = DEFAULT_CHALLENGE_TTL_MS,
}) {
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');
  return {
    domain: PLATFORM_AUTH_DOMAIN,
    version: PLATFORM_AUTH_VERSION,
    challengeId: String(challengeId || '').trim(),
    providerId: String(providerId || '').trim(),
    scope: String(scope || '').trim() || 'portal_login',
    requestRef: String(requestRef || '').trim(),
    nonce,
    issuedAt,
    expiresAt,
  };
}

export function buildPlatformAuthMessage(payload) {
  const fields = [
    ['domain', payload.domain],
    ['version', payload.version],
    ['challengeId', payload.challengeId],
    ['providerId', payload.providerId],
    ['scope', payload.scope],
    ['requestRef', payload.requestRef || ''],
    ['nonce', payload.nonce],
    ['issuedAt', payload.issuedAt],
    ['expiresAt', payload.expiresAt],
  ];
  return fields.map(([k, v]) => `${k}=${String(v || '')}`).join('\n');
}

export function hashPlatformAuthMessageHex(payloadOrMessage) {
  const message = typeof payloadOrMessage === 'string'
    ? payloadOrMessage
    : buildPlatformAuthMessage(payloadOrMessage);
  return toHex(crypto.createHash('sha256').update(message, 'utf8').digest());
}

export function computePublicKeyId(publicKeyHex) {
  const raw = hexToBuffer(publicKeyHex);
  return toHex(crypto.createHash('sha256').update(raw).digest());
}

export function verifyPlatformAuthSignature({ digestHex, signatureHex, publicKeyHex }) {
  if (!isValidPublicKeyHex(publicKeyHex)) return false;
  const digest = hexToBuffer(digestHex);
  if (digest.length !== 32) return false;
  const signature = hexToBuffer(signatureHex);
  try {
    const key = secp.keyFromPublic(Buffer.from(hexToBuffer(publicKeyHex)).toString('hex'), 'hex');
    return key.verify(Buffer.from(digest).toString('hex'), Buffer.from(signature).toString('hex'));
  } catch {
    return false;
  }
}

export function isChallengeExpired(challenge, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(String(challenge?.expiresAt || ''));
  if (!Number.isFinite(expiresAtMs)) return true;
  return nowMs > expiresAtMs;
}

export function buildIssuanceClaimMessage(payload) {
  const fields = [
    ['domain', PLATFORM_ISSUANCE_DOMAIN],
    ['version', PLATFORM_AUTH_VERSION],
    ['sessionId', payload.sessionId],
    ['orgId', payload.orgId],
    ['credentialType', payload.credentialType],
    ['nonce', payload.nonce],
    ['walletAddress', payload.walletAddress],
    ['fullName', payload.fullName || ''],
    ['email', payload.email || ''],
    ['reference', payload.reference || ''],
    ['issuedAt', payload.issuedAt],
  ];
  return fields.map(([k, v]) => `${k}=${String(v || '')}`).join('\n');
}
