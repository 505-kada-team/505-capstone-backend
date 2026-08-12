# Menu (Recipe) Management Flow Documentation (v2)

**Scope:** recipe definitions for the coffee shop what a menu item is made
of and what it sells for. Consumed by Production Plan (stock simulation)
and Dashboard (menu engineering later).
**Stack:** Node.js / Express, MongoDB (Mongoose).

Companion to `08-rfc-menu-architecture.md` (why these choices). Builds on
`04-inventory-flow.md` / `05-rfc-inventory-architecture.md` read those
first if you haven't; this module is defined largely in contrast to them.

---

## 1. What Menu References and Why That Matters

**Menu references `Inventory` (the item type), never `SubInventory` (a
batch).**

- `Inventory` = "what kind of ingredient" a stable definition (name,
  category, unit).
- `SubInventory` = "which physical batch" comes and goes, depletes,
  expires.

A recipe ("Nasi Goreng needs 200gr rice") is a fact about the _type_ of
ingredient, not about any specific batch of rice. Because of this, **batch
stock state never blocks Menu creation or editing** you can define or
save a recipe for an ingredient that currently has zero stock. Whether
there's _enough_ stock to actually produce it is a question for Production
Plan, asked later, against the batch layer.

---

## 2. Live Data, Not Snapshot the Opposite of History's Rule

This is the one place Menu deliberately does the **opposite** of what
`HistorySubInventory`/`HistoryUsage` do in the Inventory module.

|                    | History records                                             | Menu                                                                                            |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| What it represents | A fact about the past ("this batch cost X on this date")    | A definition of the present ("this recipe currently needs X")                                   |
| Storage rule       | Snapshot fields, frozen at write time                       | Only `inventoryId` + `quantityNeeded` stored; everything else read live                         |
| Why                | The past shouldn't change when unrelated data changes later | A recipe should always reflect current reality stale display data would be a bug, not a feature |

Concretely: `Menu.ingredients[]` stores only `{ inventoryId,
quantityNeeded }`. Every other ingredient field shown to the user
`nameInventory`, `category`, `unit`, `inventoryStatus`,
`currentCostPerUnit` (= `Inventory.lastCostBatch`), `subtotalCost`,
`currentCostEstimate`, `marginEstimate`, `marginPercentage`,
`costComplete` is computed **at read time**, not stored.

Consequences:

- Rename an Inventory item → every Menu referencing it shows the new name
  immediately, no update needed.
- Archive an Inventory item → any Menu still referencing it keeps working,
  but is marked (`inventoryStatus: "deleted"`, `costComplete: false`) so
  the user knows a piece of the recipe is no longer active.
- `unit` is never duplicated onto Menu it's locked on Inventory since
  creation, so there's nothing to keep in sync.

---

## 3. Cost & Margin Always an Estimate

```
currentCostEstimate = Σ (quantityNeeded_i × lastCostBatch_i)   over all ingredients i
marginEstimate       = sellingPrice − currentCostEstimate
marginPercentage     = marginEstimate / sellingPrice × 100
```

