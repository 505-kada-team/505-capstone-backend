# report.flow.md Peta Modul Plan Report

> Ringkasan status & keputusan modul Plan Report. Update dokumen ini setiap
> ada keputusan baru atau file baru selesai dibangun.

## Status saat ini

| Layer              | File                                   | Status                    |
| ------------------ | -------------------------------------- | ------------------------- |
| RFC final          | `rfc-plan-report-final.md`             | ✅ Selesai                |
| Model              | `models/report/planReport.model.js`    | ✅ Selesai                |
| Service            | `services/planReport.service.js`       | ⬜ Belum dibuat NEXT STEP |
| Controller         | `controllers/planReport.controller.js` | ⬜ Belum dibuat           |
| Routes             | `routes/planReport.routes.js`          | ⬜ Belum dibuat           |
| Validation         | `validations/planReport.validation.js` | ⬜ Belum dibuat           |
| Postman collection |                                        | ⬜ Belum dibuat           |

## Prinsip inti

- Kasir HANYA bisa membuat laporan (C1). Review (C3) dan penggantian stok
  (C4) adalah wewenang admin.
- `quantityLost` = fakta kejadian, immutable setelah dilaporkan.
- `replacementQuantity` = keputusan operasional admin, TIDAK wajib sama
  dengan `quantityLost`.
- `valuation` (khusus `category: menu`) dihitung SEKALI saat C1, dibekukan
  permanen pola sama dengan `PlanSale.priceUsed`/`menuName`.
- Tidak ada jalur direct-deduct ke Inventory di luar mekanisme PlanReport.

## 2 Konflik yang sudah diselesaikan + 1 klarifikasi penting

Detail lengkap & rasional di `rfc-plan-report-final.md`. Ringkas:

1. **D-PR1** `originalPriceAtLoss` = `frozenSellingPrice`, bukan live
   `Menu.sellingPrice`. Konsisten dengan Selling.
2. **D-PR2/D-PR2a** resep untuk `unitCostAtLoss` diambil LIVE dari
   `Menu.ingredients` (bukan dari `committedIngredients` yang secara
   teknis tidak punya breakdown per-menu). Ingredient tak match →
   `valuation.costComplete: false` + `warning` (field baru).
3. **D-PR3a (klarifikasi dari pemilik produk)** `category: ingredient`
   adalah domain **terpisah total** dari Selling/`remainingQuantity`.
   Fungsinya murni: (a) audit bahan baku pasca-insiden, (b) input mentah
   untuk evaluasi waste/leftover/shortage (PRD 5.2) via Forecasting,
   (c) trigger `hasPendingLossReplacement` untuk C4. TIDAK PERNAH
   mengurangi `menus[].lossQuantity` itu murni domain `category: menu`.

## Keputusan lain yang perlu diingat saat implementasi service

- **`hasPendingLossReplacement`** toggle tabel lengkap titik-tulis
  (C1/C3/C4) ada di D-PR4. C4 WAJIB re-check (bukan asumsi) sebelum set
  `false` masih ada laporan ingredient lain yang pending replacement?
- **`menus[].lossQuantity`** hanya bertambah di C3, HANYA untuk
  `category: menu` yang di-approve. Field ini dikonsumsi langsung oleh
  `selling.service.js` (`remainingQuantity` calculation) Plan Report dan
  Selling **saling bergantung** di titik ini SATU-SATUNYA titik
  ketergantungan, sesuai D-PR3a di atas.
- **Rentang valid `incidentAt`**: plan `active`/`completed` →
  `[startDate, endDate]`; plan `stopped` → `[startDate, stoppedAt]`.
- **`isLateReport`** murni sinyal UI, threshold 24 jam, tidak memblokir
  approve/reject.
- **`refId` dynamic** (D-PR6) service harus resolve manual ke
  `Inventory` atau `Menu` berdasarkan `category`, tidak bisa `populate()`.
- **C1 auto-approve (admin) HARUS reuse fungsi internal yang sama** dengan
  handler C3 untuk penulisan `lossQuantity`/toggle
  `hasPendingLossReplacement` jangan duplikasi logic di 2 tempat (lihat
  item #6 `cross-module-reconciliation.md`).
- **`soldOutAt` tidak terpicu oleh loss** kalau laporan `category: menu`
  yang di-approve C3 membuat `remainingQuantity` menu itu jadi 0, `soldOutAt`
  SEBAIKNYA ikut diisi di titik yang sama (belum final, lihat item #7
  `cross-module-reconciliation.md` putuskan saat coding C3, jangan lupa).

## Dependency ke modul lain

| Modul           | Arah                   | Data                                                                                                                                            |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Production Plan | Baca                   | `status`, `startDate`/`endDate`/`stoppedAt`, `menus[].discount`, `menus[].frozenSellingPrice`, `menus[].frozenMenuName`, `committedIngredients` |
| Production Plan | Tulis                  | `menus[].lossQuantity` (C3, category:menu saja), `hasPendingLossReplacement` (C1/C3/C4), berpotensi `menus[].soldOutAt` (lihat catatan di atas) |
| Menu            | Baca                   | `ingredients[]` (live, untuk resep D-PR2)                                                                                                       |
| Inventory       | Tulis (tidak langsung) | C4 memanggil `inventoryService.deduct()` saga pattern, bukan shared transaction (sama seperti `approvePlan()` Production Plan)                  |
| Selling         | Dibaca oleh            | `menus[].lossQuantity` yang ditulis di sini dipakai `selling.service.js` untuk `remainingQuantity`                                              |

## Yang perlu diputuskan/dikerjakan sebelum lanjut coding service

1. Path routes (`/api/v1/plan-reports` sesuai draft, belum dikonfirmasi ke
   router asli sama proses konfirmasi seperti `/plans` sebelumnya).
2. C4 butuh pola saga/compensating-transaction yang sama dengan
   `approvePlan()` Production Plan (`deduct()` Inventory tidak menerima
   session dari luar).
3. Fungsi `computeMenuLossValuation` (untuk C1, category:menu) belum
   ditulis ini bagian paling kompleks, gabung: live `Menu.ingredients` +
   weighted cost dari `committedIngredients` + `computePricing()` terhadap
   `incidentAt`.
