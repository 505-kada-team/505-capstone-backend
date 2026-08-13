# Inventory API - Postman Documentation

**Base URL:** `http://localhost:3000/api/v1`

## Environment Variables

Create a Postman environment with these variables:

| Variable | Initial Value | Description |
|----------|---------------|-------------|
| `baseUrl` | `http://localhost:3000/api/v1` | API base URL |
| `accessToken` | | JWT access token (if auth enabled) |
| `inventoryId` | | Inventory item ID (auto-set after creation) |
| `subInventoryId` | | Sub-inventory/batch ID (auto-set after creation) |
| `batchCode` | | Batch code (auto-set after creation) |

---

## Inventory Item Card Endpoints

### 1. Create Inventory Item

**Method:** `POST`  
**URL:** `{{baseUrl}}/inventory`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Coffee Beans",
  "category": "ingredients",
  "unit": "kg",
  "description": "Premium Arabica coffee beans",
  "itemCode": "CFB"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Inventory created successfully",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Coffee Beans",
    "itemCode": "CFB",
    "category": "ingredients",
    "unit": "kg",
    "description": "Premium Arabica coffee beans",
    "status": "active",
    "quantityTotal": 0,
    "totalSubInventory": 0,
    "lastCostBatch": 0,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Inventory created successfully", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data).to.have.property('_id');
});

pm.test("Store inventory ID", function () {
    var jsonData = pm.response.json();
    if (jsonData.data._id) {
        pm.environment.set("inventoryId", jsonData.data._id);
    }
});
```

---

### 2. List Inventory Items

**Method:** `GET`  
**URL:** `{{baseUrl}}/inventory`  
**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `category` | string | | Filter: `ingredients` or `packaging` |
| `search` | string | | Search by name (regex) |
| `includeDeleted` | boolean | false | Include soft-deleted items |

**Example URL:** `{{baseUrl}}/inventory?page=1&limit=10&category=ingredients`

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory list fetched successfully",
  "data": {
    "items": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Coffee Beans",
        "itemCode": "CFB",
        "category": "ingredients",
        "unit": "kg",
        "status": "active",
        "quantityTotal": 100,
        "totalSubInventory": 5,
        "lastCostBatch": 25.50
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Pagination data exists", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.pagination).to.have.property('total');
    pm.expect(jsonData.data.pagination).to.have.property('page');
});
```

---

### 3. Get Inventory Dropdown

**Method:** `GET`  
**URL:** `{{baseUrl}}/inventory/dropdown`

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory dropdown fetched successfully",
  "data": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Coffee Beans",
      "itemCode": "CFB",
      "category": "ingredients",
      "unit": "kg"
    }
  ]
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of items", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data).to.be.an('array');
});
```

---

### 4. Get Inventory by ID

**Method:** `GET`  
**URL:** `{{baseUrl}}/inventory/{{inventoryId}}`

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory detail fetched successfully",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Coffee Beans",
    "itemCode": "CFB",
    "category": "ingredients",
    "unit": "kg",
    "description": "Premium Arabica coffee beans",
    "status": "active",
    "quantityTotal": 100,
    "totalSubInventory": 5,
    "lastCostBatch": 25.50,
    "batches": [
      {
        "id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "batchCode": "CFB-20240115-001",
        "quantity": 50,
        "costPrices": 25.50,
        "inDate": "2024-01-15T10:30:00.000Z",
        "expired": "2024-06-15T10:30:00.000Z",
        "daysUntilExpiry": 152,
        "status": "active"
      }
    ]
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Inventory has batches", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.batches).to.be.an('array');
});
```

---

### 5. Update Inventory Item

**Method:** `PUT`  
**URL:** `{{baseUrl}}/inventory/{{inventoryId}}`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Premium Coffee Beans",
  "description": "Updated description for premium beans"
}
```

**Note:** Only `name` and `description` can be updated. `category` and `unit` are immutable after creation.

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory updated successfully",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Premium Coffee Beans",
    "itemCode": "CFB",
    "category": "ingredients",
    "unit": "kg",
    "description": "Updated description for premium beans"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Inventory updated", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

### 6. Delete Inventory Item (Soft Delete)

**Method:** `DELETE`  
**URL:** `{{baseUrl}}/inventory/{{inventoryId}}`

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory archived.",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "status": "deleted"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Inventory archived", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.status).to.eql("deleted");
});
```

---

## Sub-Inventory (Batch) Endpoints

### 7. Add Sub-Inventory Batch

**Method:** `POST`  
**URL:** `{{baseUrl}}/inventory/{{inventoryId}}/subinventory`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "quantity": 50,
  "costPrices": 25.50,
  "inDate": "2024-01-15",
  "expired": "2024-06-15"
}
```

**Note:** `expired` is required for ingredients, null/omitted for packaging.

**Response (201):**
```json
{
  "success": true,
  "message": "Sub-inventory batch added successfully",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
    "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
    "batchCode": "CFB-20240115-001",
    "quantity": 50,
    "costPrices": 25.50,
    "inDate": "2024-01-15T10:30:00.000Z",
    "expired": "2024-06-15T10:30:00.000Z",
    "status": "active"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Batch created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data).to.have.property('batchCode');
});

