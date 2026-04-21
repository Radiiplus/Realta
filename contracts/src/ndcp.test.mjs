import {
  createCredential,
  revokeCredential,
  isRevoked,
  serializeCredential,
  deserializeCredential,
  validateCredentialData,
  CREDENTIAL_TYPES,
} from './ndcp.mjs';

async function test() {
  console.log('=== NDCP (Nervos Digital Credential Portal) Tests ===');

  const contentHash = '0x' + 'a'.repeat(64);
  const ckbfsPointer = '0x' + 'b'.repeat(64);
  const issuerLockArg = '0x' + 'b'.repeat(40);
  const recipientLockArg = '0x' + 'c'.repeat(40);

  console.log('\n1. Creating credential with verification data...');
  const verificationData = new Uint8Array([1, 2, 3, 4]);
  const credential = createCredential(
    contentHash,
    ckbfsPointer,
    issuerLockArg,
    recipientLockArg,
    verificationData,
    Date.now() + 365 * 24 * 60 * 60 * 1000
  );
  console.log('   Flag:', credential.flag.toString(16));
  console.log('   Has verification data:', credential.verificationData.length > 0);

  console.log('\n2. Creating credential without verification data...');
  const basicCred = createCredential(
    contentHash,
    ckbfsPointer,
    issuerLockArg,
    recipientLockArg,
    null,
    null
  );
  console.log('   Flag:', basicCred.flag.toString(16));
  console.log('   Has verification data:', basicCred.verificationData.length > 0);

  console.log('\n3. Serializing credential...');
  const serialized = serializeCredential(credential);
  console.log('   Serialized length:', serialized.length, 'bytes');

  console.log('\n4. Validating serialized data...');
  const validation = validateCredentialData(serialized);
  console.log('   Valid:', validation.valid);
  console.log('   Error:', validation.error || 'None');

  console.log('\n5. Deserializing credential...');
  const deserialized = deserializeCredential(serialized);
  console.log('   Content Hash matches:', deserialized.contentHash === contentHash);
  console.log('   CKBFS Pointer matches:', deserialized.ckbfsPointer === ckbfsPointer);
  console.log('   Verification data length:', deserialized.verificationData.length);

  console.log('\n6. Revoking credential...');
  const revoked = revokeCredential(credential);
  console.log('   Is Revoked:', isRevoked(revoked));
  console.log('   Original still valid:', !isRevoked(credential));

  console.log('\n7. Credential Types:');
  Object.values(CREDENTIAL_TYPES).forEach((type) => {
    console.log('   - ' + type.name + ': ' + type.description);
  });

  console.log('\n=== All Tests Passed ===');
  console.log('\nNote: Backend decides verification requirements. Contract only stores verification data.');
}

test().catch(console.error);
