# RFC: Production Plan v3 Per-Menu Ingredient Breakdown & `menu_archived` Stale Trigger

**Status:** Draft untuk review
**Supersedes:** Production Plan v2 (bagian A3 response, `checkResult` schema, race condition table)
**Author:** Pencit / 505-Kada-Team
**Modul terdampak:** Production Plan (utama), Menu (konsumsi kontrak existing tidak perlu perubahan), Inventory (tidak berubah)
**Referensi:** `04-inventory-flow.md`, `05-rfc-inventory-architecture.md` (Inventory), dokumen flow Menu v2 dibaca ulang saat revisi ini untuk konfirmasi kontrak cost sebelum implementasi

---

## 1. Latar Belakang & Masalah

Wireframe detail plan (mockup terlampir tim) menuntut breakdown ingredient **per menu individual** tiap kartu menu (mis. "Ice Americano") menampilkan kebutuhan bahannya sendiri: jumlah butuh, tersedia, kurang, kadaluarsa, status aman/tidak aman.

Masalahnya, `checkResult` di v2 didesain sebagai **agregat lintas menu** `quantityNeeded` per `inventoryId` sudah dijumlahkan dari seluruh menu yang memakai bahan itu. Data ini tidak bisa langsung dipecah kembali ke level "menu X butuh berapa dari bahan Y", padahal itu yang dibutuhkan wireframe.

Selain itu, ada satu item terbuka dari race condition table v2: trigger `checkResultStale` baru mencakup 4 sumber (`stock_taken`, `batch_removed`, `inventory_archived`, `recipe_changed`). Belum ada penanganan untuk kasus **Menu di-soft-delete/arsip** sementara masih dipakai draft Plan yang belum di-approve ini jadi trigger ke-5: `menu_archived`.

RFC ini menutup dua gap tersebut sekaligus, karena keduanya sama-sama menyentuh titik integrasi Menu ↔ Production Plan.

> **Revisi:** draft awal RFC ini sempat mengasumsikan Production Plan perlu menghitung cost bahan baku sendiri (weighted-average dari batch FEFO). Setelah dokumen flow Menu v2 dan Inventory dibaca ulang, ternyata Menu module **sudah** punya mekanisme cost estimate resmi (`currentCostEstimate`, §3 dokumen Menu) yang seharusnya di-reuse, bukan diduplikasi dengan metodologi berbeda. Bagian 4.5 di bawah sudah direvisi mengikuti temuan ini lihat juga catatan di §9 Open Questions yang jadi gugur karenanya.

## 2. Cakupan

**In-scope:**

- Field baru `menus[].ingredientsDetail` di response A3 (breakdown per menu)
- Field baru `menus[].lowStock`, `menus[].costPerPortion`, `menus[].estimatedProfit`, `menus[].costComplete` (semua computed, response-only, direct pass-through/derivasi dari Menu module)
- Field baru `suggestion` di level Plan (derived, untuk UI "Saran")
- Trigger ke-5: `staleReason: "menu_archived"` **sudah didokumentasikan resmi di sisi Menu module** (dokumen flow Menu v2, §5 "Cascade Effect: Draft Production Plan Staleness"), RFC ini tinggal mengonfirmasi perlakuan blocking di sisi Production Plan (§4.1)

**Out-of-scope (tidak berubah):**

- Struktur `checkResult` agregat itu sendiri tetap dipertahankan sebagai source of truth untuk deduct saat approve
- Logic diskon (A9/A10)
- `committedIngredients` di plan yang sudah `active` (breakdown per-menu ini hanya relevan selama `draft`, karena begitu `active` alokasi sudah final via `committedIngredients`)
- Menambahkan field HPP permanen ke skema Menu cost tetap murni derived, tidak ada perubahan skema di modul Menu
- **Perubahan apapun di modul Inventory** draft awal RFC ini sempat mengusulkan perluasan endpoint 11 (`check-availability`) untuk menyertakan `costPrice`, tapi ini dibatalkan setelah dikonfirmasi Production Plan bisa reuse cost estimate dari Menu langsung. Lihat 4.5.
- **Perubahan apapun di endpoint Menu** endpoint soft-delete (`DELETE /api/menu/:id`) dan trigger `menu_archived`-nya sudah terimplementasi/terdokumentasi di sisi Menu module; Production Plan murni jadi konsumer flag `staleReason` yang sudah dikirim

