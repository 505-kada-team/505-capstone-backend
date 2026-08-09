# RFC Selling Addendum & Keputusan Final

**Status:** Final (menggantikan bagian yang relevan di draft RFC v0.1)
**Berlaku sejak:** implementasi `selling.service.js` & `models/selling/planSale.model.js`

Dokumen ini adalah **koreksi** atas RFC Selling draft (v0.1) di titik-titik yang
ternyata bertentangan dengan arsitektur Production Plan yang sudah
diimplementasi. Bagian yang tidak disebut di sini (skema `PlanSale`, endpoint
B1/B2/B3, format error, dsb.) tetap mengikuti draft asli tanpa perubahan.

---

## Keputusan D1 (revisi): Sumber `originalPrice`

**Draft asli bilang:** "ambil `sellingPrice` **live** dari Menu sebagai
`originalPrice`" (RFC v0.1 §5, B2 langkah 5).

**Keputusan final:** `originalPrice` = `plan.menus[].frozenSellingPrice`,
**bukan** `Menu.sellingPrice` live.

**Kenapa direvisi:** Production Plan module sudah membekukan
`frozenSellingPrice` secara eksplisit saat approve (PRD Production Plan §5
langkah 7) justru supaya begitu plan `active`, harga tidak lagi mengikuti
perubahan `Menu.sellingPrice` live. Kalau Selling tetap ambil harga live,
jaminan "freeze" itu batal admin ganti harga menu di tengah plan aktif akan
langsung memengaruhi transaksi kasir berikutnya, padahal plan sudah
"dikunci" harganya sejak approve.

**Implementasi:** `selling.service.js` me-reuse `computePricing()` yang sama
persis dipakai `productionPlan.service.js` bukan menghitung ulang dengan
logic terpisah. Ini konsisten dengan prinsip yang sudah dipegang sejak Menu
module: satu metodologi harga/cost, tidak ada jalur paralel.

---

## Keputusan D6 (detail teknis): Dua Lapis Pengaman Race Condition

Draft asli sudah benar soal _kenapa_ B2 wajib transaction (§5.2, D6), tapi
belum merinci _bagaimana_ race condition antar-kasir dicegah secara teknis.
Ditambahkan sebagai detail implementasi:

1. **Pre-check** membaca `plan.menus` dalam transaction, menghasilkan pesan
   error yang ramah (`"Sisa X, diminta Y"`) sesuai contoh response di §5 B2.
2. **Atomic guard di titik tulis** `findOneAndUpdate` dengan `$expr` di
   dalam `$elemMatch`, membandingkan sisa stok **paling baru** (bukan hasil
   baca di langkah 1) terhadap `quantitySold`. Kalau ada kasir lain yang
   lebih dulu menghabiskan porsi di antara langkah 1 dan langkah ini,
   `findOneAndUpdate` mengembalikan `null` dan transaksi ini gagal dengan
   409 (pesan berbeda: "stok berubah oleh transaksi lain").

Pola ini mengikuti pola atomic conditional update yang sudah dipakai
`deduct()` di Inventory module (`{quantity: {$gte: step.take}}`), disesuaikan
untuk kasus field turunan (`quantityPlanned − soldQuantity − lossQuantity`)
lewat aggregation pipeline karena tidak bisa dibandingkan langsung sebagai 1
field polos.

`soldOutAt` diisi di pipeline update yang sama (bukan query terpisah)
supaya kondisi "porsi baru saja habis" dievaluasi terhadap nilai
`soldQuantity` **setelah** increment transaksi ini, bukan sebelum atomicity juga berlaku untuk penentuan stockout, tidak hanya untuk pengurangan
stok.

---

## Keputusan D7 (baru): `lossQuantity` diperlakukan sebagai _approved loss_

RFC Plan Report (lihat dokumen terpisah) menyebut field `approvedLossQuantity`
sebagai sumber pengurang `remainingQuantity`. Field ini **belum ada** sebagai
nama terpisah di schema `ProductionPlan` yang sudah dibangun yang ada
adalah `menus[].lossQuantity`.

**Keputusan final:** `remainingQuantity = quantityPlanned − soldQuantity −
lossQuantity`, dengan asumsi `lossQuantity` **hanya bertambah lewat laporan
Plan Report yang sudah di-_approve_** (bukan yang masih `pending`). Ini
akan **dikonfirmasi ulang** saat implementasi Plan Report C3 (review), karena
di situlah titik yang benar-benar menulis ke field ini.

---

## Keputusan D8 (baru): Penempatan `warning`

Draft asli ambigu antara level plan dan level menu (teks bilang per-plan,
contoh JSON menaruhnya per-menu). **Dikonfirmasi: level plan**, bersumber
dari `plan.hasPendingLossReplacement`, konsisten dengan pola yang sama di
Production Plan A3 (`toDetailedResponse`).

---

## Ringkasan Perubahan vs Draft v0.1

| Area                | Draft v0.1                                         | Final                                                                                                       |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `originalPrice`     | Live `Menu.sellingPrice`                           | `frozenSellingPrice` (reuse `computePricing`)                                                               |
| Race condition      | Disebutkan wajib transaction, teknis belum dirinci | Transaction + atomic `$expr` guard di titik tulis                                                           |
| `remainingQuantity` | `approvedLossQuantity` (field belum eksis)         | `lossQuantity` (field yang benar-benar ada), status "approved-only" perlu dikonfirmasi ulang di Plan Report |
| `warning` (B1)      | Ambigu (teks vs contoh JSON beda)                  | Level plan                                                                                                  |
