# selling.flow.md Peta Modul Selling

> Ringkasan status & keputusan modul Selling. Update dokumen ini setiap ada
> keputusan baru atau file baru selesai dibangun.

## Status saat ini

| Layer              | File                                | Status                  |
| ------------------ | ----------------------------------- | ----------------------- |
| RFC final          | `rfc-selling-final.md`              | ✅ Selesai              |
| Model              | `models/selling/selling.model.js`   | ✅ Selesai              |
| Service            | `services/selling.service.js`       | ✅ Selesai (B1, B2, B3) |
| Controller         | `controllers/selling.controller.js` | ✅ Selesai              |
| Routes             | `routes/selling.routes.js`          | ✅ Selesai              |
| Validation         | `validations/selling.validation.js` | ✅ Selesai              |
| Postman collection |                                     | ⬜ Belum dibuat         |

**Modul ini SUDAH LENGKAP** (model → routes). Yang tersisa cuma Postman
collection kalau dibutuhkan buat testing manual.

## Prinsip inti (jangan dilanggar saat lanjut development)

- HANYA baca `ProductionPlan` (status, tanggal, `frozenSellingPrice`,
  `frozenMenuName`, `discount`).
- HANYA tulis `PlanSale` (append-only) + 2 field turunan di
  `ProductionPlan.menus[]`: `soldQuantity`, `soldOutAt`.
- TIDAK PERNAH menyentuh Inventory, `ProductionPlan.status`, atau
  `menus[].discount`.
- **TIDAK ADA dependency ke `menu.service.js`** sejak `frozenMenuName`
  diimplementasi baik harga maupun nama sudah dibekukan di
  `ProductionPlan.menus[]` saat approve.

## Keputusan kunci (detail & rasional di rfc-selling-final.md)

1. **`originalPrice` = `frozenSellingPrice`**, reuse `computePricing()`.
2. **Race condition B2**: pre-check (pesan ramah) + atomic `$expr` guard
   di `findOneAndUpdate` (pengaman sebenarnya).
3. **`remainingQuantity` = `quantityPlanned − soldQuantity − lossQuantity`**
   `lossQuantity` HANYA naik dari laporan Plan Report `category: menu`
   yang `approved` (dikunci final di D-PR3a, `rfc-plan-report-final.md`
   `category: ingredient` tidak pernah menyentuh field ini).
4. **`warning` di B1 di level plan**, sumber `plan.hasPendingLossReplacement`.
5. **`soldOutAt`** diisi di pipeline update yang SAMA dengan increment
   `soldQuantity`.
6. **`menuName` dibekukan** (`frozenMenuName` di Production Plan,
   disnapshot ke `PlanSale.menuName` saat sale) sama prinsip dengan harga
   supaya tampilan kasir tidak berubah kalau admin rename Menu di tengah
   plan aktif.
7. **`cashierName` dari `req.user.name`** (hasil `authenticate()`
   middleware), BUKAN dari body request. Divalidasi di controller layer,
   bukan di `selling.validation.js`.

## Endpoint (path FINAL, sudah match router)

| #   | Method | Path                      | Fungsi service                                            |
| --- | ------ | ------------------------- | --------------------------------------------------------- |
| B1  | GET    | `/api/v1/selling/active`  | `getActivePlans()`                                        |
| B2  | POST   | `/api/v1/selling`         | `createSale({planId, menuId, quantitySold, cashierName})` |
| B3  | GET    | `/api/v1/selling/history` | `getSaleHistory({planId, date, cashierName})`             |

Base path: `router.use('/selling', sellingRoutes)` di index route +
`app.use('/api/v1', routes)` di `app.js` (sama pola dengan `/plans`).

## Dependency ke Plan Report (satu arah, baca saja)

`lossQuantity` yang dipakai `remainingQuantity` baru benar-benar "hidup"
begitu Plan Report C3 (review, category: menu) selesai dibangun. Sampai
saat itu, `lossQuantity` akan selalu 0 untuk plan manapun bukan bug, cuma
belum ada penulisnya.

## Sudah tidak relevan / selesai (dari cross-module reconciliation)

Lihat `cross-module-reconciliation.md` untuk rekap penuh 15 item lintas
modul beberapa di antaranya menyentuh Selling dan sudah resolved (name
freeze, cashierName, rounding standard, base path, dll).