## 3. Keputusan Desain: Kenapa Compute di Backend, Bukan di Frontend

Sempat dipertimbangkan biar FE saja yang join data recipe Menu + `checkResult`. Ditolak, karena:

1. **Konsistensi source of truth** kalau logic breakdown ada di FE, ada risiko drift kalau ada 2 klien (web admin, mobile) yang implementasi joinnya beda.
2. **`availableQuantity` adalah shared pool**, bukan alokasi eksklusif per menu. Ini gampang salah diimplementasikan di FE kalau tidak ngerti detail FEFO. Backend yang sudah punya `checkResult` lengkap lebih aman melakukan ini sekali di satu tempat.
3. Pola existing di dokumen v2 sendiri sudah "compute at access time, tidak disimpan permanen" (lihat `effectiveSellingPrice`, `discountedPrice`) breakdown ini konsisten mengikuti pola yang sama, bukan pola baru.

Konsekuensi: `ingredientsDetail` **tidak disimpan** ke DB, dihitung ulang tiap kali A3 diakses (sama seperti `effectiveSellingPrice`).

## 4. Perubahan Skema

### 4.1 `ProductionPlan.staleReason` enum diperluas

```
"stock_taken" | "batch_removed" | "inventory_archived" | "recipe_changed" | "menu_archived" | null
```

| staleReason            | Trigger                                                                    | Sumber                      | Blokir approve?                                |
| ---------------------- | -------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------- |
| `menu_archived` (baru) | Menu yang dipakai draft ini di-soft-delete (status → `deleted`/`archived`) | Menu (endpoint soft-delete) | **Ya** sama perlakuan seperti `recipe_changed` |

**Kenapa blocking, bukan flag murah kayak 3 trigger pertama?** Kalau `menuId` yang diarsipkan tetap dibiarkan lolos approve, plan akan mem-produksi porsi dari Menu yang sudah tidak seharusnya dijual (resep dianggap tidak berlaku lagi secara bisnis). Ini beda kelas risiko dari sekadar "stok berkurang" closer ke `recipe_changed` karena mengubah validitas agregasi menu itu sendiri, bukan cuma soal ketersediaan bahan.

**Konfirmasi silang:** dokumen flow Menu v2 §5 secara eksplisit menandai ini sebagai open item dari sisi mereka ("should `menu_archived` hard-block draft approval, or only soft-warn... needs to be finalized when Production Plan's spec is written") dan menyebutkan source design doc mereka sendiri sudah condong ke "should block". Keputusan blocking di RFC ini **menutup item tersebut secara resmi** dari sisi Production Plan kedua modul sekarang sepakat.

### 4.2 `menus[]` field baru (computed, response-only)