pm.test("Store batch ID and code", function () {
    var jsonData = pm.response.json();
    if (jsonData.data._id) {
        pm.environment.set("subInventoryId", jsonData.data._id);
    }
    if (jsonData.data.batchCode) {
        pm.environment.set("batchCode", jsonData.data.batchCode);
    }
});
```

---

### 8. List Sub-Inventory Batches

**Method:** `GET`  
**URL:** `{{baseUrl}}/inventory/{{inventoryId}}/subinventory`

**Response (200):**
```json
{
  "success": true,
  "message": "Sub-inventory list fetched successfully",
  "data": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "batchCode": "CFB-20240115-001",
      "quantity": 50,
      "costPrices": 25.50,
      "inDate": "2024-01-15T10:30:00.000Z",
      "expired": "2024-06-15T10:30:00.000Z",
      "daysUntilExpiry": 152,
      "status": "active"
    }
  ]
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of batches", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data).to.be.an('array');
});
```

---

### 9. Delete Sub-Inventory Batch (Soft Delete)

**Method:** `DELETE`  
**URL:** `{{baseUrl}}/subinventory/{{subInventoryId}}`

**Response (200):**
```json
{
  "success": true,
  "message": "Batch archived.",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
    "status": "deleted"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Batch archived", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.status).to.eql("deleted");
});
```

---

## FEFO (First-Expired-First-Out) Endpoints

### 10. Check Availability

**Method:** `POST`  
**URL:** `{{baseUrl}}/subinventory/check-availability`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "items": [
    {
      "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "amountNeeded": 30
    }
  ],
  "availableUntil": "2024-03-01"
}
```

**Note:** `availableUntil` is optional. If provided, checks batch safety status.

**Response (200):**
```json
{
  "success": true,
  "message": "Availability checked successfully",
  "data": {
    "results": [
      {
        "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "nameInventory": "Coffee Beans",
        "amountNeeded": 30,
        "sufficient": true,
        "shortfall": 0,
        "hasUnsafeBatch": false,
        "batches": [
          {
            "subInventoryId": "64f1a2b3c4d5e6f7a8b9c0d2",
            "batchCode": "CFB-20240115-001",
            "take": 30,
            "costPrices": 25.50,
            "batchSafetyStatus": "safe"
          }
        ]
      }
    ],
    "overallSufficient": true,
    "overallHasUnsafeBatch": false
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Availability check complete", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data).to.have.property('overallSufficient');
});

pm.test("Store availability result", function () {
    var jsonData = pm.response.json();
    pm.environment.set("overallSufficient", jsonData.data.overallSufficient);
});
```

---

### 11. Deduct Inventory (FEFO)

**Method:** `POST`  
**URL:** `{{baseUrl}}/subinventory/deduct`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "items": [
    {
      "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "amountNeeded": 30
    }
  ],
  "availableUntil": "2024-03-01",
  "reference": "ORDER-2024-001"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Inventory deducted successfully",
  "data": {
    "reference": "ORDER-2024-001",
    "items": [
      {
        "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "hasUnsafeBatch": false,
        "batches": [
          {
            "subInventoryId": "64f1a2b3c4d5e6f7a8b9c0d2",
            "batchCode": "CFB-20240115-001",
            "quantityUsed": 30,
            "costPriceUsed": 25.50
          }
        ]
      }
    ],
    "historyUsageIds": ["64f1a2b3c4d5e6f7a8b9c0d3"]
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Deduction successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});

pm.test("Store reference for reversal", function () {
    var jsonData = pm.response.json();
    if (jsonData.data.reference) {
        pm.environment.set("deductionReference", jsonData.data.reference);
    }
});
```

---

### 12. Reverse Deduction

**Method:** `POST`  
**URL:** `{{baseUrl}}/subinventory/deduct/reverse`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "reference": "{{deductionReference}}"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Deduction reversed successfully",
  "data": {
    "reference": "ORDER-2024-001",
    "reversedCount": 1
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Reversal successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data.reversedCount).to.be.above(0);
});
```

---

## History / Audit Log Endpoints

### 13. Get Sub-Inventory History

**Method:** `GET`  
**URL:** `{{baseUrl}}/history-sub-inventory`  
**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `inventoryId` | string | | Filter by inventory ID |
| `from` | date | | Start date (ISO format) |
| `to` | date | | End date (ISO format) |

**Example URL:** `{{baseUrl}}/history-sub-inventory?inventoryId={{inventoryId}}&page=1&limit=50`

