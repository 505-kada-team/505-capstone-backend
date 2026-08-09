# Plan Report API Documentation

**Base path:** `/api/v1/plan-reports` (asumsi, samakan dengan pola `/plans`
dan `/selling` — belum dikonfirmasi ke `index.js`/`app.js` asli)
**Auth:** Semua endpoint wajib `Authorization: Bearer <token>`. Field
`reportedBy`/`reportedByRole` (C1), `reviewedBy` (C3), `replacedBy` (C4)
**selalu** diambil server-side dari `req.user`, tidak pernah dari body
request — klien tidak bisa menentukan role sendiri.

---

## Ringkasan Endpoint

| #   | Method | Path                              | Akses         | Fungsi                                               |
| --- | ------ | --------------------------------- | ------------- | ---------------------------------------------------- |
| C1  | POST   | `/plan-reports`                   | Kasir & Admin | Lapor kerusakan/kehilangan                           |
| C2  | GET    | `/plan-reports`                   | Admin         | List laporan (filter `planId`/`status`/`category`)   |
| C3  | PUT    | `/plan-reports/:id/review`        | Admin         | ACC/tolak laporan                                    |
| C4  | POST   | `/plan-reports/:id/add-inventory` | Admin         | Tarik stok pengganti (khusus `category: ingredient`) |

---

## Konsep Dasar

- **`quantityLost`** = fakta kejadian, immutable setelah dilaporkan. Tidak
  pernah divalidasi terhadap `committedIngredients`.
- **`category: menu`** dan **`category: ingredient`** adalah **dua domain
  terpisah total**:
  - `menu` → memengaruhi `ProductionPlan.menus[].lossQuantity` (dikonsumsi
    `remainingQuantity` di Selling), plus `valuation` lengkap dihitung
    sekali di C1, dibekukan permanen.
  - `ingredient` → **tidak pernah** menyentuh `lossQuantity`/
    `remainingQuantity`. Murni audit bahan baku pasca-insiden + trigger
    `hasPendingLossReplacement` untuk C4. `valuation` selalu `null`.
- **Harga & diskon** untuk valuasi `category: menu` dievaluasi terhadap
  **`incidentAt`** (waktu kejadian sebenarnya), bukan `now()` — konsisten
  dengan prinsip snapshot yang sama seperti `PlanSale.priceUsed`.
- **`isLateReport`** = `(createdAt − incidentAt) > 24 jam`. Murni sinyal
  UI, tidak memblokir apapun.

---

## C1 — POST `/plan-reports`

### Request Body

```json
{
  "planId": "66c1a2b3d4e5f6a7b8c9d0e1",
  "category": "menu",
  "refId": "66c1a2b3d4e5f6a7b8c9d0e2",
  "quantityLost": 2,
  "incidentAt": "2026-08-05T03:15:00.000Z",
  "reason": "Terjatuh saat penyajian"
}
```

| Field          | Tipe                       | Wajib | Catatan                                                                                                    |
| -------------- | -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `planId`       | ObjectId                   | Ya    | Plan harus berstatus `active`/`stopped`/`completed`                                                        |
| `category`     | `"ingredient"` \| `"menu"` | Ya    |                                                                                                            |
| `refId`        | ObjectId                   | Ya    | `inventoryId` kalau `category: ingredient`, `menuId` kalau `category: menu`                                |
| `quantityLost` | number                     | Ya    | Positif. Wajib integer kalau `category: menu`; boleh pecahan kalau `ingredient` (mis. gram)                |
| `incidentAt`   | ISO date                   | Ya    | `<= now()`, dalam rentang `[startDate, endDate]` plan (atau `[startDate, stoppedAt]` kalau plan `stopped`) |
| `reason`       | string                     | Ya    | Maks 500 karakter                                                                                          |

`reportedBy`/`reportedByRole` **tidak dikirim di body** — diambil server
dari `req.user`. Kalau `req.user.role === 'admin'`, laporan langsung
`status: approved` (auto-approve, efeknya sama seperti lolos C3). Role
lain dianggap `cashier` → `status: pending`.

