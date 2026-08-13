# Production Plan Flow

> Dokumen ini adalah rangkuman pemahaman saya atas flow Production Plan,
> disusun dari: dokumen Production Plan v2 (lampiran awal), RFC v3
> (per-menu ingredient breakdown & trigger `menu_archived`), RFC-0003 Menu,
> dan dokumen flow Inventory. Tujuannya untuk diverifikasi dulu sebelum
> masuk ke implementasi kode.

---

## 1. Posisi Production Plan di antara 3 modul

```
        (resep, live)                (stok, live)
   Menu ───────────────▶ Production Plan ◀─────────────── Inventory
   - ingredients[]          - agregasi kebutuhan bahan        - Inventory (item)
     {inventoryId,           lintas menu                      - SubInventory (batch)
      quantityNeeded}       - simulasi (draft) vs
   - sellingPrice             komitmen (active)
   - currentCostEstimate    - approve = 1x deduct FEFO
     (live, dari                di muka, bukan per transaksi
     lastCostBatch)            kasir
```

Prinsip kunci yang saya pegang:

- **Menu** = definisi resep, live-computed, tidak pernah snapshot kecuali
  soal harga (`frozenSellingPrice`) dan cost (`committedIngredients`) yang
  dibekukan **oleh Plan saat approve**, bukan oleh Menu sendiri.
- **Inventory** = source of truth stok fisik. FEFO + `batchSafetyStatus`
  dihitung oleh Inventory, dipakai apa adanya oleh Plan (tidak dihitung
  ulang dengan logic berbeda).
- **Production Plan** = satu-satunya tempat yang **memotong stok di muka**
  (saat approve) dan yang menentukan apakah kondisi stok/resep "cukup
  aman" untuk disetujui. Kasir tidak menyentuh Inventory sama sekali.

---

## 2. Status Lifecycle Plan

```
                    admin create
                         │
                         ▼
                     ┌ draft ┐──── admin approve (readyToApprove:true, staleReason≠blocking) ───▶ active
                     │        │                                                                     │
                     │        └──── admin cancel (DELETE) ──▶ cancelled                              │
                     └────────┘                                                                      │
                                                                                    endDate lewat (lazy-check) │ admin stop
                                                                                                       ▼        ▼
                                                                                                   completed  stopped
```

- Hanya `draft` yang bisa diedit bebas (A4) atau dibatalkan (A8).
- Hanya boleh **1 plan `active`** dalam satu waktu (global lock).
- `draft` **tidak memotong apapun** boleh banyak draft hidup
  berdampingan, overlap durasi bebas, karena `check-availability` murni
  dry-run terhadap shared pool. Yang exclusive hanya titik **approve**.
- `completed`/`stopped` tidak pernah reverse stok itu snapshot final.

---

## 3. Draft: Create (A1) & Edit (A4) Simulasi, Belum Memotong Apapun

Langkah yang saya pahami terjadi tiap kali draft dibuat/diedit:

1. Validasi field dasar (`name`, `startDate`, `duration` 7–30 hari,
   `menus[]` minimal 1, `quantityPlanned > 0`).
2. Validasi tiap `menuId` merujuk Menu berstatus `active` (bukan
   `deleted`).
3. Hitung `endDate = startDate + duration`.
4. **Agregasi lintas menu**: jumlahkan kebutuhan `inventoryId` yang sama
   dari resep semua menu di plan ini (`quantityNeeded_menu = qty per porsi
× quantityPlanned`, lalu dijumlah antar menu untuk `inventoryId` yang
   sama). Ini agregat, **bukan** per-menu itu sebabnya `checkResult`
   lama tidak bisa langsung dipecah balik ke breakdown per-menu (alasan
   RFC v3 lahir, lihat §6).
5. Panggil `POST /subinventory/check-availability` (Inventory endpoint 11)
   per `inventoryId` teragregasi, dengan `availableUntil = endDate`.
   Inventory mengembalikan FEFO **tanpa exclude** batch yang akan expired
   di tengah durasi batch tetap diambil, hanya dilabel
   `batchSafetyStatus: unsafe` per batch, dan `hasUnsafeBatch` di level
   `inventoryId`.
6. Simpan hasil sebagai `checkResult[]` (per `inventoryId` agregat, bukan
   per menu), hitung `readyToApprove` dari `sufficient` semua entri.
7. Reset `checkResultStale: false`, `staleReason: null` (edit = bentuk
   refresh implisit).
8. Kalau A4 mengubah `startDate`/`duration` sehingga `endDate` baru
   membuat slot diskon existing keluar rentang → **tolak 409** duluan,
   sebelum apapun disimpan (diskon harus dihapus/disesuaikan manual dulu).

