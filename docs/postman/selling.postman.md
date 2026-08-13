# Selling Module — API Documentation

Modul **Selling** menangani pencatatan penjualan menu dari Production Plan yang sedang `active`. Modul ini **hanya membaca** `ProductionPlan` (status/tanggal/harga) dan **hanya menulis** `PlanSale` + `plan.menus[].soldQuantity` / `soldOutAt`. Modul ini tidak pernah menyentuh `Inventory`, `ProductionPlan.status`, atau `menus[].discount`.

**Base path:** `/api/selling`

---

## Daftar Isi

1. [Konsep & Aturan Bisnis](#konsep--aturan-bisnis)
2. [GET /plans](#1-get-apiselligplans--daftar-plan-aktif)
3. [POST /sales](#2-post-apisellingsales--catat-penjualan)
4. [GET /sales/history](#3-get-apisellingsaleshistory--riwayat-penjualan)
5. [Format Response Umum](#format-response-umum)
6. [Kode Error](#kode-error)

---

## Konsep & Aturan Bisnis

| Aturan                 | Penjelasan                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sumber harga**       | Harga dihitung lewat `computePricing()`, fungsi yang sama dipakai Production Plan module. Untuk plan berstatus `active`, `effectiveSellingPrice` **selalu** `frozenSellingPrice` (dibekukan saat approve) — **bukan** `Menu.sellingPrice` yang live. |
| **Snapshot ganda**     | Setiap `PlanSale` menyimpan `originalPrice` (harga sebelum diskon) dan `priceUsed` (harga final terpakai) sebagai snapshot immutable. Nilai ini tidak berubah lagi walau diskon di plan diedit/dihapus belakangan.                                   |
| **Atomic stock guard** | Pengecekan sisa stok dilakukan dua kali: pre-check (pesan error ramah) dan atomic conditional update via `$expr` pada `findOneAndUpdate` (guard utama race condition saat dua kasir mencatat penjualan menu yang sama nyaris bersamaan).             |
| **Window waktu jual**  | Penjualan hanya bisa dicatat jika `startDate <= now <= endDate` pada plan terkait, dan plan berstatus `active`.                                                                                                                                      |
| **soldOutAt**          | Terisi otomatis saat sisa porsi menu = 0 **dan** belum lewat `endDate`. Plan tetap `active`; hanya menu tersebut yang dianggap habis.                                                                                                                |
| **Lazy-complete**      | Endpoint `GET /plans` melakukan bulk update `active` → `completed` untuk plan yang `endDate`-nya sudah lewat, sebelum mengambil daftar plan aktif.                                                                                                   |
| **Append-only**        | `PlanSale` tidak punya endpoint update/delete — dianggap catatan permanen (belum ada keputusan void/edit sale).                                                                                                                                      |
| **Warning level plan** | Field `warning` pada `GET /plans` dikembalikan per **plan**, bukan per-menu, jika ada `hasPendingLossReplacement` yang belum diselesaikan.                                                                                                           |

---

## 1. GET `/api/selling/plans` — Daftar Plan Aktif

Mengambil semua Production Plan berstatus `active`, lengkap dengan sisa stok dan harga berlaku (termasuk diskon) per menu.

- **Method:** `GET`
- **Path:** `/api/selling/plans`
- **Auth:** Bearer Token _(ikuti kebijakan auth project — sertakan header `Authorization` jika endpoint lain di project mewajibkannya)_
- **Query Params:** —
- **Body:** —

### Response `200 OK`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Daftar plan aktif berhasil diambil",
  "data": [
    {
      "planId": "665f1a2b3c4d5e6f7a8b9c0d",
      "name": "Plan Weekday Pagi - Minggu 32",
      "startDate": "2026-08-04T00:00:00.000Z",
      "endDate": "2026-08-10T23:59:59.000Z",
      "sellable": true,
      "menus": [
        {
          "menuId": "665f1a2b3c4d5e6f7a8b9c1a",
          "name": "Cappuccino Regular",
          "sellingPrice": 25000,
          "currentPrice": 20000,
          "isDiscounted": true,
          "discountPercentage": 20,
          "discountEndsAt": "2026-08-10T23:59:59.000Z",
          "remainingQuantity": 34
        },
        {
          "menuId": "665f1a2b3c4d5e6f7a8b9c1b",
          "name": "Croissant Butter",
          "sellingPrice": 18000,
          "currentPrice": 18000,
          "isDiscounted": false,
          "discountPercentage": null,
          "discountEndsAt": null,
          "remainingQuantity": 0
        }
      ],
      "warning": "Ada laporan kerugian bahan yang sudah disetujui tapi belum diganti stoknya"
    }
  ]
}
```

**Catatan field:**

- `sellingPrice` → harga normal (`effectiveSellingPrice`, sudah frozen untuk plan `active`).
- `currentPrice` → harga yang benar-benar dibayar pembeli (sudah termasuk diskon jika `isDiscounted: true`).
- `sellable` → `true` jika `now` berada di antara `startDate` dan `endDate`.
- `remainingQuantity` → `max(0, quantityPlanned - soldQuantity - lossQuantity)`.
- `warning` → `null` jika tidak ada masalah loss replacement pending.

---

## 2. POST `/api/selling/sales` — Catat Penjualan

Mencatat satu transaksi penjualan menu dari plan yang sedang aktif. Operasi atomik (transactional): validasi window waktu, validasi sisa stok, hitung harga, decrement stok, dan insert `PlanSale` terjadi dalam satu MongoDB transaction.

- **Method:** `POST`
- **Path:** `/api/selling/sales`
- **Auth:** Bearer Token
- **Body:** `application/json`

### Request Body

| Field          | Tipe                | Wajib | Keterangan                                   |
| -------------- | ------------------- | ----- | -------------------------------------------- |
| `planId`       | `string` (ObjectId) | ✅    | ID Production Plan, harus berstatus `active` |
| `menuId`       | `string` (ObjectId) | ✅    | Harus terdaftar di `plan.menus`              |
| `quantitySold` | `number` (integer)  | ✅    | Minimal `1`, tidak boleh melebihi sisa porsi |
| `cashierName`  | `string`            | ✅    | Nama kasir yang mencatat transaksi           |

```json
{
  "planId": "665f1a2b3c4d5e6f7a8b9c0d",
  "menuId": "665f1a2b3c4d5e6f7a8b9c1a",
  "quantitySold": 2,
  "cashierName": "Rina"
}
```

### Response `201 Created`

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Penjualan berhasil dicatat",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c2e",
    "planId": "665f1a2b3c4d5e6f7a8b9c0d",
    "menuId": "665f1a2b3c4d5e6f7a8b9c1a",
    "quantitySold": 2,
    "originalPrice": 25000,
    "priceUsed": 20000,
    "discountApplied": true,
    "discountPercentage": 20,
    "cashierName": "Rina",
    "soldAt": "2026-08-09T04:12:33.000Z",
    "remainingQuantity": 32
  }
}
```

### Error Responses

**404 — Plan tidak ditemukan / bukan `active`**

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Plan tidak ditemukan atau bukan berstatus active",
  "errors": []
}
```

**404 — Menu tidak ada di plan**

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Menu ini tidak ada di plan yang sedang aktif ini",
  "errors": [{ "field": "menuId", "message": "menuId tidak ditemukan di plan.menus" }]
}
```

**400 — Belum masuk window waktu jual**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Plan belum dimulai, penjualan baru bisa dicatat mulai 2026-08-10",
  "errors": [{ "field": "startDate", "message": "Tanggal sekarang masih sebelum startDate plan" }]
}
```

**400 — Sudah lewat `endDate`**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Plan sudah melewati endDate, penjualan tidak bisa dicatat lagi",
  "errors": [{ "field": "endDate", "message": "Tanggal sekarang sudah melewati endDate plan" }]
}
```

**409 — Stok tidak cukup (pre-check ATAU race condition di atomic write)**

```json
{
  "success": false,
  "statusCode": 409,
  "message": "Sisa porsi menu ini tidak mencukupi",
  "errors": [{ "field": "quantitySold", "message": "Sisa 1, diminta 3" }]
}
```

> Bila error ini muncul justru setelah pre-check lolos, artinya stok berubah karena kasir lain menang race condition tepat sebelum write ini — `message` pada `errors[0]` akan berbunyi _"Stok berubah oleh transaksi lain, silakan cek ulang sisa porsi"_.

---

## 3. GET `/api/selling/sales/history` — Riwayat Penjualan

Mengambil riwayat transaksi penjualan untuk keperluan rekonsiliasi shift, dengan ringkasan total transaksi, total revenue, dan total diskon yang diberikan (dihitung di response time, bukan field tersimpan).

- **Method:** `GET`
- **Path:** `/api/selling/sales/history`
- **Auth:** Bearer Token
- **Body:** —

### Query Params

| Param         | Tipe                    | Wajib | Keterangan                                                                    |
| ------------- | ----------------------- | ----- | ----------------------------------------------------------------------------- |
| `planId`      | `string` (ObjectId)     | ❌    | Filter berdasarkan plan tertentu                                              |
| `date`        | `string` (`YYYY-MM-DD`) | ❌    | Filter berdasarkan tanggal `soldAt` (rentang 1 hari penuh, lokal 00:00–23:59) |
| `cashierName` | `string`                | ❌    | Filter berdasarkan nama kasir, independen dari `planId`                       |

Contoh: `GET /api/selling/sales/history?planId=665f1a2b3c4d5e6f7a8b9c0d&date=2026-08-09`

### Response `200 OK`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Riwayat penjualan berhasil diambil",
  "data": {
    "data": [
      {
        "_id": "665f1a2b3c4d5e6f7a8b9c2e",
        "menuId": "665f1a2b3c4d5e6f7a8b9c1a",
        "menuName": "Cappuccino Regular",
        "quantitySold": 2,
        "originalPrice": 25000,
        "priceUsed": 20000,
        "discountApplied": true,
        "discountPercentage": 20,
        "cashierName": "Rina",
        "soldAt": "2026-08-09T04:12:33.000Z"
      }
    ],
    "summary": {
      "totalTransaction": 1,
      "totalRevenue": 40000,
      "totalDiscountGiven": 10000
    }
  }
}
```

---

## Format Response Umum

Semua response mengikuti bentuk `ApiResponse` / `ApiError`:

**Sukses:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "...",
  "data": {}
}
```

**Gagal:**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "...",
  "errors": [{ "field": "...", "message": "..." }]
}
```

## Kode Error

| Status | Kapan Terjadi                                                                              |
| ------ | ------------------------------------------------------------------------------------------ |
| `400`  | Body/query gagal validasi Joi, atau window waktu jual tidak sesuai (`startDate`/`endDate`) |
| `404`  | Plan tidak ditemukan / bukan `active`, atau menu tidak ada di `plan.menus`                 |
| `409`  | Sisa porsi tidak mencukupi (pre-check maupun race condition di atomic write)               |
| `500`  | Error tak terduga (mis. kegagalan transaction MongoDB)                                     |