| Field               | Tipe           | Keterangan                                                                                                                                                                                                  |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowStock`          | boolean        | `true` kalau minimal satu `ingredientsDetail[].shortfall > 0` untuk menu ini                                                                                                                                |
| `costPerPortion`    | number \| null | **Revisi dari draft sebelumnya** bukan dihitung independen oleh Production Plan, tapi **langsung pass-through** dari `Menu.currentCostEstimate` (live fetch). `null` kalau `costComplete: false`. Lihat 4.5 |
| `costComplete`      | boolean        | Pass-through dari `Menu.costComplete`. `false` kalau ada ingredient dengan `lastCostBatch: null` atau Inventory-nya sudah diarsip                                                                           |
| `costWarning`       | string \| null | Pass-through dari `Menu.warning` kalau `costComplete: false`, else `null`                                                                                                                                   |
| `estimatedProfit`   | number \| null | `(effectiveSellingPrice − costPerPortion) × quantityPlanned`. `null` kalau `costComplete: false` **tidak** dihitung seolah bagian yang hilang gratis (`0`), konsisten sama aturan Menu module               |
| `ingredientsDetail` | array          | Breakdown per bahan, khusus menu ini. Lihat sub-skema 4.3                                                                                                                                                   |

### 4.3 Sub-skema baru: `menus[].ingredientsDetail[]`

| Field               | Tipe                   | Keterangan                                                                                                                                                                                                        |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventoryId`       | ObjectId               |                                                                                                                                                                                                                   |
| `nameInventory`     | string                 |                                                                                                                                                                                                                   |
| `quantityNeeded`    | number                 | **Khusus menu ini** `qty per porsi (dari resep Menu) × quantityPlanned`. Beda dari `checkResult[].quantityNeeded` yang agregat lintas menu                                                                        |
| `availableQuantity` | number                 | Diambil langsung dari `checkResult[].availableQuantity` untuk `inventoryId` yang sama (shared pool lihat catatan di 4.4)                                                                                          |
| `shortfall`         | number                 | `max(0, quantityNeeded_agregat_di_checkResult − availableQuantity)`, **bukan** dihitung ulang per-menu lihat 4.4 untuk alasan                                                                                     |
| `nearestExpiry`     | date \| null           | Tanggal expired terdekat dari `checkResult[].eligibleBatches` untuk `inventoryId` ini                                                                                                                             |
| `batchSafetyStatus` | `"safe"` \| `"unsafe"` | `"unsafe"` kalau ada minimal satu batch unsafe di `eligibleBatches` untuk `inventoryId` ini (mengikuti `hasUnsafeBatch` level inventoryId di `checkResult`)                                                       |
| `unitCost`          | number \| null         | **Revisi** pass-through dari `Menu.ingredients[].currentCostPerUnit` (= `Inventory.lastCostBatch`), bukan dihitung ulang oleh Production Plan. `null` kalau `lastCostBatch` belum ada / Inventory diarsip         |
| `costContribution`  | number \| null         | `Menu.ingredients[].subtotalCost × quantityPlanned` pass-through yang diskalakan, bukan hasil kali `unitCost × quantityNeeded` yang dihitung sendiri (walau secara matematis setara). `null` mengikuti `unitCost` |

### 4.4 Catatan Penting: Semantik "Shared Pool" pada `shortfall`

`shortfall` di `ingredientsDetail` **tidak dihitung per-menu** (misal "menu ini butuh 2kg, tersedia global 0.5kg, jadi shortfall 1.5kg" itu keliru kalau dianggap eksklusif milik menu ini). Yang benar: `shortfall` yang ditampilkan di tiap kartu menu untuk `inventoryId` yang sama akan **identik**, karena itu representasi kekurangan di level pool gabungan, bukan alokasi per menu.

Ini harus eksplisit didokumentasikan di response (field `poolShared: true` di tiap `ingredientsDetail` entry) supaya FE tidak salah render seolah tiap menu punya stok terpisah, dan supaya tidak ada bug report "kok shortfall-nya sama di 2 menu beda" di kemudian hari.

Tambahan field:

| Field        | Tipe    | Keterangan                                                                                                                |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `poolShared` | boolean | Selalu `true`. Penanda eksplisit bahwa `availableQuantity`/`shortfall` adalah nilai gabungan lintas menu, bukan eksklusif |

### 4.5 Sumber `costPerPortion` Revisi Setelah Baca Dokumen Menu & Inventory

**Draft awal RFC ini (dibatalkan):** mengusulkan Production Plan menghitung `unitCost` sendiri lewat weighted-average dari batch-batch di `checkResult[].eligibleBatches`, yang mengharuskan Inventory endpoint 11 diperluas menyertakan `costPrice` per batch di response dry-run.

**Kenapa dibatalkan:** dokumen flow Menu v2 §3 ternyata sudah mendefinisikan persis mekanisme yang dibutuhkan di sini:

```
currentCostEstimate = Σ (quantityNeeded_i × lastCostBatch_i)   // per porsi, seluruh ingredient
marginEstimate       = sellingPrice − currentCostEstimate
```

