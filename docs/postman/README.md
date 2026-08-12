# KADA Backend - Postman Documentation

This folder contains Postman documentation and collection files for testing the KADA Backend API endpoints.

## Files

| File | Description |
|------|-------------|
| `auth.postman.md` | Auth endpoints documentation with request/response examples |
| `inventory.postman.md` | Inventory endpoints documentation with request/response examples |
| `dashboard.postman.md` | Dashboard endpoints documentation with request/response examples |
| `kada-auth.postman.json` | Postman collection for Auth API (import directly) |
| `kada-dashboard.postman.json` | Postman collection for Dashboard API (import directly) |
| `kada-inventory.postman.json` | Postman collection for Inventory API (import directly) |

## Quick Start

### Option 1: Import Collection JSON (Recommended)

1. Open Postman
2. Click **Import** button
3. Drag and drop `kada-auth.postman.json` or `kada-inventory.postman.json`
4. Create an environment with variable `baseUrl` = `http://localhost:3000/api/v1`
5. Start testing endpoints

### Option 2: Follow Markdown Documentation

1. Read `auth.postman.md` or `inventory.postman.md`
2. Manually create requests in Postman
3. Copy test scripts from documentation
4. Set up environment variables as described

## Environment Variables

| Variable | Description |
|----------|-------------|
| `baseUrl` | API base URL (e.g., `http://localhost:3000/api/v1`) |
| `accessToken` | JWT access token (auto-set after login) |
| `refreshToken` | Refresh token (auto-set after login) |
| `inventoryId` | Inventory item ID (auto-set after creation) |
| `subInventoryId` | Sub-inventory/batch ID (auto-set after creation) |
| `deductionReference` | Reference for deduction reversal |

## Testing Workflow

### Auth Endpoints

1. Register a new user
2. Send verification email
3. Confirm email verification (use OTP from email)
4. Login → Store tokens
5. Test protected routes with Bearer token
6. Test token refresh
7. Test logout

### Inventory Endpoints

1. Create inventory item → Store ID
2. Add sub-inventory batch → Store batch ID
3. Check availability
4. Deduct inventory → Store reference
5. Reverse deduction
6. View history and audit logs

## API Endpoints Summary

### Auth (11 endpoints)

| Method | Endpoint | Auth Required |
|--------|----------|:---:|
| POST | `/auth/register` | No |
| POST | `/auth/login` | No |
| POST | `/auth/refresh` | No |
| POST | `/auth/logout` | No |
| GET | `/auth/me` | Yes |
| PATCH | `/auth/change-password` | Yes |
| POST | `/auth/verify-email/send` | No |
| POST | `/auth/verify-email/confirm` | No |
| POST | `/auth/forgot-password` | No |
| POST | `/auth/forgot-password/verify-code` | No |
| POST | `/auth/reset-password` | No |

### Inventory (14 endpoints)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/inventory` | Create inventory item |
| GET | `/inventory` | List inventory items |
| GET | `/inventory/dropdown` | Get dropdown list |
| GET | `/inventory/:id` | Get inventory by ID |
| PUT | `/inventory/:id` | Update inventory |
| DELETE | `/inventory/:id` | Delete inventory |
| POST | `/inventory/:id/subinventory` | Add batch |
| GET | `/inventory/:id/subinventory` | List batches |
| DELETE | `/subinventory/:id` | Delete batch |
| POST | `/subinventory/check-availability` | Check FEFO availability |
| POST | `/subinventory/deduct` | Deduct inventory |
| POST | `/subinventory/deduct/reverse` | Reverse deduction |
| GET | `/history-sub-inventory` | Batch history |
| GET | `/history-usage` | Usage history |

## Notes

- All inventory endpoints are currently unprotected (no auth required)
- Auth endpoints use JWT with refresh token rotation
- FEFO (First-Expired-First-Out) ensures oldest batches are used first
- Soft delete is used for inventory and batches
- History logs are append-only for audit trail