**Yang saya catat penting:** `sufficient: false` (shortfall) itu bukan
alasan untuk blok apapun secara otomatis di titik ini itu murni info
untuk admin. Yang bikin approve ditolak adalah `readyToApprove: false`
di langkah approve (A6), bukan di titik create/edit.

---

## 4. Detail Plan (A3) Breakdown per Menu (RFC v3)

Ini yang membedakan v2 vs v3. Pemahaman saya:

### 4.1 Kenapa breakdown per-menu perlu dihitung terpisah dari `checkResult`

`checkResult[].quantityNeeded` adalah **agregat lintas menu** per
`inventoryId`. Wireframe butuh "menu Ice Americano butuh berapa gula",
bukan cuma "total gula yang dibutuhkan semua menu". Karena
`availableQuantity` adalah **shared pool** (bukan alokasi eksklusif per
menu), breakdown ini **tidak boleh dihitung ulang secara independen per
menu** harus tetap merujuk `checkResult` agregat yang sama sebagai
source of truth, supaya tidak muncul dua angka `availableQuantity` yang
berbeda untuk `inventoryId` yang sama di kartu menu berbeda.

Konsekuensi semantik yang saya pegang: **`shortfall` untuk `inventoryId`
X akan identik di semua kartu menu yang memakai X** karena itu representasi
kekurangan di level pool gabungan (ditandai eksplisit `poolShared: true`),
bukan "menu ini kekurangan sekian". Kalau saya nanti mengimplementasikan
ini dan tergoda menghitung shortfall dengan cara "available pool dikurangi
kebutuhan menu ini saja", itu keliru harus tetap
`max(0, quantityNeeded_agregat_checkResult − availableQuantity)`.

### 4.2 `ingredientsDetail[]` per menu (dihitung saat akses, tidak disimpan)

Untuk tiap menu di plan, tiap bahan di resepnya:

| Field                                                                  | Sumber                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `quantityNeeded`                                                       | qty per porsi (dari resep Menu) × `quantityPlanned` **khusus menu ini**, beda dari agregat                 |
| `availableQuantity`, `shortfall`, `nearestExpiry`, `batchSafetyStatus` | **lookup langsung** dari `checkResult[]` agregat berdasarkan `inventoryId` yang sama, tidak dihitung ulang |
| `unitCost`                                                             | pass-through dari `Menu.ingredients[].currentCostPerUnit` (= `Inventory.lastCostBatch`)                    |
| `costContribution`                                                     | pass-through dari `Menu.ingredients[].subtotalCost × quantityPlanned`                                      |

Ini **tidak disimpan ke DB** pola yang sama seperti `effectiveSellingPrice`/
`discountedPrice` di v2: compute-at-access-time.

### 4.3 Cost level-menu reuse dari Menu, bukan model baru

Poin paling penting yang saya tangkap dari revisi RFC v3: Production Plan
**tidak boleh punya metodologi cost sendiri** (mis. weighted-average dari
`eligibleBatches`). Menu module sudah resmi expose `currentCostEstimate`
(dihitung dari `lastCostBatch`, fast-estimate sebelum deduct terjadi)
itu satu-satunya angka cost estimate yang sah dipakai selagi masih
`draft`. Kalau Plan menghitung sendiri, bisa muncul dua angka margin
berbeda untuk resep yang sama di halaman Menu vs halaman Plan, tanpa
alasan bisnis.

Jadi:

```
costPerPortion  = Menu.currentCostEstimate      // pass-through, sudah per-porsi
estimatedProfit = (effectiveSellingPrice − costPerPortion) × quantityPlanned
```

Kalau `Menu.costComplete === false` (ada ingredient `lastCostBatch: null`
atau Inventory-nya sudah diarsip) → `costPerPortion`, `estimatedProfit`,
dan `unitCost`/`costContribution` ingredient terkait jadi `null` (bukan
dianggap 0/gratis), disertai `costWarning` pass-through dari Menu. Ini
konsisten dengan cara Menu sendiri melabeli cost yang tidak lengkap.

**Konsekuensi arsitektur:** tidak ada perubahan kontrak Inventory sama
sekali untuk fitur ini sempat dipertimbangkan memperluas endpoint 11
untuk menyertakan `costPrice` per batch, tapi dibatalkan karena Plan
cukup fetch dari Menu (`GET /api/menu/:id` atau batch-fetch), tidak perlu
menghitung dari batch mentah.

### 4.4 Field turunan level-menu & level-plan

- `lowStock` (menu) = `true` kalau ada minimal satu `ingredientsDetail[].shortfall > 0` untuk menu ini.
- `inventorySafetyStatus` (plan) = `"unsafe"` kalau ada minimal satu `hasUnsafeBatch: true` di `checkResult`.
- `suggestion` (plan) prioritas berurutan, stop di kondisi pertama match:
  1. `staleReason` termasuk `recipe_changed`/`menu_archived` → `"refresh_required"`
  2. `inventorySafetyStatus === "unsafe"` → `"add_discount"`
  3. `readyToApprove === false` (karena shortfall, bukan stale) → `"review_stock"`
  4. selain itu → `"ready_to_approve"`

