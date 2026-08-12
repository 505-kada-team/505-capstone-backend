# KADA Backend - Production Plan API

Production Plan endpoints for KADA Backend (A1–A10). Paths are mapped to the original `plan.routes.js`. All endpoints are gated by `authenticate()` middleware, so each request **must** include an `Authorization: Bearer {{authToken}}` header.

---

## Authentication

**Type:** Bearer Token

| Key     | Value           |
| ------- | --------------- |
| `token` | `{{authToken}}` |

---

## Variables

| Variable    | Default Value                  |
| ----------- | ------------------------------ |
| `baseUrl`   | `http://localhost:5000/api/v1` |
| `authToken` | (set in environment)           |

---

## Endpoints

### 1. Plan CRUD & Lifecycle

#### A1 – Create Plan (draft)

Creates a new production plan in `draft` status.

| Method | URL                |
| ------ | ------------------ |
| POST   | `{{baseUrl}}/plan` |

**Headers**

```
Content-Type: application/json
```

**Request Body**

```json
{
  "name": "Promo Akhir Bulan",
  "tags": ["promo", "weekend"],
  "startDate": "2024-03-01",
  "duration": 14,
  "menus": [
    {
      "menuId": "{{menuId}}",
      "quantityPlanned": 100
    }
  ]
}
```

**Expected Results**

- Status code: `201`
- Response body:
  - `success` is `true`
  - `data.status` is `"draft"`
  - `data` includes `checkResult` and `readyToApprove`
- Automatically stores `planId` from `data._id` into the environment variable `planId`.

---

#### A2 – List Plans

Retrieve a paginated list of plans with optional filtering.

| Method | URL                                             |
| ------ | ----------------------------------------------- |
| GET    | `{{baseUrl}}/plan?status=draft&page=1&limit=10` |

**Query Parameters**

| Parameter | Value   | Required | Description                          |
| --------- | ------- | -------- | ------------------------------------ |
| `status`  | `draft` | No       | Filter by plan status                |
| `search`  |         | No       | Search by name (disabled by default) |
| `tags`    |         | No       | Filter by tags (disabled by default) |
| `page`    | `1`     | No       | Page number                          |
| `limit`   | `10`    | No       | Items per page                       |

**Expected Results**

- Status code: `200`
- Response body contains:
  - `data.pagination.totalData`
  - `data.pagination.currentPage`
- Each item in `data.data` has the `hasUnsafeBatch` flag.

---

#### A3 – Get Plan Detail

Get detailed breakdown per menu of a specific plan.

| Method | URL                           |
| ------ | ----------------------------- |
| GET    | `{{baseUrl}}/plan/{{planId}}` |

**Expected Results**

- Status code: `200`
- Response includes:
  - `data.suggestion` (suggestion text)
  - `data.inventorySafetyStatus`
- For draft plans, each menu object in `data.menus` contains:
  - `ingredientsDetail`
  - `lowStock`

---

#### A4 – Update Plan (draft only)

Update an existing plan that is still in `draft` status.

| Method | URL                           |
| ------ | ----------------------------- |
| PUT    | `{{baseUrl}}/plan/{{planId}}` |

**Headers**

```
Content-Type: application/json
```

**Request Body**

```json
{
  "name": "Promo Akhir Bulan (Revisi)",
  "duration": 21,
  "menus": [
    {
      "menuId": "{{menuId}}",
      "quantityPlanned": 150
    }
  ]
}
```

**Expected Results**

- Status code: `200`
- After editing, the plan’s staleness flags reset:
  - `data.checkResultStale` is `false`
  - `data.staleReason` is `null`

---

#### A8 – Cancel Plan (draft only)

Cancel a plan in `draft` status.

| Method | URL                           |
| ------ | ----------------------------- |
| DELETE | `{{baseUrl}}/plan/{{planId}}` |

**Expected Results**

- Status code: `200`
- Plan status becomes `"cancelled"`
- `data.cancelledAt` is not `null`