`lastCostBatch` sendiri didefinisikan di dokumen Inventory §3 sebagai _"per-unit cost of the active batch with the newest inDate cached on Inventory, a fast estimate"_ secara eksplisit **bukan** `costPriceUsed` (cost aktual hasil FEFO deduct) dan **bukan** juga rata-rata dari batch yang eligible untuk suatu jendela waktu tertentu. Ini satu-satunya angka "cost estimate" yang dianggap sah dipakai _sebelum_ deduct terjadi dan itu persis situasi Production Plan saat masih `draft`.

Kalau Production Plan bikin metodologi cost sendiri (weighted-average dari `eligibleBatches`), itu jadi **cost model kedua** yang berjalan paralel dengan punya Menu, berpotensi menghasilkan angka yang beda untuk resep yang sama admin bisa lihat margin 40% di halaman Menu, tapi angka beda di halaman Production Plan, tanpa alasan bisnis yang jelas kenapa keduanya nggak sama. Itu bukan trade-off yang perlu diambil, karena Menu module sudah expose semua yang dibutuhkan (§3 dokumen Menu menyebutkan `subtotalCost` dan `currentCostPerUnit` sebagai field per-ingredient yang di-computed di `GET /api/menu/:id`).

**Keputusan final: Production Plan reuse cost estimate dari Menu, tidak menghitung sendiri.**

```
// Per ingredient (dari Menu.ingredients[], per porsi):
unitCost_i        = Menu.ingredients[i].currentCostPerUnit      // = Inventory.lastCostBatch, live
costContribution_i = Menu.ingredients[i].subtotalCost × quantityPlanned

// Per menu:
costPerPortion  = Menu.currentCostEstimate                      // sudah per-porsi, tidak perlu dibagi apa-apa lagi
estimatedProfit = (effectiveSellingPrice − costPerPortion) × quantityPlanned
```

Konsekuensi: **tidak ada perubahan apapun dibutuhkan di kontrak Inventory.** Open Question #4 di draft sebelumnya (perluasan endpoint 11) jadi gugur dihapus dari daftar open question, lihat §9.

**Penanganan `costComplete: false`:** kalau `Menu.costComplete === false` untuk suatu menu (ada ingredient dengan `lastCostBatch: null` atau Inventory-nya sudah diarsip), Production Plan **mewarisi** perilaku yang sama seperti dokumen Menu `costPerPortion`, `estimatedProfit` dikembalikan `null` (bukan dihitung seolah bagian yang hilang gratis), disertai `costComplete: false` dan `costWarning` di level menu itu, supaya UI tidak salah nampilin cost yang menyesatkan (rendah palsu).

**Catatan:** `estimatedProfit` tetap murni **estimasi untuk bantu keputusan admin** (mis. menimbang bikin diskon atau tidak) sama seperti `marginEstimate` di Menu sendiri sudah dilabeli estimasi, bukan akuntansi final. Cost yang sebenarnya kepakai baru fix setelah approve lewat `committedIngredients[].batches[].costPriceUsed` (FEFO aktual, beda source dari `lastCostBatch`). Perlu dilabeli jelas di UI (mis. prefix "Estimasi") supaya tidak disalahartikan sebagai profit aktual dan supaya konsisten dengan cara Menu module sendiri melabeli anginnya.

## 5. Perubahan Flow per Endpoint

### A3. GET /api/plan/:id perubahan utama

Response baru (contoh, status `draft`, ada shortfall & unsafe batch):

