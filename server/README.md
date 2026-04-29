# Realta Transaction Server

This server accepts signed CKB transactions over HTTP and broadcasts them to the selected network RPC.

Supported networks:

- `devnet`
- `testnet`
- `mainnet`

## Start

```bash
cd server
node index.mjs
```

For auto-restart during development:

```bash
cd server
npm run dev
```

Optional environment variables:

- `PORT` (default `8787`)
- `HOST` (default `127.0.0.1`)
- `DEFAULT_NETWORK` (default `devnet`)
- `CKB_RPC_DEVNET` (default `http://127.0.0.1:8114`)
- `CKB_RPC_TESTNET` (required for testnet usage)
- `CKB_RPC_MAINNET` (required for mainnet usage)

Example:

```bash
$env:CKB_RPC_TESTNET="https://testnet.ckb.dev/rpc"
$env:CKB_RPC_MAINNET="https://mainnet.ckb.dev/rpc"
node index.mjs
```

## Endpoints

### 1) Check networks

```bash
curl http://127.0.0.1:8787/networks
```

### 2) Health check (per network)

```bash
curl "http://127.0.0.1:8787/health?network=devnet"
```

### 3) Get NDCP contract metadata

```bash
curl "http://127.0.0.1:8787/contract/ndcp?network=devnet"
```

### 4) Submit signed transaction

The server accepts any of these keys in request body:

- `tx`
- `transaction`
- `signedTx`
- `signed_tx`

Example (`tx.json` contains your signed transaction object):

```bash
curl -X POST "http://127.0.0.1:8787/tx/submit" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"tx\":$(cat tx.json)}"
```

### 4b) Build tx skeleton from live cells (recommended flow)

```bash
curl -X POST "http://127.0.0.1:8787/build-tx" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"credentialDataHex\":\"0x...\"}"
```

Returns:
- `txSkeleton` with real live `inputs.previousOutput`
- `signingEntries` (client-side signing guidance)
- `meta.usedLiveCells` and `meta.expiresAt`

If your funding lock is secp256k1 (`codeHash = 0x9bd7...`), configure lock script dep so CKB VM can load the lock:

`server/deployment/deployment.json` (preferred) or `deployment/scripts.json` example:

```json
{
  "devnet": {
    "secp256k1Blake160": {
      "cellDep": {
        "outPoint": { "txHash": "0x...", "index": "0x0" },
        "depType": "dep_group"
      }
    }
  }
}
```

You can also pass `lockCellDep` directly in `/build-tx` body or set env vars:
- `CKB_SECP256K1_CELL_DEP_DEVNET_TX_HASH`
- `CKB_SECP256K1_CELL_DEP_DEVNET_INDEX`
- `CKB_SECP256K1_CELL_DEP_DEVNET_DEP_TYPE` (default `dep_group`)

### 4c) Submit tx skeleton + client signatures/witnesses (recommended flow)

Using signed witnesses:

```bash
curl -X POST "http://127.0.0.1:8787/submit-tx" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"txSkeleton\":$(cat tx-skeleton.json),\"signedWitnesses\":[\"0x...\"]}"
```

Using signatures (server builds `WitnessArgs.lock`):

```bash
curl -X POST "http://127.0.0.1:8787/submit-tx" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"txSkeleton\":$(cat tx-skeleton.json),\"signatures\":[{\"index\":0,\"signature\":\"0x...\"}]}"
```

If you want to bypass NDCP-reference guard:

```bash
curl -X POST "http://127.0.0.1:8787/tx/submit" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"enforceContract\":false,\"tx\":$(cat tx.json)}"
```

### 5) Get transaction status

```bash
curl "http://127.0.0.1:8787/tx/0xYOUR_TX_HASH/status?network=devnet"
```

### 6) Build NDCP issue payload (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/issue/payload" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\"}"
```

### 7) Build NDCP revoke payload (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/revoke/payload" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"credentialDataHex\":\"0x...\"}"
```

### 8) Build NDCP issue tx template (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/tx-template/issue" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"credentialDataHex\":\"0x...\"}"
```

Notes:
- The server now auto-collects `live` funding inputs by lock script (via `get_cells`) when `inputs` are not provided.
- Optional params: `fundingLock`, `fundingLockArg`, `fee`, `maxInputs`.
- If `x-org-id`/`x-org-key` are supplied and the org has `issuerLockArg`, that value is used as default funding lock arg.

### 9) Build NDCP revoke tx template (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/tx-template/revoke" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"inputOutPoint\":{\"txHash\":\"0x...\",\"index\":\"0x0\"},\"credentialDataHex\":\"0x...\"}"
```

### 10) Read and decode NDCP cell (devnet)

```bash
curl "http://127.0.0.1:8787/ndcp/cell/0xTX_HASH/0x0?network=devnet"
```

### 11) Validate NDCP transfer payload pair (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/transfer/payload" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"inputCredentialDataHex\":\"0x...\",\"outputCredentialDataHex\":\"0x...\"}"
```

### 12) Build NDCP transfer tx template (devnet)

```bash
curl -X POST "http://127.0.0.1:8787/ndcp/tx-template/transfer" \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"inputOutPoint\":{\"txHash\":\"0x...\",\"index\":\"0x0\"},\"inputCredentialDataHex\":\"0x...\",\"outputCredentialDataHex\":\"0x...\"}"
```

### 13) Register organization (portal layer)

```bash
curl -X POST "http://127.0.0.1:8787/portal/org/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Demo University\",\"walletAddress\":\"ckt1...\",\"issuerLockArg\":\"0x...\"}"
```

### 14) Update organization profile (authenticated)

```bash
curl -X POST "http://127.0.0.1:8787/portal/org/profile" \
  -H "x-org-id: org_..." \
  -H "x-org-key: orgsk_..." \
  -H "Content-Type: application/json" \
  -d "{\"website\":\"https://example.org\",\"twitter\":\"@example\"}"
