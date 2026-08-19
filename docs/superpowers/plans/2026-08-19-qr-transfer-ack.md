# QR Transfer / ACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the offline Court→Host QR transfer protocol, multipart progress tracking, host-side ResultRevision import, ACK generation, and manual sent override defined in the approved design.

**Architecture:** Keep QR transport independent from camera/USB adapters. Domain code serializes `TransferBatch` into deterministic `QR_FRAGMENT` strings, validates and assembles fragments, then passes a reconstructed batch to a host import service. The host import service persists accepted revisions through the existing repository and emits `ACK_BATCH`; Court consumes the ACK to mark revision delivery state. IndexedDB stores transfer/receive/ACK state so reloads resume safely.

**Tech Stack:** TypeScript, React, Vitest, Dexie/IndexedDB, Web Crypto SHA-256, existing Vite toolchain. No network APIs, cloud services, or CDN dependencies.

**Spec:** `docs/superpowers/specs/2026-08-19-offline-score-management-design.md`

## Global Constraints

- Fully offline during tournament operation.
- QR fragments contain `protocolVersion`, `type`, `tournamentId`, `batchId`, `partIndex`, `totalParts`, `resultCount`, `chunkChecksum`, `batchChecksum`, and `payload`.
- Multipart QR uses manual page switching; no automatic switching.
- Receiver accepts out-of-order parts, ignores duplicate parts, and keeps multiple incomplete batches independently.
- Each fragment checksum and whole-batch checksum must be verified.
- ACK statuses are `ACCEPTED | ALREADY_RECEIVED | REJECTED | CONFIG_MISMATCH | INVALID_DATA`.
- Court marks revisions delivered only after ACK or an explicit manual override recorded in the audit log.
- Camera scanning is not part of this phase; camera and USB adapters must later feed the same encoded-string parser.

---

## File Structure

- `src/transfer/types.ts`: Transfer/fragment/ACK domain types.
- `src/transfer/codec.ts`: canonical JSON, base64url framing, SHA-256 checksum, batch split/reassembly.
- `src/transfer/receiver.ts`: multipart accumulator and progress calculation.
- `src/transfer/import-service.ts`: host-side revision import and ACK status decisions.
- `src/transfer/ack.ts`: ACK creation/validation and Court-side application.
- `src/db/schema.ts`: persisted transfer/receive/delivery/audit records.
- `src/db/transfer-repository.ts`: Dexie persistence for transfer state.
- `src/app/TransferDemo.tsx`: minimal vertical-slice UI for Court batch creation, manual page navigation, Host encoded-string ingest, progress, ACK display/application.

### Task 1: Transfer protocol types and deterministic codec

**Files:**
- Create: `src/transfer/types.ts`
- Create: `src/transfer/codec.test.ts`
- Create: `src/transfer/codec.ts`

**Interfaces:**
- Produces: `createTransferBatch`, `encodeBatchFragments`, `decodeQrFragment`, `assembleTransferBatch`.

- [ ] **Step 1: Write failing codec tests** covering one-part encoding, multipart split, required metadata, fragment checksum rejection, batch checksum rejection, and stable round-trip of `ResultRevision[]`.
- [ ] **Step 2: Run `npm run test:run -- src/transfer/codec.test.ts` and confirm failure because codec implementation is absent.**
- [ ] **Step 3: Implement canonical serialization, UTF-8/base64url framing, Web Crypto SHA-256, fragment splitting, and reconstruction.** Use format prefix `KSPO1:` followed by base64url-encoded fragment JSON.
- [ ] **Step 4: Run the codec test file and full `npm run test:run`, `npm run typecheck`, `npm run build`.**

### Task 2: Multipart receiver with resumable progress

**Files:**
- Create: `src/transfer/receiver.test.ts`
- Create: `src/transfer/receiver.ts`

**Interfaces:**
- Consumes: `decodeQrFragment`, `assembleTransferBatch`.
- Produces: `TransferReceiver.ingest(encoded: string)` and `getProgress(batchId)`.