```json
{
  "success": true,
  "data": {
    "_id": "plan_001",
    "name": "Promo Nasi Goreng Agustus",
    "status": "draft",
    "startDate": "2026-08-05T00:00:00.000Z",
    "endDate": "2026-08-19T00:00:00.000Z",
    "inventorySafetyStatus": "unsafe",
    "suggestion": "add_discount",
    "checkResultStale": false,
    "staleReason": null,
    "readyToApprove": false,
    "menus": [
      {
        "menuId": "menu_001",
        "name": "Ice Americano",
        "quantityPlanned": 100,
        "effectiveSellingPrice": 25000,
        "costPerPortion": 95,
        "costComplete": true,
        "costWarning": null,
        "estimatedProfit": 2490500,
        "lowStock": true,
        "discount": null,
        "ingredientsDetail": [
          {
            "inventoryId": "66c1a2b3d4e5f6a7b8c9d0e1",
            "nameInventory": "Bubuk Kopi Arabica",
            "quantityNeeded": 2,
            "availableQuantity": 0.5,
            "shortfall": 1.5,
            "poolShared": true,
            "nearestExpiry": "2027-12-20T00:00:00.000Z",
            "batchSafetyStatus": "unsafe",
            "unitCost": 4500,
            "costContribution": 9000
          },
          {
            "inventoryId": "66c1a2b3d4e5f6a7b8c9d0e2",
            "nameInventory": "Air Mineral",
            "quantityNeeded": 10,
            "availableQuantity": 50,
            "shortfall": 0,
            "poolShared": true,
            "nearestExpiry": "2027-01-19T00:00:00.000Z",
            "batchSafetyStatus": "safe",
            "unitCost": 50,
            "costContribution": 500
          }
        ]
      }
    ],
    "checkResult": ["// tetap ada, tidak berubah  agregat mentah untuk keperluan approve/audit"]
  }
}
```

Catatan: `checkResult` mentah **tetap disertakan** di response (bukan diganti), karena itu tetap jadi source of truth untuk validasi approve. `ingredientsDetail` murni tambahan buat kebutuhan tampilan; field cost-nya (`unitCost`, `costContribution`) dan cost level-menu (`costPerPortion`, `estimatedProfit`) semuanya pass-through/derivasi dari data yang sudah di-fetch dari Menu, bukan dihitung ulang dari batch Inventory.

Contoh singkat kalau `costComplete: false` (mis. salah satu bahan belum pernah punya batch, `lastCostBatch: null`):

```json
{
  "menuId": "menu_002",
  "name": "Matcha Drink",
  "costPerPortion": null,
  "costComplete": false,
  "costWarning": "Estimasi biaya tidak lengkap: bubuk matcha belum pernah dibeli",
  "estimatedProfit": null
}
```

### Flow perhitungan A3 (ditambahkan ke flow existing)

1. (Flow lama tidak berubah sampai `checkResult` selesai di-populate)
2. Untuk tiap `menus[]`, ambil resep + cost breakdown dari Menu `GET /api/menu/:id` (atau populate setara) yang sudah mengembalikan `ingredients[]` per porsi beserta `currentCostPerUnit`, `subtotalCost`, `currentCostEstimate`, `costComplete`, `warning` per Menu.
3. Kaliin `qty per porsi × quantityPlanned` → `quantityNeeded` khusus menu ini.
4. Lookup `availableQuantity`, `shortfall`, `eligibleBatches` dari `checkResult` berdasarkan `inventoryId` yang sama → isi `availableQuantity`, `shortfall`, `nearestExpiry`, `batchSafetyStatus` di `ingredientsDetail`.
5. Set `lowStock: true` kalau ada minimal satu entry `shortfall > 0`.
6. Isi `unitCost` dari `Menu.ingredients[].currentCostPerUnit`, `costContribution` dari `Menu.ingredients[].subtotalCost × quantityPlanned` **pass-through**, bukan hitung ulang.
7. Isi `costPerPortion` langsung dari `Menu.currentCostEstimate`, `costComplete`/`costWarning` dari `Menu.costComplete`/`Menu.warning`. Kalau `costComplete: false` → `costPerPortion`, `estimatedProfit`, dan seluruh `ingredientsDetail[].unitCost`/`costContribution` untuk ingredient yang bermasalah jadi `null`. Kalau `costComplete: true` → `estimatedProfit = (effectiveSellingPrice − costPerPortion) × quantityPlanned`.
8. Hitung `inventorySafetyStatus` (plan-level) dari `checkResult` agregat: `"unsafe"` kalau ada minimal satu `hasUnsafeBatch: true`, else `"safe"`.
9. Hitung `suggestion` (plan-level), prioritas berurutan stop di kondisi pertama yang match:

   | Urutan | Kondisi                                                    | `suggestion`         |
   | ------ | ---------------------------------------------------------- | -------------------- |
   | 1      | `staleReason === "recipe_changed"` atau `"menu_archived"`  | `"refresh_required"` |
   | 2      | `inventorySafetyStatus === "unsafe"`                       | `"add_discount"`     |
   | 3      | `readyToApprove === false` (karena shortfall, bukan stale) | `"review_stock"`     |
   | 4      | tidak ada kondisi di atas                                  | `"ready_to_approve"` |