Ini yang menjawab bagian "saran diskon karena inventory mendekati
expired": `hasUnsafeBatch: true` di `checkResult` → `inventorySafetyStatus:
"unsafe"` → `suggestion: "add_discount"` di level plan, dan admin bisa
tindak lanjuti manual lewat A9 (diskon **tidak pernah otomatis dibuat
sistem** hanya disarankan; admin yang memutuskan berapa persen & kapan).

### 4.5 Scope A3 vs A1/A4

`ingredientsDetail` **hanya** dihitung di A3 (detail), tidak di A1/A4
(create/edit) supaya create/edit tetap ringan (tidak perlu populate
resep Menu tiap kali). A1/A4 tetap hanya mengembalikan `checkResult`
agregat.

`ingredientsDetail` juga **hanya relevan selagi `draft`** begitu
`active`, alokasi final sudah lewat `committedIngredients` (snapshot
permanen sejak approve), bukan live dari Menu lagi.

---

## 5. Approve (A6) Draft → Active

Urutan yang saya pahami, termasuk validasi tambahan dari RFC v3:

1. Plan harus `draft`. Bukan → 404/400.
2. Cek tidak ada plan lain `active` (global lock) → 409 kalau ada.
3. **Cek staleness yang blocking**: kalau `checkResultStale: true` DAN
   `staleReason` termasuk `["recipe_changed", "menu_archived"]` → tolak
   **400**, wajib refresh (A5) eksplisit dulu. Untuk 3 trigger lain
   (`stock_taken`, `batch_removed`, `inventory_archived`) → **tidak**
   blocking di sini, cukup diandalkan safety net di langkah 5.
4. `readyToApprove: false` → 400.
5. **Defense-in-depth** (tambahan RFC v3): validasi ulang langsung ke
   Menu semua `menus[].menuId` di plan ini harus masih `Menu.status ===
"active"`. ini independen dari `staleReason` (jaga-jaga kalau bulk
   stale-flag gagal ter-propagate karena network drop dsb). Ada yang tidak
   aktif → 400, sama seperti `staleReason: menu_archived`.
6. Mulai transaction. Untuk tiap `inventoryId` teragregasi, panggil
   `deduct` (Inventory endpoint 12) dengan `planId`, `availableUntil =