Uses `lastCostBatch` (Inventory's cached "newest active batch" cost) the
same fast-estimate field Menu's cost model was built around in the
Inventory RFC. It is **not** `costPriceUsed` (the actual FEFO-deducted
cost), which only exists once a Production Plan has actually run a
deduction. Menu-level margin is always labeled as an estimate for this
reason; actual COGS lives in `HistoryUsage` reports, a different module.

**`costComplete: false`** if any ingredient's `lastCostBatch` is `null`
(no batch ever purchased) or its Inventory is archived, the estimate isn't
computed as if the missing piece were free (`0`) the whole
`currentCostEstimate`/`marginEstimate`/`marginPercentage` triplet is
returned as `null`, with `costComplete: false` and a `warning` string, so
the UI can't accidentally show a misleadingly-low cost.

---

## 4. Status Lifecycle

```
        create
          │
          ▼
      ┌ active ┐──── DELETE ──▶ deleted   (unconditional  see §5)
      └────────┘
```

Unlike `Inventory`, there is **no delete guard**. Archiving a Menu is never
blocked, because Menu has no "stock" of its own to protect it's a pure
definition. This is a deliberate asymmetry with Inventory, not an
inconsistency; see the RFC for the reasoning.

---

## 5. Cascade Effect: Draft Production Plan Staleness

Menu doesn't own Production Plan data, so it never edits a Plan directly
it only **flags** drafts as stale, the same pattern Inventory uses (see
`04-inventory-flow.md` §5.5). Two triggers originate from this module:

| Trigger                              | Fired by                                                                  | staleReason        |
| ------------------------------------ | ------------------------------------------------------------------------- | ------------------ |
| Ingredients or selling price changed | `PUT /api/menu/:id` when payload includes `ingredients` or `sellingPrice` | `"recipe_changed"` |
| Menu archived                        | `DELETE /api/menu/:id`                                                    | `"menu_archived"`  |

Both are **bulk updates** against `ProductionPlan` documents where
`status: "draft"` and `menus[].menuId` matches cheap (`checkResultStale`
is a single boolean field), and the affected IDs are returned in the
response as `affectedDraftPlans` so the admin UI can show "N draft plans
need a refresh" without a separate query.

Editing only `name`/`description`/`image` does **not** trigger this
those fields don't feed into any Plan calculation.

**Open item, explicitly flagged for the Production Plan module:** should
`menu_archived` (like `recipe_changed`) hard-block draft approval, or only
soft-warn like the three Inventory-originated triggers
(`stock_taken`/`batch_removed`/`inventory_archived`)? The source design
doc leans toward "should block" (a Plan shouldn't go active referencing an
archived recipe) this needs to be finalized when Production Plan's spec
is written, not decided here. Menu's responsibility ends at emitting the
flag correctly.

---

## 6. Endpoint Reference

| #   | Method & Path            | Purpose                             | Notes                                                                                             |
| --- | ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `POST /api/menu`         | Create menu                         | Validates every `inventoryId` is `active`; rejects duplicate `inventoryId` within the payload     |
| 2   | `GET /api/menu`          | Paginated list                      | Summary cost fields computed per row                                                              |
| 3   | `GET /api/menu/:id`      | Detail + full cost/margin breakdown | Per-ingredient `inventoryStatus`; `costComplete`/`warning` if incomplete                          |
| 4   | `PUT /api/menu/:id`      | **[v2]** Edit                       | `ingredients[]` is full-replace, not patch; triggers stale-flagging, returns `affectedDraftPlans` |
| 5   | `DELETE /api/menu/:id`   | **[v2]** Archive                    | Never blocked; triggers stale-flagging, returns `affectedDraftPlans`                              |
| 6   | `GET /api/menu/dropdown` | **[v2]** Minimal active list        | No pagination, same pattern as Inventory's dropdown; used by Production Plan draft creation       |

---

## 7. Referential Integrity Notes (extends Inventory §5)

- **Validate-before-write:** every `inventoryId` in `ingredients[]` must
  resolve to an `active` `Inventory` document at write time (create _and_
  edit) same pattern as Inventory validating references before it
  writes a `SubInventory`.
- **No snapshot needed here** (contrast with History collections) see
  §2. This is the one relationship in the whole system that's
  intentionally _not_ denormalized, because staleness would be the bug,
  not the fix.
- **No delete guard needed** (contrast with Inventory's active-stock
  check) Menu has nothing analogous to "stock" that soft-delete could
  strand.
- **Stale-flag propagation** to `ProductionPlan` drafts is the same
  "flag, don't cascade-delete" mechanism as Inventory two more trigger
  reasons added to the set Production Plan needs to handle
  (`recipe_changed`, `menu_archived`), on top of the three
  Inventory-originated ones.
