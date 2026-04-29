export interface OrgData {
  orgId: string;
  orgKey: string;
  entityType: 'organization' | 'individual';
  name: string;
  walletAddress: string;
  issuerLockArg: string;
  contactEmail?: string;
  phone?: string;
  country?: string;
  city?: string;
  addressLine?: string;
  website?: string;
  socialPlatform?: string;
  socialHandle?: string;
  description?: string;
  legalName?: string;
  registrationNumber?: string;
  industry?: string;
  firstName?: string;
  lastName?: string;
  occupation?: string;
  trustLevel: 'unverified' | 'basic' | 'strong' | 'high';
}

export interface Credential {
  id: string;
  txHash: string;
  index: number;
  contentHash: string;
  ckbfsPointer: string;
  flag: string;
  issuedAt: number;
  expiresAt?: number;
  status: 'active' | 'revoked';
  recipientLockArg: string;
}

export interface TxStatus {
  hash: string;
  status: 'pending' | 'committed' | 'failed';
  message?: string;
}