### Response 201 — kategori `menu`, diskon aktif saat `incidentAt`

```json
{
  "success": true,
  "message": "Laporan berhasil dikirim, menunggu review admin",
  "data": {
    "_id": "...",
    "planId": "...",
    "category": "menu",
    "refId": "...",
    "quantityLost": 2,
    "incidentAt": "2026-08-05T03:15:00.000Z",
    "isLateReport": false,
    "reason": "Terjatuh saat penyajian",
    "reportedBy": "Sari",
    "reportedByRole": "cashier",
    "status": "pending",
    "valuation": {
      "unitCostAtLoss": 4500,
      "costLoss": 9000,
      "originalPriceAtLoss": 25000,
      "discountAppliedAtLoss": true,
      "discountPercentageAtLoss": 15,
      "priceUsedAtLoss": 21250,
      "lostRevenueEstimate": 42500,
      "costComplete": true,
      "warning": null
    },
    "createdAt": "2026-08-05T05:00:00.000Z"
  }
}
```

### Response 201 — kategori `ingredient`, admin (auto-approved)

```json
{
  "success": true,
  "message": "Laporan tercatat dan otomatis disetujui",
  "data": {
    "_id": "...",
    "category": "ingredient",
    "refId": "...",
    "quantityLost": 200,
    "status": "approved",
    "reviewedBy": "Admin A",
    "reviewedAt": "2026-08-04T08:05:00.000Z",
    "valuation": null
  }
}
```

### Error Responses

| HTTP | Kondisi                                                      |
| ---- | ------------------------------------------------------------ |
| 404  | `planId`/`refId` tidak ditemukan                             |
| 409  | Plan berstatus `draft`/`cancelled` — belum pernah aktif      |
| 400  | `incidentAt` di masa depan, atau di luar rentang durasi plan |

`valuation.costComplete: false` (bukan error, tetap 201) kalau ada
ingredient di resep live Menu yang tidak ketemu di `committedIngredients`
plan ini — `valuation.warning` menjelaskan sebabnya.

---

## C2 — GET `/plan-reports`

### Query Params (semua opsional)

`planId`, `status` (`pending`/`approved`/`rejected`), `category`
(`ingredient`/`menu`)

### Response 200

```json
{
  "success": true,
  "message": "Daftar laporan berhasil diambil",
  "data": [
    {
      "_id": "...",
      "planId": "...",
      "category": "menu",
      "refId": "...",
      "nameRef": "Nasi Goreng Spesial",
      "quantityLost": 2,
      "incidentAt": "2026-08-05T03:15:00.000Z",
      "isLateReport": false,
      "status": "pending",
      "valuation": { "...": "objek lengkap, bukan ringkasan" },
      "createdAt": "2026-08-05T05:00:00.000Z"
    }
  ]
}
```

`nameRef` di-resolve live (Menu untuk `category: menu`, Inventory untuk
`category: ingredient`) — bukan snapshot, karena murni untuk tampilan list
admin.

---

## C3 — PUT `/plan-reports/:id/review`

### Request Body

```json
{ "decision": "approved", "adminNote": "Sudah dicek, sesuai" }
```

| Field       | Tipe                         | Wajib |
| ----------- | ---------------------------- | ----- |
| `decision`  | `"approved"` \| `"rejected"` | Ya    |
| `adminNote` | string                       | Tidak |

### Efek `decision: approved`

- `category: menu` → `menus[].lossQuantity` plan terkait bertambah
  `quantityLost`. Kalau ini bikin `remainingQuantity` menu tsb jadi 0
  (dan plan belum lewat `endDate`), `menus[].soldOutAt` ikut terisi —
  sinyal stockout untuk Forecasting mencakup sebab loss, bukan cuma
  penjualan.
- `category: ingredient` → `hasPendingLossReplacement` plan induk jadi
  `true`.

