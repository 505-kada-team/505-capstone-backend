# Inventory Management Flow Documentation

**Scope:** raw material & packaging inventory for a single-branch coffee
shop. Consumed by (future) Menu, Production Plan, and Dashboard modules.
**Stack:** Node.js / Express, MongoDB (Mongoose).

This document describes the _application-level_ behavior the Inventory
module must implement. It's the operational companion to
`05-rfc-inventory-architecture.md` (why these choices) and
`06-inventory-gaps-and-open-questions.md` (what's still undecided).

---

## 1. Entities

| Entity                  | Role                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Inventory**           | The "item card" e.g. "Tepung Terigu Segitiga Biru". One per distinct ingredient/packaging type. Holds cached summary fields.        |
| **SubInventory**        | One purchased **batch** of an Inventory item has its own quantity, cost, in-date, expiry. Multiple batches can exist per Inventory. |
| **HistorySubInventory** | Immutable purchase log one row per batch ever added. Never deleted.                                                                 |
| **HistoryUsage**        | Immutable usage log one row per (batch, deduction) pair, created by FEFO deduction. Never deleted.                                  |

```
Inventory (1) ──< SubInventory (N, "batches")
Inventory (1) ──< HistorySubInventory (N, append-only log)
SubInventory (1) ──< HistoryUsage (N, append-only log)
```

Because MongoDB has no foreign-key constraints, every one of these
relationships is enforced **in application code**, not the database. See
§5.

---

## 2. Status Lifecycles

### Inventory

```
        create
          │
          ▼
      ┌ active ┐──── DELETE (no active batch w/ stock) ───▶ deleted
      │        │
      │        └──── DELETE while active batch has stock ──▶ 409, blocked
      └────────┘
```

`deleted` = archived, not destroyed. Stays valid for any Menu that already
references it; disappears from list/dropdown defaults.

### SubInventory (batch)

```
                 create
                   │
                   ▼
               ┌ active ┐
               │         │── quantity reaches 0 via FEFO deduct ──▶ depleted
               │         │── expired < now(), detected lazily ────▶ expired
               │         │── manual DELETE ──────────────────────▶ deleted
               └─────────┘
```

Only `active` batches count toward `quantityTotal`, `totalSubInventory`, or
FEFO deduction candidacy. `depleted` / `expired` / `deleted` are all
terminal, non-reversible **except** via `deduct/reverse`, which can restore
`depleted → active` (never restores `expired` or `deleted`).

---

## 3. Cost Model three distinct numbers, on purpose

| Field           | Lives on               | Meaning                                                    | Consumed by                                                       |
| --------------- | ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `costPrices`    | SubInventory           | Per-unit cost of _this specific batch_                     | Source of truth for batch cost                                    |
| `lastCostBatch` | Inventory (cached)     | `costPrices` of the active batch with the newest `inDate`  | Menu's `currentCostBatch` a **fast estimate**, recomputed on read |
| `costPriceUsed` | HistoryUsage (per row) | `costPrices` of whatever batch FEFO actually deducted from | Actual COGS for profit reports                                    |

**Why they diverge:** FEFO picks by soonest-expiry, not newest-purchase.
`lastCostBatch` (newest purchase) and the batch FEFO actually took
(soonest expiry) are frequently different batches with different prices.
A Menu's estimated margin (`lastCostBatch`) and a report's actual COGS
(`costPriceUsed`) _will_ disagree sometimes that's expected, not a bug,
and should be labeled as an estimate vs. actual distinction in any UI that
shows both.

---

## 4. FEFO & Batch Safety Status (v4)

FEFO (First-Expired-First-Out) always takes the soonest-expiring **active**
batch first, with **no exceptions and no exclusions** that's the whole
point of FEFO. What v4 changed is purely informational: instead of
excluding a batch that will expire mid-plan (v3 behavior), the system now
takes it anyway and _labels_ it.

```
batchSafetyStatus =
  "safe"    if expired === null (packaging)  OR  expired >= availableUntil
  "unsafe"  if expired <  availableUntil     (will expire before the plan ends)
```

- `hasUnsafeBatch` (response-level) = true if any batch in the result is
  `unsafe`.
- `sufficient` (check-availability) is **independent** of `hasUnsafeBatch`
  a request can be both `sufficient: true` and `hasUnsafeBatch: true`.
  Whether to proceed despite unsafe batches is a **business decision**
  made by an admin in the Production Plan module, not something Inventory
  gates automatically.
- `check-availability` (dry-run) and `deduct` (real) **must share one FEFO
  - safety-status function**. If their logic ever diverges, you get the
    worst possible UX: a draft plan says a batch is safe, then approving it
    flags the same batch unsafe. Treat this shared function as a contract,
    not an implementation detail.

---

## 5. Referential Integrity Without Foreign Keys

MongoDB won't stop you from creating a `SubInventory` pointing at a
non-existent `Inventory`, or from silently leaving stale cached numbers on
`Inventory` after a batch changes underneath it. Since there's no
`ON DELETE`/`ON UPDATE` constraint to lean on, the module needs explicit,
disciplined equivalents:

### 5.1 Validate-before-write (replaces FK insert-time checks)

Any endpoint that writes a document referencing another collection's `_id`
must load and validate that parent first, inside the same request:

- `POST /subinventory` → `Inventory` must exist and be `active` (404/409
  otherwise) _before_ the batch is created.
- Future Menu/Plan writes that reference `inventoryId` must do the same.

### 5.2 One shared recompute function (replaces triggers)

`quantityTotal`, `lastCostBatch`, `totalSubInventory` on `Inventory` are
**cached, derived** values the actual source of truth is the sum over
that Inventory's `active` `SubInventory` documents. Every endpoint that
changes a batch (`POST .../subinventory`, `DELETE /subinventory/:id`,
`deduct`, `deduct/reverse`) must call **the same** recompute function
afterward, inside the same transaction. Do not let any endpoint update
these fields with ad hoc arithmetic a single shared function is the only
way to guarantee they never drift, since Mongo won't recompute them for
you the way a SQL `VIEW` or trigger would.

### 5.3 Snapshot fields (replaces "SELECT with JOIN" reads)

`HistorySubInventory` and `HistoryUsage` store `nameInventory` (and other
display fields) **at the time of the transaction**, not just the
`inventoryId` reference. This is deliberate denormalization: it means
history stays fully readable even after the parent `Inventory` is
archived, without needing a join (which Mongo doesn't really have) and
without needing to special-case "what if the parent is gone" on every
history read.

### 5.4 Delete guards (replaces `ON DELETE RESTRICT`)

`DELETE /inventory/:id` returns `409` if any `active` batch still has
`quantity > 0` this is a manual stand-in for a SQL foreign-key
`RESTRICT`. Nothing in Mongo would otherwise stop you from archiving an
Inventory while its stock is still "live."

### 5.5 Stale-flag propagation (replaces cascading updates)

Archiving an Inventory (`DELETE /inventory/:id`) or a batch
(`DELETE /subinventory/:id`) doesn't cascade-delete anything downstream
instead it flips a `checkResultStale: true` flag (with a `staleReason`) on
any Production Plan draft that had cached a `check-availability` result
referencing that Inventory/batch. This is the chosen pattern for "a
document I don't own, in a different collection, now has outdated derived
data": flag it as stale and let the owning module (Production Plan)
decide what to do, rather than reaching into another collection to fix it
directly. Full mechanics belong to the Production Plan module's docs
Inventory's job stops at emitting accurate raw data
(`batchSafetyStatus`, batch `status`).

### 5.6 Atomicity boundaries

Transactions (MongoDB multi-document ACID transactions, which require a
replica set confirm your deployment target supports this) wrap:

- `POST .../subinventory` (create batch + log + recompute)
- `DELETE /subinventory/:id` (archive batch + recompute)
- `POST /subinventory/deduct` (multi-batch FEFO deduction + multiple
  history rows + recompute)
- `POST /subinventory/deduct/reverse` (restore quantities + recompute)

Within `deduct` specifically, each batch's quantity decrement should
additionally use an **atomic conditional update**
(`findOneAndUpdate({ _id, quantity: { $gte: amountToTake } }, { $inc: ... })`)
rather than read-then-write, so two concurrent deducts against the same
batch can't both succeed past the same stock.

### 5.7 Recommended addition: periodic integrity audit

Because nothing enforces referential integrity at write time other than
application discipline, a scheduled read-only job that scans for orphaned
references (e.g. `SubInventory.inventoryId` pointing at nothing,
`HistoryUsage.subInventoryId` pointing at nothing) and reports them is
cheap insurance against a future bug slipping through validation. This is
a monitoring/ops concern, not a new endpoint flagged in
`06-inventory-gaps-and-open-questions.md`.

---

## 6. Endpoint Reference

Full request/response contracts are already specified in the v4 design
doc; this table is the at-a-glance index. "Changed in v4" marks the two
endpoints whose behavior shifted with the FEFO/`batchSafetyStatus` update.

| #   | Method & Path                               | Purpose                      | Notes                                                                              |
| --- | ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `POST /api/inventory`                       | Create inventory item        | Duplicate-name guard (case-insensitive, same category, active only)                |
| 2   | `GET /api/inventory`                        | Paginated list               | `includeDeleted` gated for admin/audit views                                       |
| 3   | `GET /api/inventory/dropdown`               | Minimal list, no pagination  | For Menu/Plan creation UIs                                                         |
| 4   | `GET /api/inventory/:id`                    | Detail + batch list          | Runs lazy expiry check first                                                       |
| 5   | `PUT /api/inventory/:id`                    | Edit name/description        | `category`/`unit` locked after creation                                            |
| 6   | `DELETE /api/inventory/:id`                 | Archive (soft-delete)        | 409 if active stock remains; propagates `checkResultStale`                         |
| 7   | `POST /api/inventory/:id/subinventory`      | Add batch                    | `expired` required for `ingredients`, forced `null` for `packaging`                |
| 8   | `GET /api/inventory/:id/subinventory`       | List batches                 | Runs lazy expiry check first                                                       |
| 9   | `DELETE /api/subinventory/:id`              | Archive one batch            | Propagates `checkResultStale`                                                      |
| 10  | `GET /api/history-sub-inventory`            | Purchase log                 | Append-only, filterable                                                            |
| 11  | `POST /api/subinventory/check-availability` | **[v4]** Dry-run stock check | Shares FEFO logic with #12; never excludes batches, only flags `batchSafetyStatus` |
| 12  | `POST /api/subinventory/deduct`             | **[v4]** FEFO deduction      | `availableUntil` optional; omitting it means no safety evaluation                  |
| 13  | `POST /api/subinventory/deduct/reverse`     | Undo a deduction             | Restores quantity; only un-depletes, never un-expires                              |
| 14  | `GET /api/history-usage`                    | Usage log                    | Includes `batchSafetyStatus`, `isReversed`                                         |

---

## 7. Cross-Module Contract

Inventory doesn't know about Menu or Production Plan directly it only
promises a stable data contract those modules build on:

- `GET /inventory/dropdown` for Menu/Plan creation pickers.
- `POST /subinventory/check-availability` for Plan draft simulation.
- `POST /subinventory/deduct` / `deduct/reverse` for Plan
  approve/cancel.
- `batchSafetyStatus`, `hasUnsafeBatch` raw signal for Plan to decide
  whether to warn an admin or route a batch toward a waste-reduction
  discount (Production Plan's concern, not Inventory's).
- `checkResultStale` flag written onto Plan drafts Inventory's only
  "reach into another collection" action, and it's additive (a flag), never
  destructive.