endDate`. Gagal (409, stok berubah) → batalkan transaction, refresh
   `checkResult`, kembalikan 409 ke admin.
7. Sukses → bekukan `committedIngredients` (termasuk `batchSafetyStatus`
   per batch dari respons deduct) dan `frozenSellingPrice` per menu
   (snapshot `sellingPrice` Menu saat ini, tidak akan berubah lagi).
8. Set `status: "active"`, `approvedAt`, `approvedBy`.
9. Tandai `checkResultStale: true`, `staleReason: "stock_taken"` pada
   draft **lain** yang memakai `inventoryId` sama (push-based, bukan lazy).
10. Diskon (kalau ada) dibiarkan apa adanya tidak ikut dibekukan, tetap
    live-evaluated terhadap `now()`, tapi basis harganya sekarang
    `frozenSellingPrice`.

**Kenapa urutan validasi Menu (langkah 5) taruh setelah cek staleness
(langkah 3), bukan gantikan?** Karena keduanya punya peran beda:
staleness flag = **UX awal** (supaya admin lihat warning di A3 sebelum
sempat klik approve), validasi langsung = **garis pertahanan terakhir**
yang tidak bergantung pada keberhasilan propagasi flag. Sama seperti
pola "flag murah + safety net di deduct" untuk 3 trigger stok pertama.

---

## 6. Race Condition 5 Trigger `checkResultStale`

| `staleReason`        | Sumber                      | Trigger                                                        | Blokir approve?                                  |
| -------------------- | --------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `stock_taken`        | Production Plan (A6)        | Plan lain approve, memotong `inventoryId` sama                 | Tidak safety net di deduct                       |
| `batch_removed`      | Inventory (endpoint 9)      | Batch di `eligibleBatches` draft ini di-soft-delete            | Tidak safety net di deduct                       |
| `inventory_archived` | Inventory (endpoint 6)      | Inventory yang dipakai draft diarsipkan                        | Tidak safety net di deduct                       |
| `recipe_changed`     | Menu (endpoint edit)        | `ingredients[]`/`sellingPrice` Menu yang dipakai draft berubah | **Ya** wajib refresh eksplisit                   |
| `menu_archived`      | Menu (endpoint soft-delete) | Menu yang dipakai draft di-soft-delete                         | **Ya** sama kelas risiko dengan `recipe_changed` |

Pola mekanisme (konsisten di semua 5): **push-based bulk field update**
dari sisi modul sumber (`ProductionPlan.updateMany({status:'draft', ...},
{$set:{checkResultStale:true, staleReason:...}})`), bukan cron, bukan
lazy pull-check saat dibaca karena untuk trigger yang blocking
(`recipe_changed`/`menu_archived`), lazy-check punya window berbahaya:
admin bisa approve sebelum sempat lihat detail plan lagi.

Kalau ada draft yang kena 2 trigger beruntun (mis. `stock_taken` lalu
`menu_archived`) → `staleReason` **di-overwrite** ke yang paling baru
(bukan array multi-reason) cukup untuk kebutuhan warning UI.

**Filter penting**: hanya plan `status: "draft"` yang boleh kena bulk
update ini. Plan `active`/`completed`/`stopped`/`cancelled` **tidak**
disentuh `menus[].menuId` di plan yang sudah lewat draft itu snapshot
historis (via `committedIngredients`/`frozenSellingPrice`), bukan
referensi live lagi.

Production Plan sendiri **tidak perlu implementasi apapun** di titik
pemicu `menu_archived`/`recipe_changed`/`batch_removed`/`inventory_archived`
itu tanggung jawab Menu/Inventory module (sudah terdokumentasi resmi
di RFC masing-masing). Plan murni **konsumer** flag ini di A3 (tampilkan
warning) dan A6 (blok kalau perlu).

---

## 7. Diskon Independen, Bukan Auto-Trigger

Poin yang saya pastikan tidak salah paham: `hasUnsafeBatch`/
`inventorySafetyStatus: unsafe` **hanya sinyal/saran** (`suggestion:
"add_discount"`), bukan pemicu otomatis yang membuat diskon. Aturan
diskon sendiri independen penuh:

- Satu menu-satu plan = satu slot diskon aktif (`menus[].discount`),
  replace bukan tambah.
- Rentang tanggal diskon harus dalam rentang plan, `startDate >= now()`
  saat diset.
- Bisa diset/diganti/dihapus selama plan `draft` **atau** `active`, tidak
  bisa lagi setelah `completed`/`stopped`/`cancelled`.
- Tidak digate oleh `readyToApprove`/`checkResult`/`batchSafetyStatus`
  admin boleh buat diskon murni promosi tanpa alasan food-waste, atau
  sebaliknya.
- `discountedPrice` dihitung dari `effectiveSellingPrice` (live kalau
  draft, `frozenSellingPrice` kalau active) bukan selalu live
  `sellingPrice` Menu.

---

## 8. Yang Saya Anggap Sebagai Kontrak Tetap (Tidak Berubah oleh RFC v3)

- `checkResult` agregat mentah **tetap ada** di response A3 tetap jadi
  source of truth untuk validasi approve, `ingredientsDetail` murni
  tambahan tampilan.
- Tidak ada perubahan skema/endpoint di modul Inventory.
- Tidak ada perubahan skema di modul Menu (semua field yang direuse
  sudah ada: `currentCostEstimate`, `currentCostPerUnit`, `subtotalCost`,
  `costComplete`, `warning`).
- `committedIngredients` di plan `active` tidak terpengaruh breakdown
  per-menu ini sama sekali (sudah snapshot final).

---

## 9. Hal yang Masih Perlu Saya Konfirmasi Sebelum/Selama Implementasi

1. **Bentuk fetch ke Menu di A3** apakah `populate`/`$lookup` langsung
   (kalau satu database) atau HTTP call batch `GET /api/menu?menuId=in:[...]`
   (kalau modul dipisah service)? Ini menentukan apakah saya perlu
   khawatir soal N+1 query atau tidak.
2. **Standar pembulatan** `unitCost`/`costPerPortion` harus konsisten
   dengan yang dipakai Menu module untuk `currentCostEstimate`, supaya
   angka yang sama tidak beda pembulatan antar halaman.
3. **`menu_archived` saat plan sudah `active`** apakah Menu module
   mengizinkan arsip Menu yang masih dipakai plan `active`? Kalau ya,
   secara desain Plan aktif seharusnya tidak terpengaruh (karena sudah
   snapshot), tapi ini perlu dikonfirmasi eksplisit, bukan diasumsikan.

---

Kalau pemahaman di atas sudah sesuai dengan yang Anda maksud, saya siap
lanjut ke RFC perbaikan/implementasi. Kalau ada bagian yang saya salah
tangkap (terutama soal semantik shared-pool di §4.1 atau urutan validasi
approve di §5), tolong dikoreksi dulu sebelum saya mulai coding.