- [ ] **Step 1: Write failing tests** for out-of-order input, duplicate part ignore, missing-part reporting, completion, separate simultaneous batch IDs, and rejecting tournament mismatch without corrupting existing progress.
- [ ] **Step 2: Verify tests fail for the missing receiver.**
- [ ] **Step 3: Implement an accumulator keyed by `batchId` with `receivedParts`, `totalParts`, `missingPartIndexes`, `remainingCount`, and `complete`.**
- [ ] **Step 4: Run receiver tests and full verification.**

### Task 3: Host revision import and ACK decisions

**Files:**
- Modify: `src/db/result-repository.ts`
- Create: `src/transfer/import-service.test.ts`
- Create: `src/transfer/import-service.ts`
- Create: `src/transfer/ack.ts`

**Interfaces:**
- Produces: `importTransferBatch(batch, context)` returning per-revision ACK statuses and an `AckBatch`.

- [ ] **Step 1: Write failing tests** for new revision `ACCEPTED`, exact duplicate `ALREADY_RECEIVED`, malformed revision `INVALID_DATA`, config mismatch `CONFIG_MISMATCH`, and divergent same-parent revision persisted as a conflict candidate while still accepted as received data.
- [ ] **Step 2: Verify expected failure.**
- [ ] **Step 3: Add repository lookup helpers for revision existence/result revisions and implement import validation + atomic persistence.**
- [ ] **Step 4: Generate `ACK_BATCH` containing `batchId`, `tournamentId`, source device ID, host device ID, timestamp, and per-revision statuses.**
- [ ] **Step 5: Run focused and full verification.**

### Task 4: Persist transfer, receive, delivery, and audit state

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/transfer-repository.test.ts`
- Create: `src/db/transfer-repository.ts`

**Interfaces:**
- Produces persistence methods for outgoing batches, received fragment progress, ACK records, revision delivery state, and manual override audit events.

- [ ] **Step 1: Write failing fake-IndexedDB tests** proving a partially received batch survives repository recreation, an outgoing batch can be reopened at the same page, ACK marks only acknowledged revision IDs delivered, and manual sent override writes an audit event.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Extend Dexie schema and implement repository methods transactionally.**
- [ ] **Step 4: Run focused and full verification.**

### Task 5: Court ACK consumption and manual sent override

**Files:**
- Create: `src/transfer/ack.test.ts`
- Modify: `src/transfer/ack.ts`

**Interfaces:**
- Produces: `encodeAck`, `decodeAck`, `applyAck`, `markBatchSentManually`.

- [ ] **Step 1: Write failing tests** for ACK round-trip, wrong tournament/batch rejection, accepted/already-received delivery marking, rejected/config-mismatch remaining unsent, and manual override audit semantics.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement ACK codec using the same `KSPO1:` frame and repository-backed application.**
- [ ] **Step 4: Run focused and full verification.**

### Task 6: Minimal end-to-end Transfer UI

**Files:**
- Create: `src/app/TransferDemo.test.tsx`
- Create: `src/app/TransferDemo.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Court path: choose unsent revisions → create batch → show `1 / N`, previous/next controls, encoded payload text, ACK input, manual sent button.
- Host path: paste/USB-style encoded fragment → ingest → show `received / total`, remaining count, missing part numbers, complete state → process → show encoded ACK.

- [ ] **Step 1: Write failing React tests** for manual QR page navigation (never auto-advance), Host remaining-count display, duplicate scan not incrementing count, completion, ACK application, and confirmation before manual sent override.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement the minimal UI against the transfer services without camera-specific code.**
- [ ] **Step 4: Run `npm run test:run`, `npm run typecheck`, and `npm run build`.**

## Acceptance Gate

Phase 2 is ready for merge only when all of the following are demonstrated in CI:

- Single and multipart round-trip preserves ResultRevision payloads.
- Corrupted fragments and corrupted assembled payloads are rejected.
- Multipart progress reports exact total/read/remaining/missing parts and survives reload persistence.
- Duplicate or out-of-order parts do not produce duplicate imports.
- Host import is idempotent and emits the required ACK statuses.
- Court delivery state changes only from a valid ACK or an audited manual override.
- UI page navigation is manual only.
- `npm ci`, `npm run test:run`, `npm run typecheck`, and `npm run build` all succeed.
