export const CredentialFlag = {
  ISSUED: 0x01,
  REVOKED: 0x02,
};

const FIXED_HEADER_SIZE = 1 + 32 + 32 + 20 + 20 + 8 + 2 + 1;
export const MIN_DATA_SIZE = FIXED_HEADER_SIZE;

export function createCredential(
  contentHash,
  ckbfsPointer,
  issuerLockArg,
  recipientLockArg,
  verificationData,
  expiresAt
) {
  return {
    flag: CredentialFlag.ISSUED,
    contentHash,
    ckbfsPointer,
    issuerLockArg,
    recipientLockArg,
    verificationData: verificationData || new Uint8Array(0),
    issuedAt: Date.now(),
    expiresAt,
  };
}

export function revokeCredential(credential) {
  return {
    ...credential,
    flag: credential.flag | CredentialFlag.REVOKED,
  };
}

export function isRevoked(credential) {
  return (credential.flag & CredentialFlag.REVOKED) !== 0;
}

export function isIssued(credential) {
  return (credential.flag & CredentialFlag.ISSUED) !== 0;
}

export function hasVerificationData(credential) {
  return credential.verificationData && credential.verificationData.length > 0;
}

export function serializeCredential(data) {
  const verificationBytes = data.verificationData || new Uint8Array(0);
  if (verificationBytes.length > 0xffff) {
    throw new Error('verificationData too large');
  }

  const hasExpiry = data.expiresAt !== undefined && data.expiresAt !== null;
  const size = FIXED_HEADER_SIZE + verificationBytes.length + (hasExpiry ? 8 : 0);
  const buffer = new Uint8Array(size);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  buffer[offset++] = data.flag;

  const hashBytes = hexToBytes(data.contentHash);
  if (hashBytes.length !== 32) throw new Error('contentHash must be 32 bytes');
  buffer.set(hashBytes, offset);
  offset += 32;

  const ckbfsBytes = hexToBytes(data.ckbfsPointer);
  if (ckbfsBytes.length !== 32) throw new Error('ckbfsPointer must be 32 bytes');
  buffer.set(ckbfsBytes, offset);
  offset += 32;

  const issuerBytes = hexToBytes(data.issuerLockArg);
  if (issuerBytes.length !== 20) throw new Error('issuerLockArg must be 20 bytes');
  buffer.set(issuerBytes, offset);
  offset += 20;

  const recipientBytes = hexToBytes(data.recipientLockArg);
  if (recipientBytes.length !== 20) throw new Error('recipientLockArg must be 20 bytes');
  buffer.set(recipientBytes, offset);
  offset += 20;

  view.setBigUint64(offset, toU64(data.issuedAt), true);
  offset += 8;

  view.setUint16(offset, verificationBytes.length, true);
  offset += 2;

  buffer[offset++] = hasExpiry ? 1 : 0;

  buffer.set(verificationBytes, offset);
  offset += verificationBytes.length;

  if (hasExpiry) {
    view.setBigUint64(offset, toU64(data.expiresAt), true);
    offset += 8;
  }

  return buffer;
}

export function deserializeCredential(data) {
  if (data.length < FIXED_HEADER_SIZE) {
    throw new Error('Data too short');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const flag = data[offset++];

  const contentHash = bytesToHex(data.slice(offset, offset + 32));
  offset += 32;

  const ckbfsPointer = bytesToHex(data.slice(offset, offset + 32));
  offset += 32;

  const issuerLockArg = bytesToHex(data.slice(offset, offset + 20));
  offset += 20;

  const recipientLockArg = bytesToHex(data.slice(offset, offset + 20));
  offset += 20;

  const issuedAt = fromU64(view.getBigUint64(offset, true));
  offset += 8;

  const verificationLen = view.getUint16(offset, true);
  offset += 2;

  const hasExpiry = data[offset++];
  if (hasExpiry !== 0 && hasExpiry !== 1) {
    throw new Error('Invalid expiry flag');
  }

  if (offset + verificationLen + (hasExpiry ? 8 : 0) !== data.length) {
    throw new Error('Invalid data length');
  }

  const verificationData = data.slice(offset, offset + verificationLen);
  offset += verificationLen;

  let expiresAt;
  if (hasExpiry) {
    expiresAt = fromU64(view.getBigUint64(offset, true));
  }

  return {
    flag,
    contentHash,
    ckbfsPointer,
    issuerLockArg,
    recipientLockArg,
    verificationData,
    issuedAt,
    expiresAt,
  };
}

export function validateCredentialData(data) {
  if (data.length < MIN_DATA_SIZE) {
    return { valid: false, error: 'Data too short' };
  }

  const flag = data[0];
  if (!(flag & CredentialFlag.ISSUED)) {
    return { valid: false, error: 'Missing ISSUED flag' };
  }

  const contentHash = data.slice(1, 33);
  const allZeros = contentHash.every(b => b === 0);
  if (allZeros) {
    return { valid: false, error: 'Content hash is zero' };
  }

  const ckbfsPointer = data.slice(33, 65);
  if (ckbfsPointer.every((b) => b === 0)) {
    return { valid: false, error: 'CKBFS pointer is zero' };
  }

  const verificationLen = data[113] | (data[114] << 8);
  const hasExpiry = data[115];
  if (hasExpiry !== 0 && hasExpiry !== 1) {
    return { valid: false, error: 'Invalid expiry flag' };
  }

  const expectedLen = FIXED_HEADER_SIZE + verificationLen + (hasExpiry ? 8 : 0);
  if (data.length !== expectedLen) {
    return { valid: false, error: 'Invalid data length' };
  }

  return { valid: true };
}

export const CREDENTIAL_TYPES = {
  ACADEMIC_DIPLOMA: {
    id: 'academic_diploma',
    name: 'Academic Diploma',
    description: 'Academic degree or diploma certificate',
  },
  EMPLOYMENT: {
    id: 'employment',
    name: 'Employment Verification',
    description: 'Proof of employment',
  },
  MEMBERSHIP: {
    id: 'membership',
    name: 'Organization Membership',
    description: 'Membership verification',
  },
  CERTIFICATION: {
    id: 'certification',
    name: 'Professional Certification',
    description: 'Professional certification or license',
  },
  PRODUCT: {
    id: 'product',
    name: 'Product Certification',
    description: 'Product authenticity certification',
  },
};

function hexToBytes(hex) {
  if (typeof hex !== 'string') throw new Error('Expected hex string');
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) throw new Error('Invalid hex length');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const val = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) throw new Error('Invalid hex string');
    bytes[i] = val;
  }
  return bytes;
}

function bytesToHex(bytes) {
  let out = '0x';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function toU64(value) {
  if (value === undefined || value === null) {
    throw new Error('Missing u64 value');
  }
  const bigint = typeof value === 'bigint' ? value : BigInt(value);
  if (bigint < 0n || bigint > 0xffff_ffff_ffff_ffffn) {
    throw new Error('u64 out of range');
  }
  return bigint;
}

function fromU64(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}