### A1/A4 tidak berubah struktural

`ingredientsDetail` **tidak** dihitung di A1 (create) dan A4 (edit) endpoint itu cuma mengembalikan `checkResult` agregat seperti v2. Breakdown per-menu murni kebutuhan tampilan detail (A3), supaya A1/A4 tetap ringan dan tidak perlu populate resep Menu di setiap create/edit call.

### A6 tambahan validasi

Langkah 3 di flow A6 v2 (`"kalau checkResultStale: true dan staleReason: recipe_changed → tolak 400"`) diperluas jadi:

```
kalau checkResultStale: true DAN staleReason in ["recipe_changed", "menu_archived"] → tolak 400, minta refresh
```

Response 400 baru:

```json
{
  "success": false,
  "message": "Salah satu menu di plan ini sudah diarsipkan, wajib refresh check-availability sebelum approve",
  "errors": [{ "field": "staleReason", "message": "staleReason: menu_archived" }]
}
```

**Kasus khusus:** kalau Menu yang diarsipkan itu satu-satunya menu di plan (atau setelah diarsipkan resep tidak lengkap), `refresh (A5)` tidak akan bisa membuat `readyToApprove: true` lagi plan itu efektif harus dibatalkan lewat A8. Ini bukan bug, cukup dikomunikasikan lewat `suggestion: "refresh_required"` yang tetap muncul terus sampai admin sadar dan hapus draft-nya.

## 6. Trigger `menu_archived` Cascade Manual di MongoDB

Karena MongoDB tidak punya `ON DELETE CASCADE`/trigger native, pola yang dipakai **konsisten dengan 4 trigger existing** di v2 dan sekarang **terkonfirmasi resmi** dari sisi Menu module juga (dokumen flow Menu v2 §5): bulk field update murah di collection Plan, dipicu dari application-layer di endpoint sumbernya (bukan cron, bukan database trigger). Production Plan **tidak perlu mengimplementasikan apapun di titik pemicu** ini sudah jadi tanggung jawab dan sudah terdokumentasi di sisi Menu module. Bagian ini didokumentasikan ulang di sini murni supaya tim Production Plan paham kontraknya, bukan sebagai instruksi implementasi untuk modul ini.

### 6.1 Titik pemicu (di sisi Menu module, referensi)

`DELETE /api/menu/:id` setelah status Menu berhasil diubah ke `deleted`, Menu module menjalankan:

```js
await ProductionPlan.updateMany(
  {
    status: 'draft',
    'menus.menuId': menuId,
    checkResultStale: { $ne: true }, // idempotency guard, lihat 6.3
  },
  {
    $set: {
      checkResultStale: true,
      staleReason: 'menu_archived',
    },
  }
);
```

Filter `status: "draft"` penting plan yang sudah `active`/`completed`/`stopped`/`cancelled` tidak perlu (dan tidak boleh) disentuh, karena `menus[].menuId` di plan aktif itu snapshot historis, bukan referensi live lagi.

**Tambahan dari dokumen Menu yang perlu diketahui tim Plan:** `DELETE /api/menu/:id` mengembalikan `affectedDraftPlans` (daftar ID draft Plan yang ke-flag) di response-nya sendiri. Ini murni informasi tambahan untuk admin yang lagi mengarsip Menu ("N draft plan butuh refresh") Production Plan tidak perlu expose field setara ini, karena `checkResultStale`/`staleReason` per Plan sudah cukup untuk kebutuhan sisi sini.

