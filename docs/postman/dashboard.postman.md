# Dashboard API — Postman Collection

Dashboard endpoints for the KADA Backend. Import `kada-dashboard.postman.json` into Postman and use `{{baseUrl}}` + `{{authToken}}` for authenticated requests.

---

## Authentication

**Type:** Bearer Token

| Key | Value |
| --- | ----- |
| `token` | `{{authToken}}` |

---

## Variables

| Variable | Default Value |
| -------- | ------------- |
| `baseUrl` | `http://localhost:5000/api/v1` |
| `authToken` | (set in environment after login) |
| `planId` | (set from a plan creation or existing plan) |
| `date` | `2026-08-12` |

---

## Endpoints

### 1. Get Daily Dashboard

| Method | URL |
| ------ | --- |
| GET | `{{baseUrl}}/dashboard/plan/{{planId}}/daily?date={{date}}` |

**Headers**

```
Authorization: Bearer {{authToken}}
```

**Expected Results**

- Status code: `200`
- Response body contains:
  - `success: true`
  - `data` with daily dashboard metrics
  - `message` describing the result

**Notes**

- `planId` must be a valid MongoDB ObjectId (24 hex characters).
- `date` must use the `YYYY-MM-DD` format.
- This endpoint is protected by JWT authentication.
