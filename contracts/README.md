# NDCP - Nervos Digital Credential Portal

A CKB smart contract for issuing and verifying digital credentials on the Nervos CKB blockchain.

## Overview

NDCP enables organizations to issue secure, verifiable digital credentials on CKB. Credentials are globally verifiable, do not rely on a central third party, and persist even if the original platform becomes unavailable.

## Features

- **Credential Issuance**: Organizations can issue credentials as NFTs on CKB
- **Content Integrity**: SHA-256 content hashes stored on-chain for verification
- **Revocation Support**: Immediate and provable credential revocation
- **Flexible Verification**: Backend decides verification requirements (Twitter/Website/KYC)
- **Off-chain Storage**: Large content stored on CKBFS or traditional storage with on-chain pointers
- **Custom Credential Types**: Credential type is application metadata and can be custom

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     NDCP Contract                         │
├─────────────────────────────────────────────────────────────────┤
│  On-Chain Data (116+ bytes)                                │
│  ┌──────┬─────────────┬────────────┬────────┬────────┐     │
│  │ Flag │ Content    │ CKBFS     │ Issuer │ Recip- │     │
│  │(1B)  │ Hash(32B)  │ Ptr(32B)  │ Lock(20B) │ ent(20B)│     │
│  └──────┴─────────────┴────────────┴────────┴────────┘     │
│  ┌───────────┬────────────────┬───────────┐             │
│  │ IssuedAt  │ Verification   │ Expires   │             │
│  │ (8B)     │ Data(n)        │ At?(8B)   │             │
│  └───────────┴────────────────┴───────────┘             │
└─────────────────────────────────────────────────────────┘
        ↓                                           ↑
┌──────────────────┐                      ┌──────────────────┐
│   Web2 Backend    │ ←── Verifies ────────→│   Verification   │
│   (NDCP Portal)  │      Issuer Identity  │   Services        │
└──────────────────┘                      └──────────────────┘
        ↓                                           ↑
┌──────────────────┐                      ┌──────────────────┐
│   CKBFS/IPFS    │ ←── Stores ────────→│   Content        │
│   (or Web2)     │      Credential Data│   (off-chain)    │
└──────────────────┘                      └──────────────────┘
```

## Data Structure

| Field | Size | Description |
|-------|------|-------------|
| flag | 1 byte | ISSUED (0x01) and/or REVOKED (0x02) |
| contentHash | 32 bytes | SHA-256 hash of credential content |
| ckbfsPointer | 32 bytes | Pointer to off-chain content (CKBFS/IPFS/URL) |
| issuerLockArg | 20 bytes | Lock script args of issuer (CKB address) |
| recipientLockArg | 20 bytes | Lock script args of recipient |
| issuedAt | 8 bytes | Unix timestamp of issuance |
| verificationLength | 2 bytes | Length of `verificationData` (little-endian) |
| hasExpiry | 1 byte | `0` = no `expiresAt`, `1` = `expiresAt` present |
| verificationData | n bytes | Backend verification metadata |
| expiresAt | 8 bytes (optional) | Expiration timestamp (when `hasExpiry=1`) |

## SDK Usage

```javascript
import {
  createCredential,
  revokeCredential,
  serializeCredential,
  deserializeCredential,
  validateCredentialData,
} from './ndcp.mjs';

// 1. Create a credential
const credential = createCredential(
  '0x' + 'a'.repeat(64),  // contentHash
  '0x' + 'b'.repeat(64),  // ckbfsPointer
  '0x' + 'b'.repeat(40),   // issuerLockArg
  '0x' + 'c'.repeat(40),   // recipientLockArg
  new Uint8Array([1, 2, 3, 4]), // verificationData (backend decides meaning)
  Date.now() + 365 * 24 * 60 * 60 * 1000 // expires in 1 year
);

// 2. Serialize for on-chain storage
const data = serializeCredential(credential);
console.log('Serialized size:', data.length, 'bytes');

// 3. Validate on-chain data
const validation = validateCredentialData(data);
if (!validation.valid) {
  throw new Error(validation.error);
}

// 4. Deserialize for reading
const parsed = deserializeCredential(data);
console.log('Content hash:', parsed.contentHash);
console.log('Is revoked:', (parsed.flag & 0x02) !== 0);

// 5. Revoke a credential
const revoked = revokeCredential(credential);
```

## Smart Contract Validation

The on-chain contract validates:

1. **New Credential**: 
   - Flag has ISSUED (0x01)
   - Content hash is not zero
   - Minimum data size met

2. **Transfer**:
   - Credential is not revoked
   - Recipient is valid

3. **Revocation**:
   - Credential was previously issued
   - Cannot transfer revoked credentials

## Off-Chain Content

Content can be stored on:
- **CKBFS**: Native file storage on CKB (recommended for small files)
- **IPFS**: Distributed storage with redundancy
- **Web2**: Traditional servers (AWS S3, etc.)

The `ckbfsPointer` stores a reference (hash/URL) to the actual content, while the content hash ensures integrity.

## Verification Flow

```
1. Issuer registers on NDCP Portal
2. Backend verifies issuer identity:
   - Twitter: Post verification message
   - Website: Publish DNS record
   - KYC: Manual review
3. Issuer creates credential with content
4. Content stored off-chain (CKBFS/IPFS/Web2)
5. Credential issued on CKB with:
   - Content hash (on-chain)
   - CKBFS pointer (on-chain)
   - Verification data (on-chain)
6. Anyone can verify by:
   - Checking on-chain credential
   - Computing content hash
   - Comparing with stored hash
```

## Building

```bash
# Test the SDK
node contracts/src/ndcp.test.mjs

# Build Rust contract (requires Rust toolchain in WSL/Linux)
cd contracts/ndcp
rustup target add riscv64imac-unknown-none-elf
cargo build --release --target riscv64imac-unknown-none-elf
```

## Use Cases

- Academic diplomas and certificates
- Employment verification letters
- Organization membership cards
- Product certifications
- Professional licenses

## Security Properties

- **Global Verifiability**: Anyone can verify credentials without permission
- **Tamper Evidence**: Content hash prevents off-chain tampering
- **No Central Authority**: Persistence independent of platform
- **Immediate Revocation**: On-chain revocation is instant and provable
- **Cryptographic Chain Trust**: Issuer identity → Credential → CKB

## Limitations

- **Storage Costs**: Large files may be expensive on CKBFS
- **Data Persistence**: Web2 storage not guaranteed permanent
- **User Onboarding**: Requires wallet (JoyID, MetaMask, UTXO-Global)

## Contributing

Contributions welcome. Please ensure tests pass before submitting PR.

## License

MIT
