# Builder Track Weekly Report - Week 4

> **Tracking progress in the CKB Academy Builder Program**

---

<table>
  <tr>
    <td><b>Name:</b></td>
    <td>Positive Vibes</td>
  </tr>
  <tr>
    <td><b>Week Ending:</b></td>
    <td>April 20, 2026</td>
  </tr>
  <tr>
    <td><b>Track:</b></td>
    <td>CKB Developer Builder</td>
  </tr>
  <tr>
    <td><b>Status:</b></td>
    <td>Week 4 - Complete</td>
  </tr>
</table>

---

## Builder Progress

```txt
Progress: 100%
Contract -> Portal Backend -> Deployment Tooling -> Public Verification
```

| Status | Focus Area | Topics |
|--------|------------|--------|
| Complete | Testnet Deployment | Live CKB testnet deployment and metadata alignment |
| Complete | Supabase Portal Backend | Database + storage migration from local mode |
| Complete | Public Verification UX | Public organization / identity / credential share cards |
| Complete | Deployment Tooling | Separate deployment frontend/server, wallet tracking, ckb-cli deploy flow |
| Complete | Backend Readiness | Env-driven contract metadata for serverless deployment |

---

## Key Learnings

<details>
<summary><b>Contract Deployment Cost Comes from Stored Bytes</b> - Click to expand</summary>

> CKB deployment cost is dominated by code-cell size. Even a relatively small contract binary still requires a large amount of CKB because the binary is stored directly in a live cell.
</details>

<details>
<summary><b>Deployment Tooling Should Be Separate from Portal Runtime</b> - Click to expand</summary>

> Contract deployment, wallet creation, and operator workflows should not live inside the main app backend. Separating deployment into its own service and frontend keeps runtime concerns cleaner and safer.
</details>

<details>
<summary><b>Public Trust Must Be Visible</b> - Click to expand</summary>

> Public share cards are more useful when verification state is directly visible. Company verification is now shown explicitly in public card and embed experiences, especially when profile lock has not been completed.
</details>

<details>
<summary><b>Serverless Backends Need Env-Driven Chain Metadata</b> - Click to expand</summary>

> A serverless deployment target should not depend on mutable local deployment JSON files. Moving active contract metadata and secp cell deps into environment variables makes the backend much easier to deploy on platforms like Vercel.
</details>

---

## Practical Progress

### Project: **Realta / NDCP**

> **Digital credential issuance, trust verification, public credential sharing, and live testnet contract tooling on Nervos CKB**

```txt
Register Issuer -> Verify Profile -> Issue Credential -> Share Public Card -> Deploy Contract on Testnet
```

### Week 4 Achievements

#### Chain + Deployment
- [x] Confirmed `ndcp` contract deployment on CKB testnet
- [x] Verified committed deployment through direct testnet RPC query
- [x] Aligned deployment metadata with the committed testnet outpoint
- [x] Exposed deployment preflight values: binary size, required capacity, available capacity, shortfall

#### Deployment Tooling
- [x] Created separate deployment frontend under `deployment/public`
- [x] Created separate deployment server under `deployment/server.mjs`
- [x] Added tracked wallet creation through `ckb-cli` + WSL
- [x] Added wallet listing and spendable-balance calculation
- [x] Added deployment history and active deployed-contract views
- [x] Replaced temporary JoyID deployment flow with real `ckb-cli`-based deploy execution

#### Backend + Storage
- [x] Removed local portal/file mode and migrated to Supabase-backed persistence
- [x] Added Supabase Storage-backed file handling
- [x] Added public share slugs for organizations, identity cards, and credentials
- [x] Added iframe/embed sharing support
- [x] Switched main runtime contract resolution to env-driven metadata for serverless compatibility

#### Frontend + UX
- [x] Reworked connect flow to JoyID-first wallet onboarding
- [x] Added public organization and identity card pages without auth
- [x] Added explicit verified/unverified company badge to shared org card + embed
- [x] Redesigned main app pages to match the deployment-console visual system
- [x] Converted issuer registration into a wizard-based form
- [x] Replaced hardcoded Twitter field with dropdown-based social platform selection

## Progress Summary

| Category | Completion |
|----------|------------|
| Contract Development | 100% |
| Testnet Deployment | 100% |
| Deployment Tooling | 95% |
| Portal Backend | 95% |
| Supabase Integration | 100% |
| Public Share / Card UX | 95% |
| Frontend Integration | 90% |
| Serverless Preparation | 90% |

**Overall Week 4: Realta now has a live testnet contract deployment, a separated deployment toolchain, a Supabase-backed backend, public verification/share cards, and a serverless-compatible main backend configuration.**

---

*Report generated for CKB Academy Builder Track*