### 6.2 Kenapa bukan trigger di sisi Plan (polling/lazy-check)?

Pola lazy-check (kayak status `completed`) tidak cocok di sini, karena `menu_archived` **harus** memblokir approve secepat mungkin kalau baru ke-detect saat plan diakses berikutnya, ada window di mana admin bisa approve plan dengan menu yang sudah diarsipkan sebelum sempat lihat detail plan itu lagi. Makanya pola yang dipakai sama seperti 3 trigger lain: push-based bulk update saat event terjadi, bukan pull-based check saat dibaca.

### 6.3 Idempotency & Race Condition

- Guard `checkResultStale: { $ne: true }` di filter mencegah write yang tidak perlu kalau endpoint soft-delete Menu dipanggil dua kali (retry network, dsb) meskipun `$set` ke value yang sama itu sendiri harmless, guard ini menghemat write dan menghindari `updatedAt` Plan berubah tanpa alasan.
- **Konflik multi-trigger**: sesuai catatan di v2 ("staleReason menyimpan yang paling baru terjadi, bukan array"), kalau ada draft yang kena `stock_taken` dulu lalu `menu_archived` menyusul, `staleReason` akan ke-overwrite ke `menu_archived` (karena ini query terakhir yang jalan). Ini konsisten dengan desain existing, tidak perlu penanganan khusus cukup pastikan urutan operasi di kode: validasi Menu dulu baru propagate, biar tidak ada race antara dua trigger yang saling timpa dalam urutan salah.
- **Tidak perlu transaction** untuk `updateMany` ini beda dari A6/A7 yang wajib transaction. Alasannya: kegagalan propagate stale flag itu "fail-open" yang aman (safety net approve di A6 tetap ada via `readyToApprove` check ulang di A5), bukan "fail-closed" yang kalau gagal bisa bikin data korup. Kalaupun `updateMany` gagal di tengah jalan (mis. network drop), Menu tetap ke-arsip dan draft yang belum ke-flag paling buruk baru ke-detect saat admin coba approve dan sistem re-validasi menuId aktif (lihat 6.4).

### 6.4 Defense-in-depth: validasi ulang saat approve

Selain bulk trigger di atas, A6 tetap melakukan **validasi langsung** terhadap status Menu tiap `menuId` di plan (bukan cuma mengandalkan `staleReason` yang mungkin gagal ter-propagate):

```
Sebelum langkah "deduct Inventory" di A6:
  → cek semua menus[].menuId di plan ini masih berstatus Menu.status === "active"
  → kalau ada yang tidak → 400, sama seperti response staleReason: menu_archived
```

Ini bikin trigger bulk-update di 6.1 murni sebagai **UX improvement** (supaya admin lihat warning lebih awal di A3, bukan baru gagal pas klik approve), bukan satu-satunya garis pertahanan. Prinsip yang sama kayak "safety net di deduct saat approve" untuk 3 trigger lain di v2 flag murah untuk visibility awal, validasi keras di titik commit.

## 7. Error Response tidak ada perubahan format

Tetap pakai format existing di v2 (`success`, `message`, `errors[]`). Tidak perlu skema error baru untuk RFC ini.

## 8. Ringkasan Perubahan Dokumentasi yang Perlu Di-update

- [ ] Tabel race condition (bagian "Race Condition Antar-Simulasi") → jadi 5 trigger, bukan 4
- [ ] Tabel status field `staleReason` di skema `ProductionPlan` → tambah `"menu_archived"`
- [ ] Bagian "Catatan untuk Tim" → tambah baris untuk sumber trigger `menu_archived` dari Menu module (referensi ke dokumen flow Menu v2 §5, bukan duplikasi detail implementasi)
- [ ] A3 response examples → tambah `ingredientsDetail`, `lowStock`, `costPerPortion`, `costComplete`, `costWarning`, `estimatedProfit`, `inventorySafetyStatus`, `suggestion`
- [ ] A6 flow step 3 → perluas kondisi blocking
- [ ] ~~Dokumentasi Menu module → tambah baris flow di endpoint soft-delete~~ **tidak perlu**, sudah ada di dokumen flow Menu v2 §5
- [ ] ~~Dokumentasi Inventory endpoint 11 → tambah `costPrice`~~ **dibatalkan**, tidak jadi dibutuhkan (lihat 4.5)