```

### 15) Verification endpoints (authenticated)

- `POST /portal/verification/twitter/request`
- `POST /portal/verification/twitter/confirm`
- `POST /portal/verification/website/request`
- `POST /portal/verification/website/confirm`
- `POST /portal/verification/kyc/submit`
- `POST /portal/verification/kyc/review` (admin, requires `x-admin-key`)

### 16) Publish content metadata (authenticated)

```bash
curl -X POST "http://127.0.0.1:8787/portal/content/publish" \
  -H "x-org-id: org_..." \
  -H "x-org-key: orgsk_..." \
  -H "Content-Type: application/json" \
  -d "{\"pointerType\":\"web2\",\"pointer\":\"https://cdn.example/doc.pdf\",\"contentHash\":\"0x...\"}"
```

### 17) Link NDCP on-chain credential into portal (authenticated, devnet)

```bash
curl -X POST "http://127.0.0.1:8787/portal/credential/link-onchain" \
  -H "x-org-id: org_..." \
  -H "x-org-key: orgsk_..." \
  -H "Content-Type: application/json" \
  -d "{\"network\":\"devnet\",\"ndcpOutPoint\":{\"txHash\":\"0x...\",\"index\":\"0x0\"},\"contentId\":\"content_...\",\"issuanceSessionId\":\"isess_...\"}"
```

`issuanceSessionId` is required and must reference a user-submitted signed issuance session.

### 18) Revoke portal credential record (authenticated)

- `POST /portal/credential/revoke-record`

### 19) Public credential views

- `GET /portal/credential/<credentialId>`
- `GET /v/<shareSlug>`

## Notes

- For `testnet` and `mainnet`, set RPC URLs first.
- Contract metadata is resolved in this order:
  1. `server/deployment/deployment.json`
  2. `server/deployment/scripts.json`
  3. `deployment/scripts.json`
- To sync artifacts into `server/deployment` (no deploy), run:
  - `cd build && npm run sync:deployment`
- To deploy for a selected chain and then sync artifacts, run:
  - `node deployment/sync.mjs --deploy --network devnet --privkey <hex>`
  - `node deployment/sync.mjs --deploy --network testnet --privkey <hex>`
  - `node deployment/sync.mjs --deploy --network mainnet --privkey <hex>`
- `build/setup.js` only prepares devnet runtime now; it does not deploy contracts.
- By default, transaction submission enforces NDCP contract reference checks.
- Input outpoints are preflight-checked before broadcast. If inputs are stale/spent, the server returns `INPUTS_NOT_LIVE`.
- NDCP endpoints are currently restricted to `devnet`.
## Grouped Portal Endpoints (Recommended)

Use grouped endpoints with an `action` field instead of many separate routes.

### Grouped organization endpoint

- `POST /portal/org`

Actions:

- `register` (no auth headers)
- `update` (requires `x-org-id`, `x-org-key`)
- `get`
- `trust`

Example:

```bash
curl -X POST "http://127.0.0.1:8787/portal/org" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"register\",\"name\":\"Demo Org\",\"walletAddress\":\"ckt1...\"}"
```

### Grouped verification endpoint

- `POST /portal/verification`

Combinations:

- `{ "method": "twitter", "action": "request" }`
- `{ "method": "twitter", "action": "confirm", "postText": "..." }`
- `{ "method": "website", "action": "request" }`
- `{ "method": "website", "action": "confirm", "proofText": "..." }`
- `{ "method": "kyc", "action": "submit" }`
- `{ "method": "kyc", "action": "review" }` (admin key required)

### Grouped content endpoint

- `POST /portal/content`

Actions:

- `publish`

### Grouped credential endpoint

- `POST /portal/credential`

Actions:

- `link_onchain`
- `revoke_record`
- `get`
- `share_get`

### Grouped auth endpoint (provider + wallet-sign auth)

- `POST /portal/auth`

Actions:

- `bind_key` (org-authenticated: stores wallet public key binding on org)
- `unbind_key` (org-authenticated)
- `request_challenge` (provider requests challenge)
- `submit_proof` (provider submits signed challenge; API returns matched user/org)

Example challenge request:

```bash
curl -X POST "http://127.0.0.1:8787/portal/auth" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"request_challenge\",\"providerId\":\"acme-kyc\",\"scope\":\"login\"}"
```

Example submit proof:

```bash
curl -X POST "http://127.0.0.1:8787/portal/auth" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"submit_proof\",\"challengeId\":\"authc_...\",\"publicKey\":\"0x02...\",\"signature\":\"0x30...\"}"
```

### Grouped issuance-session endpoint

- `POST /portal/issuance-session`

Actions:

- `create` (org-authenticated, creates short-lived session URL for user)
- `list` (org-authenticated)
- `get` (org-authenticated)
- `get_public` (public, by session token)
- `submit_user` (public, user submits signed wallet claim + profile info)

Example create:

```bash
curl -X POST "http://127.0.0.1:8787/portal/issuance-session" \
  -H "x-org-id: org_..." \
  -H "x-org-key: orgsk_..." \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"create\",\"credentialType\":\"authenticity\",\"credentialTitle\":\"Authenticity Certificate\",\"ttlMinutes\":20}"
```