**Response (200):**
```json
{
  "success": true,
  "message": "Sub-inventory history fetched successfully",
  "data": {
    "items": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
        "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "subInventoryId": "64f1a2b3c4d5e6f7a8b9c0d2",
        "nameInventory": "Coffee Beans",
        "itemCode": "CFB",
        "category": "ingredients",
        "unit": "kg",
        "batchCode": "CFB-20240115-001",
        "quantity": 50,
        "costPrices": 25.50,
        "inDate": "2024-01-15T10:30:00.000Z",
        "expired": "2024-06-15T10:30:00.000Z",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("History returned", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.items).to.be.an('array');
});
```

---

### 14. Get Usage History

**Method:** `GET`  
**URL:** `{{baseUrl}}/history-usage`  
**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `inventoryId` | string | | Filter by inventory ID |
| `from` | date | | Start date (ISO format) |
| `to` | date | | End date (ISO format) |

**Example URL:** `{{baseUrl}}/history-usage?inventoryId={{inventoryId}}&page=1&limit=50`

**Response (200):**
```json
{
  "success": true,
  "message": "Usage history fetched successfully",
  "data": {
    "items": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "inventoryId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "subInventoryId": "64f1a2b3c4d5e6f7a8b9c0d2",
        "nameInventory": "Coffee Beans",
        "batchCode": "CFB-20240115-001",
        "quantityUsed": 30,
        "costPriceUsed": 25.50,
        "reference": "ORDER-2024-001",
        "availableUntil": "2024-03-01T00:00:00.000Z",
        "batchSafetyStatus": "safe",
        "isReversed": false,
        "reversedAt": null,
        "createdAt": "2024-01-20T14:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Usage history returned", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.items).to.be.an('array');
});
```

---

## Error Responses

### 400 - Validation Error
```json
{
  "success": false,
  "message": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "field": "category",
      "message": "Category must be one of: ingredients, packaging"
    }
  ]
}
```

### 404 - Inventory Not Found
```json
{
  "success": false,
  "message": "Inventory not found",
  "code": "NOT_FOUND"
}
```

### 409 - Insufficient Stock
```json
{
  "success": false,
  "message": "Insufficient stock",
  "code": "INSUFFICIENT_STOCK",
  "details": {
    "shortfall": 10,
    "available": 20,
    "needed": 30
  }
}
```

### 409 - Duplicate Entry
```json
{
  "success": false,
  "message": "Inventory with this name and category already exists",
  "code": "DUPLICATE_FIELD"
}
```

---

## Testing Workflow

### Basic CRUD Flow
1. **Create inventory item** → Store `inventoryId`
2. **List inventory** → Verify item exists
3. **Get inventory by ID** → Verify details
4. **Update inventory** → Modify name/description
5. **Delete inventory** → Soft delete

### Batch Management Flow
1. **Create inventory item** → Store `inventoryId`
2. **Add sub-inventory batch** → Store `subInventoryId`
3. **List batches** → Verify batch exists
4. **Delete batch** → Soft delete

### FEFO Deduction Flow
1. **Create inventory with batches** → Have stock available
2. **Check availability** → Verify sufficient stock
3. **Deduct inventory** → Store `reference`
4. **Reverse deduction** → Use reference to undo

### Audit Trail Flow
1. **Perform batch operations** → Create history
2. **Get sub-inventory history** → View batch creation log
3. **Get usage history** → View deduction log with reversal status

---

## Postman Collection Scripts

### Auto-set Variables from Login
```javascript
// In Tests tab of Login request
var jsonData = pm.response.json();
if (jsonData.data.accessToken) {
    pm.environment.set("accessToken", jsonData.data.accessToken);
}
```

### Auto-set Variables from Create Inventory
```javascript
// In Tests tab of Create Inventory request
var jsonData = pm.response.json();
if (jsonData.data._id) {
    pm.environment.set("inventoryId", jsonData.data._id);
}
```

### Auto-set Variables from Add Batch
```javascript
// In Tests tab of Add Batch request
var jsonData = pm.response.json();
if (jsonData.data._id) {
    pm.environment.set("subInventoryId", jsonData.data._id);
}
if (jsonData.data.batchCode) {
    pm.environment.set("batchCode", jsonData.data.batchCode);
}
```

---

## FEFO Business Rules

1. **Batch Priority:** Batches are deducted in order of earliest expiry date first
2. **Expiry Required:** Ingredients must have an expiry date; packaging cannot have one
3. **Atomic Deduction:** All items in a deduction request succeed or fail together
4. **Concurrent Protection:** Atomic `findOneAndUpdate` prevents over-deduction from race conditions
5. **Reversal Rules:** 
   - Restores batch quantities
   - Sets `depleted` batches back to `active` (if not expired/deleted)
   - Does NOT un-expire or un-delete batches
   - Marks usage as `isReversed: true` for audit trail
