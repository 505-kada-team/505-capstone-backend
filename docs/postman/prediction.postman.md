# Prediction API — Postman Collection

Prediction endpoints for the KADA Backend. Import `kada-prediction.postman.json` into Postman and use `{{baseUrl}}` + `{{authToken}}` for authenticated requests.

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
| `startDate` | `2026-08-15` |
| `duration` | `7` |
| `tags` | `[]` |

---

## Endpoints

### 1. Assortment Prediction

| Method | URL |
| ------ | --- |
| POST | `{{baseUrl}}/predictions/assortment` |

**Headers**

```
Content-Type: application/json
Authorization: Bearer {{authToken}}
```

**Request Body**

```json
{
  "duration": 7,
  "startDate": "{{startDate}}",
  "tags": ["coffee", "promo"]
}
```

**Expected Results**

- Status code: `200`
- Response body contains:
  - `success: true`
  - `data` with prediction results
  - `message` describing the result

**Notes**

- `duration` must be an integer between `3` and `30`.
- `startDate` must be a valid ISO date string.
- `tags` is optional and can be used to narrow predictions.
- This endpoint is protected by JWT authentication.
