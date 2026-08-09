# selling.flow.md Peta Modul Selling

> Dokumen ini adalah ringkasan status & keputusan modul Selling, ditulis
> supaya siapapun (manusia atau AI) yang lanjut kerjakan modul ini tidak
> perlu membaca ulang seluruh histori diskusi. Update dokumen ini setiap
> kali ada keputusan baru atau file baru selesai dibangun.

## Status saat ini

| Layer              | File                                | Status                  |
| ------------------ | ----------------------------------- | ----------------------- |
| Model              | `models/selling/planSale.model.js`  | ✅ Selesai              |
| Service            | `services/selling.service.js`       | ✅ Selesai (B1, B2, B3) |
| Controller         | `controllers/selling.controller.js` | ⬜ Belum dibuat         |
| Routes             | `routes/selling.routes.js`          | ⬜ Belum dibuat         |
| Validation         | `validations/selling.validation.js` | ⬜ Belum dibuat         |
| Postman collection |                                     | ⬜ Belum dibuat         |

RFC final: **`rfc-selling-final.md`** (sudah disetujui, semua keputusan di
bawah ini bersumber dari situ).

## Prinsip inti (jangan dilanggar saat lanjut development)

Modul ini **sempit dan tegas by design**:

- HANYA baca `ProductionPlan` (status, tanggal, `frozenSellingPrice`, `discount`).
- HANYA tulis `PlanSale` (append-only, tidak ada update/delete) + 2 field
  turunan di `ProductionPlan.menus[]`: `soldQuantity`, `soldOutAt`.
- TIDAK PERNAH menyentuh Inventory, `ProductionPlan.status`, atau
  `menus[].discount`.

Kalau ada perubahan requirement yang minta modul ini menyentuh salah satu
dari 3 hal terlarang di atas, itu tanda desain-nya salah tempat cek
ulang apakah harusnya masuk ke Production Plan atau Plan Report module,
bukan Selling.

## Keputusan kunci (ringkas detail & rasional di rfc-selling-final.md)

1. **`originalPrice` = `frozenSellingPrice`**, bukan live `Menu.sellingPrice`.
   Di-reuse dari `computePricing()` (`utils/planCompute.js`) fungsi yang
   sama dipakai Production Plan. Jangan bikin logic harga kedua.
2. **Race condition B2** ditangani 2 lapis: pre-check (pesan error ramah)
   - atomic `$expr` guard di `findOneAndUpdate` (pengaman sebenarnya).
     Lihat implementasi di `createSale()`.
3. **`remainingQuantity = quantityPlanned − soldQuantity − lossQuantity`**
   asumsi `lossQuantity` cuma naik dari laporan Plan Report yang
   **sudah approved** (dikonfirmasi di `rfc-plan-report-final.md` D-PR3).
4. **`warning` di B1 ada di level plan**, bukan per-menu, sumbernya
   `plan.hasPendingLossReplacement`.
5. **`soldOutAt`** diisi di pipeline update yang SAMA dengan increment
   `soldQuantity` (bukan query terpisah) supaya kondisi "baru saja habis"
   dievaluasi terhadap nilai state setelah transaksi ini, bukan sebelum.

## Endpoint (path masih ASUMSI, belum ada file routes)

| #   | Method | Path (asumsi)             | Fungsi service                                            |
| --- | ------ | ------------------------- | --------------------------------------------------------- |
| B1  | GET    | `/api/v1/selling/active`  | `getActivePlans()`                                        |
| B2  | POST   | `/api/v1/selling`         | `createSale({planId, menuId, quantitySold, cashierName})` |
| B3  | GET    | `/api/v1/selling/history` | `getSaleHistory({planId, date, cashierName})`             |

Base path mengikuti pola modul lain (`/api/v1` di `app.js`, sub-router
di-mount di `index.js`) belum dikonfirmasi nama segmen (`selling` vs
`sales` vs lainnya), samakan dengan pola `/plans` (plural) yang dipakai
Production Plan kalau mau konsisten.

## Yang masih perlu diputuskan/dikerjakan sebelum modul ini "selesai"

1. **`actor`/auth untuk `cashierName`** apakah `cashierName` dikirim
   manual dari body (seperti draft RFC), atau diambil dari `req.user`
   (kalau sistem auth punya role kasir dengan nama tersimpan)? Ini
   menentukan apakah field itu perlu validasi tambahan di
   `selling.validation.js` atau tidak usah divalidasi sama sekali (submit
   dari server-side).
2. **Controller, routes, validation** belum dibuat perlu pola yang sama
   seperti `plan.controller.js`/`plan.routes.js`/`plan.validation.js`.
3. **Postman collection** untuk endpoint Selling belum dibuat (pola sama
   seperti `production-plan-postman-collection.json`).
4. **Dependency ke Plan Report**: field `lossQuantity` yang dipakai di
   `remainingQuantity` baru benar-benar "hidup" begitu Plan Report C3
   (review) selesai dibangun sebelum itu, `lossQuantity` akan selalu 0
   untuk plan manapun (bukan bug, cuma belum ada penulisnya).