---

### 2. Availability & Approval

#### A5 – Check Availability (refresh)

Refreshes availability/readiness for a draft plan.

| Method | URL                                              |
| ------ | ------------------------------------------------ |
| POST   | `{{baseUrl}}/plan/{{planId}}/check-availability` |

**Expected Results**

- Status code: `200`
- Staleness flags reset:
  - `data.checkResultStale` is `false`
  - `data.staleReason` is `null`
  - `data.readyToApprove` is present

---

#### A6 – Approve Plan (draft → active)

Approves a draft plan, transitioning it to `active` status.  
_The actor is taken from `req.user` (not from the body). If the controller requires an actor in the body, add it manually: `{ "actor": { "name": "Admin Dapur" } }`._

| Method | URL                                   |
| ------ | ------------------------------------- |
| POST   | `{{baseUrl}}/plan/{{planId}}/approve` |

**Request Body**
_(Empty by default – actor is derived from authenticated user)_

**Expected Results**

- Status code: `200`
- Plan status is `"active"`
- `data.approvedAt` is not `null`

---

#### A6 – Approve Plan – Fail (stale blocking)

_Negative scenario: approval blocked when the plan has a blocking stale reason._

**Precondition:** Plan must be in `draft` status with a staleReason of `recipe_changed` or `menu_archived` (e.g., a linked Menu was edited after the plan was created). This verifies PRD Sec.5 step 3.

| Method | URL                                   |
| ------ | ------------------------------------- |
| POST   | `{{baseUrl}}/plan/{{planId}}/approve` |

**Expected Results**

- Status code: `400`
- `success` is `false`

---

#### A7 – Stop Plan (active only)

Stops an active plan immediately.

| Method | URL                                |
| ------ | ---------------------------------- |
| POST   | `{{baseUrl}}/plan/{{planId}}/stop` |

**Headers**

```
Content-Type: application/json
```

**Request Body**

```json
{
  "reason": "Bahan baku ditarik karena isu kualitas",
  "stoppedBy": "Admin Dapur"
}
```

**Expected Results**

- Status code: `200`
- Plan status is `"stopped"`
- `data.stoppedAt` is not `null`
- `data.stopReason` equals `"Bahan baku ditarik karena isu kualitas"`

---

### 3. Discount (per menu in plan)

#### A9 – Set/Replace Discount

Assigns a discount to a specific menu within the plan.

| Method | URL                                                     |
| ------ | ------------------------------------------------------- |
| PUT    | `{{baseUrl}}/plan/{{planId}}/menus/{{menuId}}/discount` |

**Headers**

```
Content-Type: application/json
```

**Request Body**

```json
{
  "discountPercentage": 20,
  "startDate": "2024-03-05",
  "endDate": "2024-03-10",
  "reason": "Batch mendekati kedaluwarsa (unsafe)"
}
```

**Expected Results**

- Status code: `200`
- Discount applied:
  - `data.discount` has `discountedPrice`
  - `data.discount` has `discountStatus`

---

#### A9 – Set Discount – Fail (endDate exceeds plan duration)

Negative validation: discount end date cannot be after the plan’s end date.

| Method | URL                                                     |
| ------ | ------------------------------------------------------- |
| PUT    | `{{baseUrl}}/plan/{{planId}}/menus/{{menuId}}/discount` |

**Headers**

```
Content-Type: application/json
```

**Request Body**

```json
{
  "discountPercentage": 20,
  "startDate": "2024-03-05",
  "endDate": "2099-01-01",
  "reason": "Test validasi endDate"
}
```

**Expected Results**

- Status code: `400` (rejected)

---

#### A10 – Remove Discount

Removes the discount from a menu in the plan.

| Method | URL                                                     |
| ------ | ------------------------------------------------------- |
| DELETE | `{{baseUrl}}/plan/{{planId}}/menus/{{menuId}}/discount` |

**Expected Results**

- Status code: `200`
- `data.discount` is `null`

---
