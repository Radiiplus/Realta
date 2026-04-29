# Builder Track Weekly Report - Week 3

> **Tracking progress in the CKB Academy Builder Program**

---

<table>
  <tr>
    <td><b>Name:</b></td>
    <td>Positive Vibes</td>
  </tr>
  <tr>
    <td><b>Week Ending:</b></td>
    <td>April 15, 2026</td>
  </tr>
  <tr>
    <td><b>Track:</b></td>
    <td>CKB Developer Builder</td>
  </tr>
  <tr>
    <td><b>Status:</b></td>
    <td>Week 3 - Complete</td>
  </tr>
</table>

---

## Builder Progress

```txt
Progress: 100%
Learning -> Building -> Integration
```

| Status | Focus Area | Topics |
|--------|------------|--------|
| Complete | Contract Functionality | Credential issue / transfer / revoke logic |
| Complete | Deployment Automation | Devnet deployment + artifact generation |
| Complete | Validation Flow | On-chain data format checks + transaction template testing |
| In Progress | Frontend Development | UI and integration with contract/backend flow |

---

## Key Learnings

<details>
<summary><b>Contract as a State Machine</b> - Click to expand</summary>

> The NDCP contract is best treated as a credential lifecycle state machine: `issue -> transfer -> revoke`. Strong transition checks are more important than UI logic because they enforce trustless behavior at protocol level.
</details>

<details>
<summary><b>Data Consistency Across Layers</b> - Click to expand</summary>

> The same credential byte layout must stay consistent in Rust contract logic and JS SDK serialization/deserialization. This parity is what makes on-chain validation and off-chain template generation reliable.
</details>

<details>
<summary><b>RPC Field Accuracy Matters</b> - Click to expand</summary>

> A small RPC key mismatch (`txStatus` vs `tx_status`) can produce false warnings even when deployment is successful. Fixing this improved deployment verification confidence in automation scripts.
</details>

---

## Practical Progress

### Project: **Realta / NDCP**

> **Digital credential issuance and revocation workflow on Nervos CKB, with frontend in active development**

```txt
Issue Credential -> Store Pointer+Hash -> Verify -> Revoke
```

### Week 3 Achievements

#### Contract + Logic
- [x] Implemented and validated core credential data structure
- [x] Enforced issue/transfer/revoke action validation in contract
- [x] Added checks for content hash, CKBFS pointer, issuer/recipient args, expiry/data length
- [x] Confirmed revoke is one-way and transfer-from-revoked is rejected

#### Deployment + Automation
- [x] Successfully deployed `ndcp` contract on devnet
- [x] Generated deployment artifacts (`deployment/scripts.json`, per-network deployment metadata)
- [x] Generated issue/revoke transaction templates from live deployment context
- [x] Fixed false deployment warning caused by RPC status key mismatch in automation script

#### Frontend Direction
- [x] Started frontend development aligned to contract lifecycle
- [x] Defined user flow around credential issuance and revocation UX
- [x] Prepared integration path with backend + wallet transaction signing

---

## What's Left

```txt
Remaining:
1. Frontend integration with backend transaction pipeline
2. Wallet-driven signing flow for issue/revoke actions
3. End-to-end tests from UI -> tx submission -> verification
```

| # | Goal | Priority | Status |
|---|------|----------|--------|
| 1 | Frontend-to-backend API integration | High | In Progress |
| 2 | Wallet signing + transaction submission UX | High | In Progress |
| 3 | End-to-end verification page (issued/revoked state) | Medium | Pending |
| 4 | Final polish and test coverage for release flow | Medium | Pending |

---

## Progress Summary

| Category | Completion |
|----------|------------|
| Contract Development | 100% |
| Contract Functionality Validation | 100% |
| Devnet Deployment | 100% |
| Automation Scripts | 95% |
| Backend Integration | 80% |
| UI / Frontend | 60% |
| End-to-End Integration | 55% |

**Overall Week 3: Core contract functionality is complete and running on devnet, automation pipeline is working, and frontend development is actively progressing toward full integration.**

---

*Report generated for CKB Academy Builder Track*
