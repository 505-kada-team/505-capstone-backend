# RFC-0003: Menu (Recipe) Module Architecture

- **Status:** Accepted (v2, supersedes the v1 open question on archive
  blocking)
- **Context:** builds directly on Inventory (RFC-0002). Menu is the recipe
  layer between raw Inventory data and Production Plan's stock simulation.

---

## 1. Reference `Inventory`, never `SubInventory`

**Decision:** `Menu.ingredients[].inventoryId` points at `Inventory`
(the type), not at any specific batch.

**Alternative considered:** letting a recipe pin a specific batch (or let
Production Plan pre-resolve to batches at Menu-definition time).

**Why:** a recipe is a statement about _what kind_ of ingredient is
needed, true regardless of which batch happens to be in stock this week.
Pinning to a batch would mean a recipe silently breaks the moment that
batch depletes — nonsensical, since a batch depleting is the _normal,
expected_ lifecycle event, not a reason to invalidate a recipe. Batch
resolution (which specific `SubInventory` gets used) is inherently a
point-in-time stock question, correctly owned by Production Plan's FEFO
logic, not by the recipe definition.

---

## 2. Live-computed ingredient data, not snapshots — the deliberate

inverse of the History pattern

**Decision:** `Menu` stores only `{inventoryId, quantityNeeded}` per
ingredient; name/category/unit/cost are read live from `Inventory` on
every access.

**Why this is the right call here, despite Inventory's RFC arguing
_for_ snapshotting in `HistorySubInventory`/`HistoryUsage`:** the
snapshot decision in those collections exists because they represent
**facts about a specific past moment** — "this batch cost X when it was
purchased on date Y" must never change retroactively. A `Menu` document
represents the **opposite kind of thing**: a currently-live definition
that's supposed to track the present. If `Menu` snapshotted `nameInventory`
at creation time, renaming an `Inventory` item would leave every Menu
referencing it silently showing a stale name — a bug masquerading as a
feature. The rule isn't "always snapshot" or "never snapshot" — it's
_snapshot facts about the past, look up facts about the present live_.
Menu and History apply the same rule and land on opposite storage
strategies because they're answering different kinds of questions.

**Consequence:** every Menu read does an `Inventory` lookup per
ingredient (population, not a stored copy) — an acceptable cost since
Menu reads are far less frequent and far less latency-sensitive than, say,
Inventory's `authenticate` middleware check.

---

## 3. Cost fields stay in Menu as _estimates only_, never promoted to

actuals

**Decision:** `currentCostEstimate`/`marginEstimate`/`marginPercentage`
are always computed from `lastCostBatch`, never from `costPriceUsed`, and
are never persisted on the Menu document.

**Why:** this directly extends the three-tier cost model from
RFC-0002 §6 — `lastCostBatch` is the only cost figure available _before_ a
Plan actually runs a deduction, since `costPriceUsed` doesn't exist until
FEFO has picked a real batch. Persisting a computed margin on the Menu
document would also reintroduce exactly the kind of staleness §2 was
designed to avoid — cost changes constantly as new batches come in, so a
stored margin would be wrong within days. Computing on read keeps it
honest at the cost of a cheap aggregation.

---

## 4. Unconditional archive — no delete guard, unlike Inventory

**Decision:** `DELETE /api/menu/:id` is never blocked by anything.

**Why the asymmetry with Inventory is principled, not an oversight:**
Inventory's delete guard exists specifically to protect **stock that still
has value** (`quantity > 0` on an active batch) — deleting it would strand
real, on-hand goods. Menu has no equivalent: it's a definition, not an
asset. There's nothing a Menu archive could "strand." The philosophy is
actually the _same_ one applied consistently — soft-delete never blocks
based on "is something referencing this," only on "would this delete
destroy something of real value that can't be recovered." Inventory has
such a thing (physical stock); Menu doesn't.

---

## 5. Cascade via bulk stale-flagging, not direct mutation of Plan state

**Decision:** `PUT`/`DELETE` on Menu bulk-updates `ProductionPlan` drafts'
`checkResultStale`/`staleReason`, and returns the affected IDs as
`affectedDraftPlans` — the same "flag, don't cascade" mechanism Inventory
uses (RFC-0002 §7 / flow doc §5.5), now extended with two new reasons
(`recipe_changed`, `menu_archived`).

**Why keep this pattern rather than inventing something new for Menu:**
consistency has real value here — Production Plan only needs to implement
_one_ staleness-handling code path regardless of which upstream module
triggered it (Inventory or Menu). Diverging designs per module would mean
Production Plan needs N different reconciliation strategies instead of
one that reads a `staleReason` enum. `affectedDraftPlans` in the response
is new relative to Inventory's version of this pattern — added because
Menu edits are typically an interactive, single-admin action (a form
submit) where showing an immediate "N drafts affected" toast is valuable
UX; Inventory's triggers (archiving stock, depleting a batch) are more
often background/bulk operations where that immediacy matters less.

---

## 6. `PUT` replaces `ingredients[]` wholesale, never patches

**Decision:** editing ingredients means sending the complete new array;
there's no add-one/remove-one/update-quantity sub-endpoint.

**Alternative considered:** array-patch semantics (e.g.
`PATCH /menu/:id/ingredients/:inventoryId`).

**Why full-replace:** it makes "did this edit change the recipe" a trivial
yes/no for the stale-flag trigger (§5) — either `ingredients` was present
in the payload or it wasn't, no diffing required to decide whether
`recipe_changed` should fire. A patch-style API would still need to answer
"does this specific patch materially change the committed recipe," which
is genuinely ambiguous (does reordering count? does changing quantity by
0.001 count?) — full-replace sidesteps the question entirely by treating
any `ingredients` in the payload as "the recipe was touched, re-validate
everything downstream."

---

## 7. Open item carried forward (not resolved in this RFC)

Whether `menu_archived` should **hard-block** Production Plan draft
approval (like `recipe_changed` is expected to) or only **soft-warn**
(like the three Inventory-originated triggers) is explicitly left open
for Production Plan's own RFC. Recommendation, not a decision: treat it
like `recipe_changed` — a Plan referencing an archived menu shouldn't be
approvable without an explicit re-check, since "the recipe no longer
officially exists" is at least as serious as "the recipe's ingredients
changed." Final call belongs to whoever specs Production Plan, since it's
a Plan-side gating rule, not a Menu-side one.

---

## 8. Summary Table

| Concern                       | Choice                                                            | Primary reason                                                                                             |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| What Menu references          | `Inventory`, never `SubInventory`                                 | Recipe is a type-level fact, batch resolution is Production Plan's job                                     |
| Ingredient display data       | Live-computed, not snapshotted                                    | Menu represents the present, not a historical fact — opposite of History's rule, same underlying principle |
| Cost/margin                   | Always an estimate (`lastCostBatch`), never persisted             | Avoids reintroducing staleness; actual COGS lives elsewhere (`costPriceUsed`)                              |
| Delete guard                  | None — unconditional archive                                      | Menu has no stock-like asset to strand, unlike Inventory                                                   |
| Cascade mechanism             | Bulk stale-flag on Plan drafts + `affectedDraftPlans` in response | Reuses Inventory's pattern for Plan-side consistency; adds immediate UX feedback for interactive edits     |
| `PUT ingredients[]` semantics | Full replace, never patch                                         | Makes "recipe changed, yes/no" trivial and unambiguous for the stale trigger                               |
