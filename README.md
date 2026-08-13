# Artisan Inventory — KADA Backend

> REST API backend untuk manajemen operasional kedai kopi/F&B: perencanaan produksi, inventori berbasis FEFO, penjualan, pelaporan kerugian, hingga rekomendasi AI.

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![Node.js](https://img.shields.io/badge/Node.js-CommonJS-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%208-47A248?logo=mongodb&logoColor=white)
![Repo](https://img.shields.io/badge/repo-505--kada--team%2F505--capstone--backend-lightgrey)

Repo: [`505-kada-team/505-capstone-backend`](https://github.com/505-kada-team/505-capstone-backend)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Entity Relationship & Domain Model](#entity-relationship--domain-model)
- [Detailed Module Flows](#detailed-module-flows)
  - [Authentication Flow](#authentication-flow)
  - [Inventory Flow](#inventory-flow)
  - [Menu Flow](#menu-flow)
  - [Production Plan Flow](#production-plan-flow)
  - [Selling Flow](#selling-flow)
  - [Plan Report Flow](#plan-report-flow)
  - [Dashboard Flow](#dashboard-flow)
  - [AI Prediction Flow](#ai-prediction-flow)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Testing](#testing)
- [Roadmap / Known Limitations](#roadmap--known-limitations)
- [Team](#team)

---

## Overview

Bisnis F&B skala kedai sering kesulitan merencanakan produksi harian, melacak stok bahan baku dengan disiplin **FEFO (First-Expired-First-Out)**, dan mengevaluasi kerugian/waste secara sistematis setelah produksi berjalan.

**Artisan Inventory** (nama produk: **KADA**) adalah backend API yang menjadi _source of truth_ untuk seluruh siklus tersebut — mulai dari rencana produksi, penjualan harian, sampai laporan kerugian dan dashboard — dengan validasi bisnis yang konsisten di satu tempat.

Repo ini adalah **backend-only**. Frontend dan ML service (untuk rekomendasi AI) berada di repo terpisah dan diakses lewat konfigurasi `ML_SERVICE_URL`.

---

## Key Features

- **Authentication** — register, verifikasi email via OTP, login (JWT access + refresh token), forgot/reset password 3 langkah, change password, single-session enforcement lewat `tokenVersion`, endpoint `/me`.
- **Inventory** — CRUD item inventori, sub-inventory/batch dengan tanggal kedaluwarsa, cek ketersediaan/deduct/reverse-deduct berbasis FEFO, riwayat stok masuk dan pemakaian.
- **Menu** — CRUD menu dengan upload gambar ke Cloudinary; resep terikat ke Inventory secara _live_ selama belum ada plan yang di-approve.
- **Production Plan** — buat dan approve rencana produksi, cek ketersediaan bahan, commit bahan saat approve, diskon per menu, stop/cancel plan. Hanya boleh ada **1 plan aktif** dalam satu waktu.
- **Selling** — ambil plan yang sedang aktif, catat transaksi penjualan, auto-decrement stok plan, riwayat penjualan.
- **Plan Report** — laporan kerugian/waste per bahan atau per menu, alur review oleh admin, dan penggantian stok.
- **Dashboard** — ringkasan penjualan harian, tren per jam, breakdown per menu.
- **AI Prediction** — rekomendasi jumlah menu/assortment dengan memanggil **ML service eksternal** lewat `ML_SERVICE_URL`.

---

## Tech Stack

| Kategori            | Teknologi                                                    |
| ------------------- | ------------------------------------------------------------ |
| Runtime & Framework | Node.js, Express 4                                           |
| Database & ODM      | MongoDB, Mongoose 8                                          |
| Auth                | JSON Web Token (`jsonwebtoken`), `bcryptjs`                  |
| Validasi            | Joi                                                          |
| Upload gambar       | Cloudinary + Multer (`streamifier`)                          |
| Email / OTP         | Brevo (`@getbrevo/brevo`), Nodemailer                        |
| Keamanan            | Helmet, `express-rate-limit`, `express-mongo-sanitize`, CORS |
| Logging             | Winston, Morgan                                              |
| Testing             | Jest, Supertest, `mongodb-memory-server`                     |
| Code quality        | ESLint, Prettier, Husky, `lint-staged`                       |

---

## Architecture

Layered architecture dengan alur request yang konsisten:

```
Client
  │
  ▼
Middleware chain
(helmet → cors → body/cookie parser → mongo-sanitize → compression → morgan → rate-limit)
  │
  ▼
Route → Validate (Joi) → Auth (JWT) → Controller → Service → Model (Mongoose) → MongoDB
```

Konvensi terpusat:

- `asyncHandler` — wrapper controller agar error async diteruskan ke error handler.
- `ApiError` / `ApiResponse` — bentuk error dan response yang konsisten.
- `error.middleware.js` / `notFound.middleware.js` — penanganan error dan 404 terpusat.

Semua route utama di-mount di bawah prefix `/api/v1`. Health check tersedia di `GET /api/v1/health`.

---

## Entity Relationship & Domain Model

```
User 1 ────< RefreshToken
User 1 ────< ProductionPlan (createdBy/approvedBy)

Inventory 1 ────< SubInventory (batch)
Inventory 1 ────< HistorySubInventory (append-only)
SubInventory 1 ────< HistoryUsage (append-only)

Menu.ingredients[] ────> Inventory (live reference)
ProductionPlan.menus[] ────> Menu (frozen on approve)
ProductionPlan 1 ────< Selling / PlanSale
ProductionPlan 1 ────< PlanReport
```

### Domain decisions inti

- **FEFO batch deduction** — deduksi stok selalu mengambil batch yang paling dekat kedaluwarsanya terlebih dahulu. Setiap perubahan tercatat di `HistorySubInventory` / `HistoryUsage`.
- **Freeze-on-approve** — saat `ProductionPlan` di-approve, resep, nama menu, dan harga jual di-snapshot ke dalam plan, sehingga riwayat penjualan dan laporan tidak berubah meskipun resep/harga menu diedit kemudian.
- **Single active plan constraint** — hanya satu `ProductionPlan` berstatus `active` pada satu waktu, ditegakkan lewat partial unique index.
- **Live recipe vs snapshot history** — `Menu` menyimpan referensi `Inventory` secara live, sedangkan `HistorySubInventory`/`HistoryUsage` menyimpan snapshot agar data historis tetap terbaca meskipun entitas asli berubah.
- **Stale flag propagation** — modul sumber tidak mengubah data milik modul lain secara destruktif, tetapi menandai draft `ProductionPlan` dengan `checkResultStale` + `staleReason` agar modul pemilik memutuskan tindakan lanjut.

---

## Detailed Module Flows

Dokumentasi di bawah ini merangkum flow aktual per modul. Detail lengkap dapat dilihat di `docs/`.

---

### Authentication Flow

#### Konsep token

| Token         | Jenis                          | Sifat utama                                                                                                          |
| ------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Access token  | JWT, short-lived               | Payload: `{ sub, role, tokenVersion }`. Stateless, tetapi dapat di-revoke dengan membandingkan `tokenVersion` ke DB. |
| Refresh token | Opaque string acak 64-byte hex | Hanya `sha256(token)` yang disimpan. Single-use, dirotasi setiap refresh. Family-based reuse detection.              |

Transport token:

| Platform | Access token | Refresh token                                          |
| -------- | ------------ | ------------------------------------------------------ |
| Web      | JSON body    | `httpOnly` cookie (`secure: true`, `sameSite: 'none'`) |
| Mobile   | JSON body    | JSON body                                              |

#### Endpoint auth

| Method | Path                                | Tujuan                                             |
| ------ | ----------------------------------- | -------------------------------------------------- |
| POST   | `/auth/register`                    | Daftar user, kirim OTP verifikasi email            |
| POST   | `/auth/verify-email/send`           | Kirim ulang OTP verifikasi                         |
| POST   | `/auth/verify-email/confirm`        | Verifikasi OTP, tandai email terverifikasi         |
| POST   | `/auth/login`                       | Login, terbitkan access token + refresh token      |
| POST   | `/auth/refresh`                     | Rotasi refresh token, terbitkan access token baru  |
| POST   | `/auth/logout`                      | Cabut refresh token aktif & naikkan `tokenVersion` |
| POST   | `/auth/forgot-password`             | Minta reset password, selalu return 200            |
| POST   | `/auth/forgot-password/verify-code` | Verifikasi OTP, terbitkan reset token              |
| POST   | `/auth/reset-password`              | Reset password dengan reset token                  |
| PATCH  | `/auth/change-password`             | Ganti password dari sesi terautentikasi            |

#### Alur utama

```
register → isEmailVerified:false
   │
   ▼
verify-email/confirm → isEmailVerified:true
   │
   ▼
login → active session
   │
   ├─ refresh → rotasi token, tokenVersion+1
   ├─ logout → revoke refresh token, tokenVersion+1
   ├─ change password / reset password → semua sesi dimatikan
   └─ login di perangkat baru → sesi lain dimatikan jika singleSessionOnly
```

#### Catatan penting

- Login menolak user yang belum verifikasi email dengan `403 EMAIL_NOT_VERIFIED`.
- `singleSessionOnly` bila aktif akan mencabut semua refresh token user lain saat login baru.
- Logout, change password, dan reset password menaikkan `user.tokenVersion`, sehingga access token lama langsung tidak valid.
- Role: `admin` dan `cashier`. Middleware `authorize(...roles)` sudah tersedia untuk proteksi resource.

---

### Inventory Flow

#### Entitas

| Entity                | Peran                                                      |
| --------------------- | ---------------------------------------------------------- |
| `Inventory`           | Item bahan/packaging, mis. “Tepung Terigu Segitiga Biru”   |
| `SubInventory`        | Batch pembelian dengan quantity, cost, tanggal kedaluwarsa |
| `HistorySubInventory` | Log pembelian, append-only                                 |
| `HistoryUsage`        | Log pemakaian hasil deduksi FEFO, append-only              |

```
Inventory 1 ──< SubInventory (batch)
Inventory 1 ──< HistorySubInventory
SubInventory 1 ──< HistoryUsage
```

#### Status lifecycle

```
Inventory:
  active ── DELETE tanpa batch berstok ──> deleted
  active ── DELETE dengan batch berstok ──> 409

SubInventory:
  active ── quantity habis ──> depleted
  active ── expired < now ──> expired
  active ── DELETE manual ──> deleted
```

Hanya batch `active` yang dihitung dalam `quantityTotal`, `totalSubInventory`, dan kandidat FEFO. `deduct/reverse` hanya bisa mengembalikan `depleted → active`, tidak pernah `expired` atau `deleted`.

#### Cost model

| Field           | Lokasi         | Makna                                                          |
| --------------- | -------------- | -------------------------------------------------------------- |
| `costPrices`    | `SubInventory` | Harga per unit batch spesifik                                  |
| `lastCostBatch` | `Inventory`    | Harga per unit batch aktif terbaru, cache untuk estimasi cepat |
| `costPriceUsed` | `HistoryUsage` | Harga batch yang benar-benar dipakai FEFO, untuk COGS aktual   |

Estimasi menu memakai `lastCostBatch`, sedangkan laporan COGS aktual memakai `costPriceUsed`. Keduanya wajar berbeda karena FEFO memilih batch berdasar kedaluwarsa, bukan batch pembelian terbaru.

#### FEFO & `batchSafetyStatus`

- FEFO selalu mengambil batch aktif dengan `expired` paling dekat terlebih dahulu.
- Tidak ada exclude batch, bahkan jika batch akan kedaluwarsa di tengah masa plan.
- Batch hanya diberi label:

```
batchSafetyStatus =
  "safe"    jika expired === null (packaging) OR expired >= availableUntil
  "unsafe"  jika expired < availableUntil
```

- `sufficient` dan `hasUnsafeBatch` bersifat independen. Keputusan tetap melanjutkan meskipun ada batch unsafe adalah keputusan bisnis di Production Plan, bukan gate otomatis di Inventory.

#### Referential integrity tanpa foreign key

Karena MongoDB tidak punya FK constraint, modul Inventory menerapkan:

1. **Validate-before-write** — parent harus dicek eksistensi/status sebelum menulis child.
2. **Satu shared recompute function** — `quantityTotal`, `lastCostBatch`, `totalSubInventory` selalu dihitung ulang lewat satu fungsi bersama.
3. **Snapshot fields** — `HistorySubInventory`/`HistoryUsage` menyimpan nama dan field penting saat transaksi.
4. **Delete guards** — `DELETE /inventory/:id` ditolak 409 bila masih ada batch aktif berstok.
5. **Stale-flag propagation** — arsip inventory/batch menandai draft plan terkait dengan `checkResultStale`.
6. **Atomicity** — transaksi MongoDB dipakai untuk create batch, delete batch, deduct, dan reverse deduct.
7. **Atomic conditional update** pada deduct untuk mencegah race condition antar deduct.

#### Endpoint inventory

Path relatif terhadap `/api/v1`.

| #   | Method & Path                           | Tujuan                        | Catatan                                                |
| --- | --------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| 1   | POST `/inventory`                       | Buat inventory                | Guard duplikat nama case-insensitive                   |
| 2   | GET `/inventory`                        | List inventory                | Pagination, `includeDeleted` untuk admin               |
| 3   | GET `/inventory/dropdown`               | List minimal tanpa pagination | Untuk pembuatan Menu/Plan                              |
| 4   | GET `/inventory/:id`                    | Detail + daftar batch         | Jalankan lazy expiry check                             |
| 5   | PUT `/inventory/:id`                    | Edit nama/deskripsi           | `category`/`unit` terkunci setelah create              |
| 6   | DELETE `/inventory/:id`                 | Arsipkan inventory            | 409 jika ada batch aktif berstok                       |
| 7   | POST `/inventory/:id/subinventory`      | Tambah batch                  | `expired` wajib untuk ingredient, null untuk packaging |
| 8   | GET `/inventory/:id/subinventory`       | List batch                    | Jalankan lazy expiry check                             |
| 9   | DELETE `/subinventory/:id`              | Arsipkan batch                | Propagate `checkResultStale`                           |
| 10  | GET `/history-sub-inventory`            | Log pembelian                 | Append-only                                            |
| 11  | POST `/subinventory/check-availability` | Dry-run stock check           | FEFO + `batchSafetyStatus`                             |
| 12  | POST `/subinventory/deduct`             | Deduksi FEFO                  | `availableUntil` opsional                              |
| 13  | POST `/subinventory/deduct/reverse`     | Batalkan deduksi              | Hanya un-deplete                                       |
| 14  | GET `/history-usage`                    | Log pemakaian                 | Include `batchSafetyStatus`, `isReversed`              |

---

### Menu Flow

#### Prinsip utama

- **Menu mereferensikan `Inventory`, bukan `SubInventory`** — resep adalah fakta tentang jenis bahan, bukan batch fisik tertentu.
- **Live data, bukan snapshot** — `Menu.ingredients[]` hanya menyimpan `inventoryId` dan `quantityNeeded`. Field lain dihitung saat dibaca.
- **Tidak ada delete guard** — arsip menu tidak diblokir karena menu tidak punya stok sendiri.

#### Cost & margin

```
currentCostEstimate = Σ(quantityNeeded_i × lastCostBatch_i)
marginEstimate       = sellingPrice − currentCostEstimate
marginPercentage     = marginEstimate / sellingPrice × 100
```

Jika ada ingredient yang belum punya batch (`lastCostBatch: null`) atau inventory-nya diarsipkan, maka:

- `costComplete = false`
- `currentCostEstimate`, `marginEstimate`, `marginPercentage` = `null`
- disertai `warning` agar UI tidak menampilkan angka cost menyesatkan.

#### Status lifecycle

```
create → active → DELETE → deleted
```

Arsip menu tidak pernah diblokir.

#### Stale-flag propagation

Menu tidak mengedit Production Plan secara destruktif, tetapi menandai draft plan dengan:

| Trigger                                           | Penyebab            | `staleReason`    |
| ------------------------------------------------- | ------------------- | ---------------- |
| `PUT /menu/:id` mengubah ingredients/sellingPrice | Resep/harga berubah | `recipe_changed` |
| `DELETE /menu/:id`                                | Menu diarsipkan     | `menu_archived`  |

#### Endpoint menu

Path relatif terhadap `/api/v1`.

| #   | Method & Path        | Tujuan                                   |
| --- | -------------------- | ---------------------------------------- |
| 1   | POST `/menu`         | Buat menu                                |
| 2   | GET `/menu`          | List menu dengan ringkasan cost          |
| 3   | GET `/menu/:id`      | Detail menu + breakdown cost/margin      |
| 4   | PUT `/menu/:id`      | Edit menu; `ingredients[]` full-replace  |
| 5   | DELETE `/menu/:id`   | Arsipkan menu                            |
| 6   | GET `/menu/dropdown` | List menu aktif minimal untuk plan draft |

---

### Production Plan Flow

#### Posisi modul

```
Menu ───────────────▶ Production Plan ◀─────────────── Inventory
(resep live)              (simulasi/komitmen)              (stok live)
```

- Production Plan adalah satu-satunya modul yang **memotong stok di muka saat approve**.
- Kasir tidak menyentuh Inventory secara langsung; Selling hanya membaca/mengurangi stok plan.

#### Status lifecycle

```
draft ── approve ──> active ── endDate lewat ──> completed
  │                     │
  │ cancel              │ admin stop
  ▼                     ▼
cancelled             stopped
```

- Hanya `draft` yang bisa diedit atau dibatalkan.
- Hanya boleh ada **1 plan `active`** dalam satu waktu.
- `draft` boleh banyak dan overlap; tidak memotong stok.

#### Draft: create/edit

1. Validasi `name`, `startDate`, `duration` 7–30 hari, `menus[]`, `quantityPlanned > 0`.
2. Validasi semua `menuId` merujuk Menu `active`.
3. Hitung `endDate`.
4. Agregasi kebutuhan bahan lintas menu per `inventoryId`.
5. Panggil `POST /subinventory/check-availability` per `inventoryId` dengan `availableUntil = endDate`.
6. Simpan `checkResult[]` agregat, hitung `readyToApprove`.
7. Reset `checkResultStale`.
8. Jika edit mengubah rentang diskon existing di luar plan, tolak 409.

#### Detail plan: breakdown per menu

`ingredientsDetail[]` dihitung saat akses, tidak disimpan. Sumber datanya:

| Field                                                                  | Sumber                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `quantityNeeded`                                                       | Resep menu × `quantityPlanned` menu tersebut        |
| `availableQuantity`, `shortfall`, `nearestExpiry`, `batchSafetyStatus` | Lookup dari `checkResult[]` agregat                 |
| `unitCost`                                                             | `Menu.ingredients[].currentCostPerUnit`             |
| `costContribution`                                                     | `Menu.ingredients[].subtotalCost × quantityPlanned` |

Cost level menu reuse `Menu.currentCostEstimate`; Production Plan **tidak punya metodologi cost sendiri**.

#### Approve draft → active

1. Plan harus `draft`.
2. Cek tidak ada plan lain `active`.
3. Jika `checkResultStale: true` dengan `staleReason` `recipe_changed` / `menu_archived`, tolak 400 — wajib refresh.
4. Jika `readyToApprove: false`, tolak 400.
5. Defense-in-depth: validasi langsung semua `menuId` masih `active` di Menu.
6. Mulai transaksi; panggil `deduct` untuk tiap `inventoryId` agregat.
7. Jika stok berubah, batalkan transaksi, refresh `checkResult`, kembalikan 409.
8. Bekukan `committedIngredients` dan `frozenSellingPrice`.
9. Set `status: active`, `approvedAt`, `approvedBy`.
10. Tandai draft lain dengan `staleReason: stock_taken`.

#### Trigger `checkResultStale`

| `staleReason`        | Sumber                | Blokir approve?             |
| -------------------- | --------------------- | --------------------------- |
| `stock_taken`        | Plan lain approve     | Tidak; safety net di deduct |
| `batch_removed`      | Inventory hapus batch | Tidak; safety net di deduct |
| `inventory_archived` | Inventory arsip item  | Tidak; safety net di deduct |
| `recipe_changed`     | Menu edit resep/harga | **Ya**                      |
| `menu_archived`      | Menu arsip            | **Ya**                      |

#### Diskon

- Satu menu-satu plan = satu slot diskon aktif.
- Rentang diskon harus di dalam rentang plan.
- Dapat diubah selama plan `draft` atau `active`.
- `hasUnsafeBatch` / `inventorySafetyStatus: unsafe` hanya memberi sinyal `suggestion: "add_discount"`, **tidak membuat diskon otomatis**.

#### Endpoint plan utama

| Method & Path                              | Tujuan                              |
| ------------------------------------------ | ----------------------------------- |
| POST `/plan`                               | Buat draft plan                     |
| GET `/plan/:id`                            | Detail plan + `ingredientsDetail`   |
| PUT `/plan/:id`                            | Edit draft plan                     |
| POST `/plan/:id/refresh`                   | Refresh `checkResult` setelah stale |
| POST `/plan/:id/approve`                   | Approve draft menjadi active        |
| POST `/plan/:id/stop`                      | Stop plan active                    |
| DELETE `/plan/:id`                         | Batalkan draft plan                 |
| PUT `/plan/:planId/menus/:menuId/discount` | Atur/hapus diskon menu              |

---

### Selling Flow

#### Keputusan final utama

- `originalPrice` = `plan.menus[].frozenSellingPrice`, bukan harga live `Menu.sellingPrice`.
- Selling me-reuse `computePricing()` dari Production Plan, bukan menghitung ulang dengan logika terpisah.
- `remainingQuantity = quantityPlanned − soldQuantity − lossQuantity`.
- `lossQuantity` hanya bertambah dari laporan Plan Report yang sudah di-approve.
- `warning` berada di level **plan**, bersumber dari `plan.hasPendingLossReplacement`.

#### Race condition protection

1. Pre-check membaca `plan.menus` dalam transaksi untuk pesan error ramah.
2. Atomic guard `findOneAndUpdate` dengan `$expr` di `$elemMatch` membandingkan sisa stok terbaru terhadap `quantitySold`.
3. `soldOutAt` diisi pada pipeline update yang sama agar kondisi stockout dievaluasi setelah increment.

#### Endpoint selling

| Method & Path              | Tujuan                                       |
| -------------------------- | -------------------------------------------- |
| GET `/selling/active-plan` | Ambil plan aktif, sisa porsi, dan warning    |
| POST `/selling`            | Catat transaksi penjualan, kurangi stok plan |
| GET `/selling/history`     | Riwayat penjualan                            |

---

### Plan Report Flow

#### Prinsip inti

- Kasir hanya bisa membuat laporan (C1). Review dan replacement adalah wewenang admin.
- `quantityLost` immutable setelah dilaporkan.
- `replacementQuantity` tidak wajib sama dengan `quantityLost`.
- `valuation` untuk `category: menu` dihitung sekali dan dibekukan permanen.
- Tidak ada direct-deduct ke Inventory di luar mekanisme PlanReport.

#### Keputusan penting

- `originalPriceAtLoss` memakai `frozenSellingPrice`, bukan live `Menu.sellingPrice`.
- Resep untuk `unitCostAtLoss` diambil live dari `Menu.ingredients`, bukan `committedIngredients`.
- `category: ingredient` adalah domain terpisah dari `Selling`/`remainingQuantity`; fungsinya murni audit bahan baku pasca-insiden dan input forecasting.
- `hasPendingLossReplacement` harus di-recheck sebelum diset `false`.
- `menus[].lossQuantity` hanya bertambah saat approve laporan `category: menu`.
- `refId` di-resolve manual ke `Inventory` atau `Menu` sesuai `category`.
- C1 auto-approve admin harus reuse fungsi internal yang sama dengan handler C3.

#### Endpoint plan report

| Method & Path                        | Tujuan                            |
| ------------------------------------ | --------------------------------- |
| POST `/plan-reports`                 | Buat laporan kerugian             |
| GET `/plan-reports`                  | List laporan                      |
| GET `/plan-reports/:id`              | Detail laporan                    |
| POST `/plan-reports/:id/review`      | Approve/reject laporan oleh admin |
| POST `/plan-reports/:id/replacement` | Proses penggantian stok           |

---

### Dashboard Flow

Endpoint dashboard:

| Method & Path                                       | Tujuan                                  |
| --------------------------------------------------- | --------------------------------------- |
| GET `/dashboard/plan/:planId/daily?date=YYYY-MM-DD` | Ambil agregasi metrik harian untuk plan |

Catatan:

- Endpoint dilindungi JWT.
- `planId` adalah ObjectId Mongo valid.
- `date` format `YYYY-MM-DD`.
- Dashboard membaca data dari `plan` dan `selling`.

---

### AI Prediction Flow

Endpoint prediction:

| Method & Path                  | Tujuan                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| POST `/predictions/assortment` | Rekomendasi assortment/plan berdasarkan durasi + tanggal + tag |

Catatan:

- Memakai JWT auth.
- `duration` harus `3–30` hari.
- `startDate` harus valid ISO date.
- `tags` opsional.
- Backend memanggil ML service eksternal lewat `ML_SERVICE_URL`.

---

## Project Structure

```
505-capstone-backend/
├── server.js                 # Entry point
├── src/
│   ├── app.js                 # Express app & middleware chain
│   ├── config/                # Env & konfigurasi eksternal
│   ├── routes/                # Route per modul, di-mount lewat routes/index.js
│   ├── controllers/           # Controller per modul
│   ├── services/               # Business logic per modul
│   ├── models/                # Mongoose schema, dikelompokkan per domain
│   ├── middlewares/            # auth, validate, upload, rate-limit OTP, error handling
│   ├── validations/            # Skema Joi per modul
│   └── utils/                  # ApiError, ApiResponse, asyncHandler, FEFO helper, dll
├── scripts/                    # Script migrasi satuan
├── tests/                      # Jest + Supertest
├── docs/                       # Dokumentasi tambahan, flow, RFC, Postman collection
└── .env.example
```

---

## Getting Started

### Prasyarat

- Node.js LTS
- MongoDB lokal atau Atlas
- ML service eksternal opsional untuk modul AI Prediction

### Instalasi

```bash
git clone https://github.com/505-kada-team/505-capstone-backend.git
cd 505-capstone-backend
npm install
```

### Konfigurasi

```bash
cp .env.example .env
# isi nilai-nilai di .env sesuai environment
```

### Menjalankan

```bash
npm run dev     # development dengan nodemon
npm start       # production-style run
```

Default API: `http://localhost:5000/api/v1`.

### Lint, format, test

```bash
npm run lint
npm run format
npm test
```

---

## Environment Variables

| Variabel                                                                               | Keterangan                    |
| -------------------------------------------------------------------------------------- | ----------------------------- |
| `NODE_ENV`                                                                             | Environment aplikasi          |
| `PORT`                                                                                 | Port server Express           |
| `CLIENT_URL`                                                                           | Origin frontend untuk CORS    |
| `ML_SERVICE_URL`                                                                       | Base URL ML service eksternal |
| `MONGO_URI`                                                                            | Connection string MongoDB     |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`                                              | Rate limiter global           |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_EXPIRES`                                             | Access token secret & expiry  |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES`                                           | Refresh token secret & expiry |
| `JWT_RESET_SECRET` / `JWT_RESET_EXPIRES`                                               | Reset token secret & expiry   |
| `BREVO_API_KEY`, `SMTP_USER`, `SMTP_FROM_NAME`                                         | Email/OTP via Brevo           |
| `OTP_LENGTH`, `OTP_EXPIRES_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS` | Konfigurasi OTP               |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`               | Upload gambar menu            |

---

## API Overview

Base URL: `http://localhost:5000/api/v1`

| Modul           | Prefix                         | Ringkasan                                                                               |
| --------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| Auth            | `/auth`                        | Register, verifikasi OTP, login, refresh, forgot/reset password, change password, `/me` |
| Inventory       | `/inventory` & `/subinventory` | CRUD inventory, batch, FEFO check/deduct/reverse, riwayat stok                          |
| Menu            | `/menu`                        | CRUD menu, upload gambar, resep live ke inventory                                       |
| Production Plan | `/plan`                        | Buat/approve/stop plan, cek ketersediaan, diskon                                        |
| Selling         | `/selling`                     | Ambil plan aktif, catat penjualan, riwayat penjualan                                    |
| Plan Report     | `/plan-reports`                | Laporan kerugian, review, replacement stok                                              |
| Dashboard       | `/dashboard`                   | Ringkasan penjualan harian, tren per jam, breakdown menu                                |
| AI Prediction   | `/predictions`                 | Rekomendasi assortment menu                                                             |
| Health          | `/health`                      | Health check                                                                            |

Dokumentasi endpoint detail tersedia di setiap subsection **Detailed Module Flows** dan folder `docs/`.

---

## Testing

Saat ini mencakup:

- Auth flow
- Health check

Dijalankan dengan Jest + Supertest di atas `mongodb-memory-server`.

```bash
npm test
```

Coverage domain lain masih menyusul.

---

## Roadmap / Known Limitations

- Belum ada Docker/`docker-compose`.
- Belum ada CI/CD workflow.
- Test coverage baru Auth dan health check.
- Belum ada `.nvmrc`/`engines` untuk mengunci versi Node.js.
- Belum ada OpenAPI/Swagger; dokumentasi berbasis Markdown + Postman collection.

---

## Team

- Muhammad Daffa' Fisabilillah
- Arianto Blawa Maran
