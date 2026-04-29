import { ECPair } from '@nervosnetwork/ckb-sdk-utils';

export const PLATFORM_AUTH_DOMAIN = 'realta.platform.auth';
export const PLATFORM_AUTH_VERSION = 'v1';
export const PLATFORM_ISSUANCE_DOMAIN = 'realta.issuance.session';

export type PlatformAuthChallenge = {
  challengeId: string;
  providerId: string;
  scope: string;
  requestRef?: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  message?: string;
  digestHex?: string;
};

export type IssuanceSessionClaim = {
  sessionId: string;
  orgId: string;
  credentialType: string;
  nonce: string;
  walletAddress: string;
  fullName: string;
  email?: string;
  reference?: string;
  issuedAt: string;
};

const normalizeHex = (value: string) => {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.startsWith('0x') ? clean : `0x${clean}`;
};

export const isHexPrivateKey = (value: string) => /^0x[0-9a-f]{64}$/.test(normalizeHex(value));

export const buildPlatformAuthMessage = (challenge: PlatformAuthChallenge) => {
  const payload = {
    domain: PLATFORM_AUTH_DOMAIN,
    version: PLATFORM_AUTH_VERSION,
    challengeId: String(challenge.challengeId || '').trim(),
    providerId: String(challenge.providerId || '').trim(),
    scope: String(challenge.scope || '').trim(),
    requestRef: String(challenge.requestRef || '').trim(),
    nonce: String(challenge.nonce || '').trim(),
    issuedAt: String(challenge.issuedAt || '').trim(),
    expiresAt: String(challenge.expiresAt || '').trim(),
  };

  const fields = [
    ['domain', payload.domain],
    ['version', payload.version],
    ['challengeId', payload.challengeId],
    ['providerId', payload.providerId],
    ['scope', payload.scope],
    ['requestRef', payload.requestRef],
    ['nonce', payload.nonce],
    ['issuedAt', payload.issuedAt],
    ['expiresAt', payload.expiresAt],
  ];
  return fields.map(([k, v]) => `${k}=${v}`).join('\n');
};

export const sha256Hex = async (message: string) => {
  const encoded = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return `0x${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

export const derivePublicKeyHex = (privateKey: string) => {
  const normalized = normalizeHex(privateKey);
  if (!isHexPrivateKey(normalized)) throw new Error('Invalid private key.');
  const pair = new ECPair(normalized);
  return String(pair.getPublicKey('hex')).toLowerCase();
};

export const signPlatformAuthChallenge = async (privateKey: string, challenge: PlatformAuthChallenge) => {
  const normalized = normalizeHex(privateKey);
  if (!isHexPrivateKey(normalized)) throw new Error('Invalid private key.');
  const message = buildPlatformAuthMessage(challenge);
  const digestHex = challenge.digestHex ? normalizeHex(challenge.digestHex) : await sha256Hex(message);
  if (!/^0x[0-9a-f]{64}$/.test(digestHex)) {
    throw new Error('Invalid digestHex.');
  }
  const pair = new ECPair(normalized);
  const signature = String(pair.sign(digestHex)).toLowerCase();
  const publicKey = String(pair.getPublicKey('hex')).toLowerCase();
  return {
    message,
    digestHex,
    signature,
    publicKey,
  };
};

export const buildIssuanceClaimMessage = (claim: IssuanceSessionClaim) => {
  const fields = [
    ['domain', PLATFORM_ISSUANCE_DOMAIN],
    ['version', PLATFORM_AUTH_VERSION],
    ['sessionId', String(claim.sessionId || '').trim()],
    ['orgId', String(claim.orgId || '').trim()],
    ['credentialType', String(claim.credentialType || '').trim()],
    ['nonce', String(claim.nonce || '').trim()],
    ['walletAddress', String(claim.walletAddress || '').trim()],
    ['fullName', String(claim.fullName || '').trim()],
    ['email', String(claim.email || '').trim()],
    ['reference', String(claim.reference || '').trim()],
    ['issuedAt', String(claim.issuedAt || '').trim()],
  ];
  return fields.map(([k, v]) => `${k}=${v}`).join('\n');
};

export const signIssuanceSessionClaim = async (privateKey: string, claim: IssuanceSessionClaim) => {
  const normalized = normalizeHex(privateKey);
  if (!isHexPrivateKey(normalized)) throw new Error('Invalid private key.');
  const message = buildIssuanceClaimMessage(claim);
  const digestHex = await sha256Hex(message);
  const pair = new ECPair(normalized);
  return {
    message,
    digestHex,
    signature: String(pair.sign(digestHex)).toLowerCase(),
    publicKey: String(pair.getPublicKey('hex')).toLowerCase(),
  };
};