## 9. Open Questions

1. ~~`costPerPortion` buat `estimatedProfit`~~ **Resolved (revisi final).** Bukan dihitung sendiri oleh Production Plan, tapi pass-through dari `Menu.currentCostEstimate` (yang sudah pakai `lastCostBatch` sebagai fast-estimate resmi). Lihat 4.5 untuk detail penuh dan alasan draft sebelumnya (weighted-average FEFO) dibatalkan.
2. **Performance A3** breakdown per-menu butuh fetch data Menu (recipe + cost breakdown), bukan cuma `checkResult` yang sudah ada. Kalau satu plan punya banyak menu, ini nambah beban query di setiap GET detail (idealnya satu batch-fetch `GET /api/menu` dengan filter `menuId in [...]`, bukan N+1 query per menu). Perlu diputuskan apakah perlu caching/precompute, atau cukup accept trade-off ini karena A3 bukan endpoint high-frequency (beda dari misal GET kasir).
3. **`menu_archived` saat plan sudah `active`** dokumen ini asumsikan trigger hanya berlaku untuk plan `draft` (karena `active` sudah snapshot). Dokumen flow Menu v2 tidak secara eksplisit menyebutkan apakah Menu module **mengizinkan** arsip Menu yang masih dipakai plan `active` perlu dikonfirmasi ke tim Menu, walau secara desain Production Plan seharusnya tidak terpengaruh kalau memang diizinkan (karena `committedIngredients`/`frozenSellingPrice` sudah snapshot permanen sejak approve, sesuai prinsip "Live Data, Not Snapshot" di dokumen Menu §2 yang justru menegaskan Plan aktif tidak lagi baca live dari Menu).
4. ~~Perluasan kontrak Inventory endpoint 11~~ **Dibatalkan/gugur.** Tidak dibutuhkan lagi setelah keputusan reuse cost estimate dari Menu (lihat 4.5). Modul Inventory dikonfirmasi **tidak berubah sama sekali** oleh RFC ini.
5. **Pembulatan `unitCost`/`costPerPortion`** perlu standar pembulatan yang **konsisten dengan yang sudah dipakai Menu module** untuk `currentCostEstimate`/`marginEstimate` (supaya angka yang sama tidak beda pembulatan antara halaman Menu dan halaman Production Plan). Ini sebaiknya ditanyakan ke siapapun yang implementasi Menu module dulu, bukan diputuskan sepihak di sini.
6. **(Baru) Bentuk request fetch Menu di A3** apakah lebih tepat Production Plan melakukan `populate` langsung ke koleksi Menu (kalau satu database/service), atau tetap lewat HTTP call ke `GET /api/menu` dengan query batch (kalau modul-modul ini dipisah service)? Dokumen v2 Production Plan menyebutkan "dipisah route + akses, bukan pemisahan database/service" kalau benar satu database, `populate`/`aggregate $lookup` langsung ke koleksi Menu lebih efisien daripada HTTP round-trip, tapi perlu dikonfirmasi ini tetap dianggap "modul terpisah" secara kontrak (tidak baca field internal Menu yang bukan bagian dari kontrak resmi).

---

_RFC ini menggantikan bagian terkait di dokumen Production Plan v2 yang dilampirkan sebelumnya, dan sudah disilangkan dengan dokumen flow resmi Menu v2 & Inventory (v4) untuk memastikan tidak ada cost model ganda atau asumsi yang meleset dari kontrak modul lain. Setelah disetujui, versi final akan digabung jadi Production Plan v3 (dokumen tunggal), bukan diff terpisah._
