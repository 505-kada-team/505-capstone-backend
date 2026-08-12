# RFC Plan Report Addendum & Keputusan Final

**Status:** Final, model sudah dibangun (`planReport.model.js`), service
belum (`planReport.service.js` next step)
**Berlaku sejak:** implementasi `planReport.model.js`

Dokumen ini adalah **koreksi** atas draft RFC Plan Report di titik-titik yang
ternyata bertentangan dengan schema Production Plan yang sudah final.
Bagian yang tidak disebut di sini (skema `PlanReport` inti, endpoint C1–C4,
format error, dsb.) tetap mengikuti draft asli tanpa perubahan.

---

## Keputusan D-PR1: Sumber `originalPriceAtLoss`

**Draft asli:** live `Menu.sellingPrice`.
**Final:** `plan.menus[].frozenSellingPrice` reuse `computePricing()`.

Sama persis alasannya dengan Keputusan D1 di RFC Selling: begitu plan
`active`, harga sudah dibekukan sejak approve `PlanSale.originalPrice` dan
`PlanReport.valuation.originalPriceAtLoss` harus mengacu ke sumber yang
sama, supaya Forecasting bisa membandingkan `revenueActual` vs kerugian
dengan baseline yang konsisten.

---

## Keputusan D-PR2: Sumber "resep menu" untuk `unitCostAtLoss`

**Masalah:** `committedIngredientSchema` tidak menyimpan `menuId` (agregat
lintas-menu), jadi tidak mungkin merekonstruksi resep per-menu dari situ
meski draft RFC asli mengasumsikan bisa.

**Final (Opsi A):**

- Daftar ingredient + `quantityNeeded` per porsi → **live dari
  `Menu.ingredients`**.
- `weightedAvgCost` per ingredient → tetap dari `committedIngredients`
  (match by `inventoryId`).
- `unitCostAtLoss = Σ (weightedAvgCost_ingredient × quantityNeeded_ingredient)`.

Trade-off yang diterima sadar: kalau resep diedit setelah approve, valuasi
bisa mengacu ke ingredient yang beda dari yang benar-benar dimasak.
Konsisten dengan pengakuan draft asli sendiri soal `unitCostAtLoss` sebagai
estimasi, bukan presisi mutlak.

### D-PR2a: Ingredient resep yang tidak match `committedIngredients`

Ingredient di resep live yang tidak ketemu di `committedIngredients`
(mis. baru ditambahkan ke resep setelah approve) → **dikecualikan** dari
perhitungan, dan `valuation` mendapat 2 field baru:

```
valuation.costComplete: boolean   // false kalau ada ingredient yang di-skip
valuation.warning: string | null
```

Pola sama dengan `Menu.costComplete`/`warning`. **Sudah diimplementasi** di
`planReport.model.js` (`valuationSchema`).

---

## Keputusan D-PR3 (konfirmasi): `approvedLossQuantity` = `menus[].lossQuantity`

C3 adalah **satu-satunya** titik yang menambah `menus[].lossQuantity`, dan
**hanya** untuk laporan `category: menu` yang statusnya jadi `approved`
lewat C3. Laporan `pending` → `rejected` tidak pernah menyentuh field ini.

---

## Keputusan D-PR3a (BARU klarifikasi penting): Scope `category: ingredient`

Dikonfirmasi eksplisit oleh pemilik produk: laporan `category: ingredient`
**bukan** mekanisme real-time yang memengaruhi `remainingQuantity`/
`lossQuantity` menu manapun. Perannya:

1. Audit bahan baku pasca-insiden (rusak/hilang/basi) yang **terpisah**
   dari alur jual-beli porsi jadi.
2. Sumber data mentah untuk evaluasi **waste/leftover/shortage** (PRD 5.2)
   ketika plan sudah berhenti/selesai bahan input untuk Forecasting,
   bukan bagian dari flow Selling sama sekali.
3. Memicu `hasPendingLossReplacement` untuk restock fisik lewat C4
   ini SATU-SATUNYA efek sampingnya ke modul lain.

**Ini mengunci Opsi A secara definitif** (bukan cuma "pilihan default yang
aman"): `category: ingredient` dan `category: menu` adalah dua domain yang
sengaja terpisah total, bukan dua cara pandang dari mekanisme yang sama.

---

## Keputusan D-PR4: Titik tulis `hasPendingLossReplacement`

| Endpoint | Kondisi                                                            | Efek                                                                                                                                                  |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1       | `category: ingredient` DAN `reportedByRole: admin` (auto-approved) | Set `true`                                                                                                                                            |
| C3       | `decision: approved` DAN `category: ingredient`                    | Set `true`                                                                                                                                            |
| C3       | `decision: rejected`                                               | Tidak ada efek                                                                                                                                        |
| C4       | Setelah `replacementDeducted: true` berhasil                       | Set `false` **hanya kalau** tidak ada laporan `ingredient`/`approved`/`replacementDeducted: false` lain untuk plan yang sama (re-check, bukan asumsi) |

`category: menu` tidak pernah menyentuh field ini.

---

## Keputusan D-PR5 (konfirmasi): Rentang valid `incidentAt`

- Plan `active`/`completed` → `[startDate, endDate]`.
- Plan `stopped` → `[startDate, stoppedAt]` (bukan `endDate` asli).
- `draft`/`cancelled` → 409, laporan ditolak sama sekali.

---

## Keputusan D-PR6 (BARU desain schema, terkunci di `planReport.model.js`)

1. **`refId` tanpa `ref` statis** Mongoose model bisa menunjuk `Inventory`
   atau `Menu` tergantung `category`. Resolusi dokumen asli jadi tanggung
   jawab `planReport.service.js` (join manual), bukan `populate()`
   konsisten dengan pola semua modul lain di codebase ini.
2. **`reason` wajib diisi** (`required`, `maxlength: 500`) draft asli tidak
   eksplisit menyatakan wajib, tapi laporan tanpa alasan tidak informatif
   untuk admin yang review.
3. **3 index terpisah** untuk 3 pola akses berbeda: C2 (list,
   `planId+status+category`), C4 (cari laporan siap di-deduct,
   `refId+category+status+replacementDeducted`), D-PR4 (cek pending
   replacement per plan, `planId+category+status+replacementDeducted`).

---

## Ringkasan Perubahan vs Draft Asli

| Area                             | Draft Asli                                                     | Final                                                                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `originalPriceAtLoss`            | Live `Menu.sellingPrice`                                       | `frozenSellingPrice`                                                                                     |
| Sumber resep `unitCostAtLoss`    | "snapshot di `committedIngredients`" (tidak ada secara teknis) | Live `Menu.ingredients` + weighted cost dari `committedIngredients`                                      |
| Ingredient tak match             | Tidak dibahas                                                  | `valuation.costComplete: false` + `warning` (field baru)                                                 |
| `hasPendingLossReplacement`      | Konsep disebutkan                                              | Tabel titik-tulis eksplisit (C1/C3/C4)                                                                   |
| `incidentAt` range utk `stopped` | Disebutkan pakai `stoppedAt`                                   | Ditegaskan ulang                                                                                         |
| Scope `category: ingredient`     | Implisit, bisa disalahartikan                                  | **Dikunci eksplisit**: domain terpisah dari Selling/`remainingQuantity`, murni audit + Forecasting input |
| `refId`                          | Tidak dibahas teknis                                           | Dynamic, tanpa `ref` statis, resolusi di service                                                         |
| `reason`                         | Tidak eksplisit wajib                                          | Wajib                                                                                                    |
