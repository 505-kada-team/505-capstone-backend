# Inventory Module Gaps & Open Questions (against the wider PRD)

Cross-referencing the v4 design against `Problem Statement / Solution /
Feature List` doc. These are things the current Inventory spec doesn't
answer yet either because they're genuinely out of scope for this
module, or because they're in scope but undecided. Flagged, not fixed,
since several need a product decision before an engineering one.

---

## 1. No physical location tracking → FEFO is a _system_ order, not a

_shelf_ order (Open likely out of scope for v1)

The PRD explicitly raises this: _"cara jamin fifo berjalan di real-life
case? imagine an inventory rack: gunakan invent yg ada di rak tsb."_

Current design has no concept of shelf/rack position. FEFO as implemented
tells a cashier/admin _which batch_ to use, but not _where it physically
is_. In practice this means the system can recommend "use batch sub_001
first" while a human, grabbing from whatever's in front on the shelf,
actually uses sub_002 silent divergence between system state and
physical state that nothing here detects.

**Not recommending building rack/bin tracking now** for a single small
branch it's likely overkill. But worth an explicit product decision: is
"batch selection is advisory, physical compliance is trusted/manual" an
acceptable v1 assumption? If not, the minimum viable fix is showing the
batch's `inDate`/short identifier on a printed/physical label at intake,
so staff can visually match system-recommended batch to shelf stock
without full location tracking.

## 2. No standalone "nearing expiry" signal outside of a Plan context

(Gap PRD asks for this, current design doesn't have it)

PRD: _"Inventory basi di saat plan sudah berjalan = Sebelumnya akan ada
warning di tanggal tertentu jika masa expired akan segera habis."_

`batchSafetyStatus` only exists **relative to a specific Plan's
`availableUntil`** it's computed inside `check-availability`/`deduct`,
not as a general property of a batch. There's currently no answer to
"which batches are expiring soon, regardless of whether any Plan is using
them" which is exactly what a Dashboard "Stock left" widget (already in
the Feature List) would need, and what the PRD's "warning di tanggal
tertentu" implies independent of Plan lifecycle.

**Recommended addition:** a batch-level, Plan-independent flag/query
e.g. `expiringSoon: expired <= now() + N days` (N configurable, maybe per
category) surfaced via a small addition to `GET /inventory/dropdown` or
a new `GET /inventory/expiring-soon` used by the Dashboard, separate from
the Plan-scoped `batchSafetyStatus`. Two different signals for two
different consumers (Dashboard = general awareness, Plan = "is this
specific plan viable").

## 3. Opened-item shelf life not modeled (Gap, PRD raises it explicitly)

PRD: _"biasanya sih stockingnya mingguan (misal utk barang yg dibuka
kmudian ada batasnya, itu gmn)"_ an opened package (e.g. milk) often has
a _shorter_ effective shelf life than its printed `expired` date once
opened, and the current model has exactly one expiry field per batch,
set at intake.

**Not solved by the current schema.** Would need either: (a) a second,
optional `openedShelfLifeDays` on Inventory (category-level default,
e.g. "milk: 3 days once opened") combined with an `openedAt` timestamp on
the specific `SubInventory` once someone marks it opened, with effective
expiry = `min(expired, openedAt + openedShelfLifeDays)`; or (b) treat it
as out of scope for v1 and accept the printed expiry as the operative one.
Needs a product call flagging rather than deciding, since it changes the
`SubInventory` schema.

## 4. OCR receipt intake explicitly deferred (Not a gap, just confirming)

PRD lists this under "Next" (Management Inventory) and separately notes
_"prompt klasifikasi inventory saat discan ocr ... ocr nanti aja"_ i.e.
already acknowledged as future work by the team, not something this pass
needs to design for. No action needed now; noting it here only so it's
visible next to the rest of the gap list rather than silently dropped.

## 5. External/forecasting guardrails out of scope for Inventory itself

(Not a gap in this module, but a dependency Inventory should be aware of)

The PRD's questions about weather/economic sentiment, discount guardrails,
and "Create Plan with AI" all live in Production Plan / Dashboard, not
Inventory. The one place they touch this module: whatever the Plan
forecasting logic decides (e.g. "push a discount on batch X because it's
near-expiry") will need to read `batchSafetyStatus`/expiry data _from_
Inventory. As long as that data stays accurate and queryable (§2 above),
Inventory doesn't need to model forecasting itself. Flagged only to
confirm the boundary is intentional, not accidental.

## 6. Waste/shortage/leftover reconciliation after a Plan closes belongs

to Production Plan, but needs one Inventory-side confirmation

PRD 5.2 describes comparing expected usage (recipe × qty sold) vs. actual
remaining stock after a plan closes, categorizing the delta into
waste/leftover/shortage, with a >10% threshold triggering a menu-level
warning. This is a Production Plan computation, but it depends on
Inventory exposing an accurate "actual remaining quantity per batch at
plan-close time" which `GET /inventory/:id/subinventory` already
provides. No new Inventory endpoint needed; just confirming the contract
is sufficient once Production Plan is designed. Revisit if Production
Plan's spec turns out to need something Inventory doesn't currently
expose (e.g. a point-in-time snapshot rather than live state).

## 7. Data integrity audit job (Engineering recommendation, not a PRD ask)

Covered in the RFC (§7) and flow doc (§5.7): since MongoDB doesn't enforce
referential integrity, a periodic read-only scan for orphaned references
(`SubInventory` pointing at a missing `Inventory`, `HistoryUsage` pointing
at a missing `SubInventory`, stale `checkResultStale` flags that were
never cleared) is cheap insurance. Not urgent for a single-branch launch,
but worth putting on the backlog before the schema surface grows with
Menu/Plan.

---

## Summary decisions needed before/around implementation

| #   | Item                                    | Blocking?                                                                           |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Rack/location tracking scope            | No can ship without it, needs an explicit "we're accepting this trade-off" sign-off |
| 2   | Plan-independent "expiring soon" signal | Should be added now Dashboard feature already promised in PRD depends on it         |
| 3   | Opened-item shelf life                  | Needs a product decision; schema change if yes                                      |
| 4   | OCR intake                              | Deferred by team already, no action                                                 |
| 5   | Forecasting guardrails                  | Not this module's concern, boundary confirmed                                       |
| 6   | Waste/shortage reconciliation contract  | Revisit once Production Plan is spec'd                                              |
| 7   | Integrity audit job                     | Backlog, not blocking                                                               |
