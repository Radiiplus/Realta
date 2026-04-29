import axios from 'axios';
import { getOrgId, getOrgKey } from './session';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const client = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to add auth headers
client.interceptors.request.use((config) => {
  const orgId = getOrgId();
  const orgKey = getOrgKey();
  
  if (orgId && orgKey) {
    config.headers['x-org-id'] = orgId;
    config.headers['x-org-key'] = orgKey;
  }
  return config;
});

export const api = {
  org: {
    register: (data: any) => client.post('/portal/org', { action: 'register', ...data }),
    update: (data: any) => client.post('/portal/org', { action: 'update', ...data }),
    delist: () => client.post('/portal/org', { action: 'delist' }),
    relist: () => client.post('/portal/org', { action: 'relist' }),
    get: (orgId: string) => client.post('/portal/org', { action: 'get', orgId }),
    getTrust: () => client.post('/portal/org', { action: 'trust', orgId: getOrgId() }),
    shareLink: () => client.post('/portal/org', { action: 'share_link' }),
    shareGet: (shareSlug: string) => client.post('/portal/org', { action: 'share_get', shareSlug }),
    listByWallet: (walletAddress: string) =>
      client.post('/portal/org', { action: 'list_by_wallet', walletAddress }),
    listByWalletWithDelisted: (walletAddress: string) =>
      client.post('/portal/org', { action: 'list_by_wallet', walletAddress, includeDelisted: true }),
  },
  verification: {
    requestChallenge: (method: 'twitter' | 'website') => 
      client.post('/portal/verification', { method, action: 'request' }),
    confirmChallenge: (method: 'twitter' | 'website', proof: string) => 
      client.post('/portal/verification', method === 'twitter'
        ? { method, action: 'confirm', postText: proof }
        : { method, action: 'confirm', proofText: proof }),
    attestProfile: (agree: boolean) =>
      client.post('/portal/verification', { action: 'attest_profile', agree }),
  },
  auth: {
    bindKey: (publicKey: string) => client.post('/portal/auth', { action: 'bind_key', publicKey }),
    unbindKey: () => client.post('/portal/auth', { action: 'unbind_key' }),
    requestChallenge: (data: { providerId: string; orgId?: string; scope?: string; requestRef?: string }) =>
      client.post('/portal/auth', { action: 'request_challenge', ...data }),
    submitProof: (data: { challengeId: string; publicKey: string; signature: string }) =>
      client.post('/portal/auth', { action: 'submit_proof', ...data }),
  },
  issuanceSession: {
    create: (data: { credentialType?: string; credentialTitle?: string; note?: string; ttlMinutes?: number }) =>
      client.post('/portal/issuance-session', { action: 'create', ...data }),
    list: () => client.post('/portal/issuance-session', { action: 'list' }),
    get: (sessionId: string) => client.post('/portal/issuance-session', { action: 'get', sessionId }),
    getPublic: (token: string) => client.post('/portal/issuance-session', { action: 'get_public', token }),
    submitUser: (data: {
      token: string;
      walletAddress: string;
      publicKey: string;
      signature: string;
      issuedAt: string;
      profile: { fullName: string; email?: string; reference?: string };
    }) => client.post('/portal/issuance-session', { action: 'submit_user', ...data }),
  },
  content: {
    publish: (data: any) => client.post('/portal/content', { action: 'publish', ...data }),
    upload: (data: any) => client.post('/portal/content', { action: 'upload', ...data }),
  },
  credential: {
    linkOnchain: (data: any) => client.post('/portal/credential', { action: 'link_onchain', ...data }),
    revokeRecord: (data: any) => client.post('/portal/credential', { action: 'revoke_record', ...data }),
    delistRecord: (credentialId: string) => client.post('/portal/credential', { action: 'delist_record', credentialId }),
    undelistRecord: (credentialId: string) => client.post('/portal/credential', { action: 'undelist_record', credentialId }),
    list: () => client.post('/portal/credential', { action: 'list', includeDelisted: true }),
    get: (credentialId: string) => client.post('/portal/credential', { action: 'get', credentialId }),
    shareGet: (shareSlug: string) => client.post('/portal/credential', { action: 'share_get', shareSlug }),
    shareLink: (credentialId: string) => client.post('/portal/credential', { action: 'share_link', credentialId }),
  },
  ndcp: {
    issuePayload: (data: any) => client.post('/ndcp/issue/payload', data),
    issueTemplate: (data: any) => client.post('/ndcp/tx-template/issue', data),
    revokePayload: (data: any) => client.post('/ndcp/revoke/payload', data),
    revokeTemplate: (data: any) => client.post('/ndcp/tx-template/revoke', data),
    transferPayload: (data: any) => client.post('/ndcp/transfer/payload', data),
    transferTemplate: (data: any) => client.post('/ndcp/tx-template/transfer', data),
  },
  tx: {
    preflightCapacity: (data: any) => client.post('/wallet/live-capacity', data),
    build: (data: any) => client.post('/build-tx', data),
    submitFlow: (data: any) => client.post('/submit-tx', data),
    submit: (data: any) => client.post('/tx/submit', data?.tx ? data : { tx: data }),
    getStatus: (hash: string) => client.get(`/tx/${hash}/status`),
    getRaw: (hash: string) => client.get(`/tx/${hash}`),
  },
  network: {
    health: () => client.get('/health'),
  },
  adminDeployment: {
    template: (adminKey: string, data: any) =>
      client.post('/admin/deployment/template', data, {
        headers: { 'x-admin-key': adminKey },
      }),
    register: (adminKey: string, data: any) =>
      client.post('/admin/deployment/register', data, {
        headers: { 'x-admin-key': adminKey },
      }),
  }
};

export default client;