### Efek `decision: rejected`

Tidak ada efek lanjutan ke Plan.

**Valuation TIDAK dihitung ulang di sini** — sudah dibekukan sejak C1,
walau harga/diskon plan sudah berubah sejak laporan dibuat.

### Response 200

```json
{
  "success": true,
  "message": "Laporan disetujui",
  "data": {
    "_id": "...",
    "status": "approved",
    "reviewedBy": "Admin A",
    "reviewedAt": "2026-08-05T06:00:00.000Z",
    "adminNote": "Sudah dicek, sesuai"
  }
}
```

### Error Responses

| HTTP | Kondisi                                                 |
| ---- | ------------------------------------------------------- |
| 404  | Laporan tidak ditemukan                                 |
| 400  | Laporan bukan `status: pending` (sudah pernah direview) |

---

## C4 — POST `/plan-reports/:id/add-inventory`

Hanya berlaku untuk laporan `category: ingredient`, `status: approved`,
`replacementDeducted: false`, dan **plan terkait masih `active`**
(berbeda dari C1 yang menerima plan `active`/`stopped`/`completed` —
penggantian stok fisik cuma masuk akal kalau plan masih berjalan).

### Request Body

```json
{
  "replacementQuantity": 200,
  "availableUntil": "2026-08-19T00:00:00.000Z",
  "varianceNote": null
}
```

| Field                 | Tipe     | Wajib | Catatan                                                                                                            |
| --------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `replacementQuantity` | number   | Tidak | Default = `quantityLost` laporan kalau tidak dikirim. Boleh beda dari `quantityLost` (keputusan operasional admin) |
| `availableUntil`      | ISO date | Tidak | Dipakai FEFO safety-status evaluation                                                                              |
| `varianceNote`        | string   | Tidak | Catatan kalau `replacementQuantity` beda dari `quantityLost`                                                       |

### Response 200

```json
{
  "success": true,
  "message": "Stok pengganti berhasil ditarik dan dicatat di laporan",
  "data": {
    "reportId": "...",
    "replacementBatches": [
      { "subInventoryId": "...", "quantityUsed": 200, "costPriceUsed": 11000 }
    ],
    "replacementCost": 2200000
  }
}
```

Setelah sukses, sistem **re-check** (bukan asumsi langsung) apakah masih
ada laporan `ingredient`/`approved`/`replacementDeducted: false` lain
untuk plan yang sama — kalau tidak ada, `hasPendingLossReplacement` plan
induk baru di-set `false`.

### Error Responses

| HTTP | Kondisi                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| 409  | Precondition tidak terpenuhi (belum approved, bukan `ingredient`, sudah pernah diganti) |
| 409  | Plan terkait bukan `active`                                                             |
| 409  | Stok pengganti tidak mencukupi di Inventory                                             |

**Catatan reliability:** deduct ke Inventory dan penyimpanan `PlanReport`
adalah **2 transaction terpisah** (saga pattern, sama seperti
`approvePlan()` Production Plan) — kalau step kedua gagal setelah stok
sudah tertarik, sistem otomatis kompensasi (`reverseDeduct`). Kegagalan
ganda (deduct sukses, save gagal, DAN reverse juga gagal) di-log sebagai
`CRITICAL` untuk investigasi manual.

---

## Field Reference — `PlanReport`

| Field                                                          | Tipe           | Keterangan                                                            |
| -------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `category`                                                     | enum           | `ingredient` \| `menu`                                                |
| `refId`                                                        | ObjectId       | Dynamic — `Inventory` atau `Menu` tergantung `category`               |
| `valuation`                                                    | object \| null | Hanya terisi untuk `category: menu`, dibekukan permanen sejak C1      |
| `valuation.costComplete`                                       | boolean        | `false` kalau ada ingredient resep yang di-skip dari perhitungan cost |
| `replacementQuantity`, `replacementBatches`, `replacementCost` | —              | Hanya relevan untuk `category: ingredient`, terisi setelah C4         |
