# Afternoon Coffee Inventory Management 

Backend service untuk **Afternoon Coffee Management System**: sistem manajemen produksi,
penjualan, dan forecasting untuk bisnis F&B (food & beverage) berbasis kedai kopi.

Dokumen ini adalah dokumentasi **base code** — infrastruktur, konvensi, dan aturan main yang
berlaku untuk seluruh modul domain yang akan dibangun di atasnya (Authentication, Inventory,
Menu, Production Planning, Selling, Plan Report, Dashboard, AI Forecasting).

Dokumentasi flow, skema model, dan API contract per modul dibuat terpisah begitu modul tersebut
mulai dikerjakan (lihat [Dokumentasi Per Modul](#dokumentasi-per-modul)). README ini **tidak**
menjelaskan detail bisnis suatu modul — tugasnya hanya memastikan siapa pun yang membuka repo
ini tahu persis bagaimana project ini disusun dan aturan apa yang wajib diikuti sebelum menulis
kode fitur.

---

## Daftar Isi

- [Ringkasan Produk](#ringkasan-produk)
- [Tech Stack](#tech-stack)
- [Prasyarat](#prasyarat)
- [Menjalankan Proyek](#menjalankan-proyek)
- [Environment Variables](#environment-variables)
- [Struktur Folder](#struktur-folder)
- [Arsitektur & Request Lifecycle](#arsitektur--request-lifecycle)
- [Konvensi Kode](#konvensi-kode)
  - [Response Format](#1-response-format)
  - [Error Handling](#2-error-handling)
  - [Validasi Input](#3-validasi-input)
  - [Async Handler](#4-async-handler)
  - [Pagination](#5-pagination)
  - [Logging](#6-logging)
- [Konvensi Penamaan Modul Baru](#konvensi-penamaan-modul-baru)
- [Testing](#testing)
- [Lint & Format](#lint--format)
- [Alur Kerja Git & PR](#alur-kerja-git--pr)
- [Definition of Done (per Modul)](#definition-of-done-per-modul)
- [Roadmap Modul](#roadmap-modul)
- [Dokumentasi Per Modul](#dokumentasi-per-modul)

---

## Ringkasan Produk

KADA membantu tim produksi & penjualan kedai kopi mengelola siklus operasional harian:

1. **Merencanakan produksi** menu apa saja yang akan dijual dalam satu periode (Production Plan),
   berdasarkan ketersediaan bahan baku (Inventory).
2. **Menjalankan penjualan** dari plan yang aktif (Selling), termasuk mencatat sisa/waste/shortage.
3. **Melaporkan hasil** tiap plan yang sudah selesai berjalan (Plan Report) untuk evaluasi margin
   dan performa menu.
4. **Menganalisis tren** penjualan lewat dashboard, dan pada tahap lanjut, memberi **rekomendasi
   plan berbasis data historis + AI/LLM**.

Backend ini adalah **satu-satunya sumber kebenaran (source of truth)** untuk seluruh alur di
atas: validasi bisnis, konsistensi data (mis. deduksi stok saat plan disetujui), dan API contract
yang dikonsumsi oleh frontend maupun oleh tim data analyst untuk kebutuhan forecasting.

## Tech Stack

| Layer                    | Teknologi                                    | Keterangan                                     |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Runtime & Framework       | Node.js + Express                              | REST API, versioned di bawah `/api/v1`          |
| Database                  | MongoDB + Mongoose                             | Schema-based ODM, transaksi via `mongoose.Types.ObjectId` sessions saat dibutuhkan |
| Auth                       | JWT (`jsonwebtoken`) + `bcryptjs`               | Access/refresh token, role `ADMIN` & `CASHIER`  |
| Validasi Input             | Joi                                             | Terpusat lewat `validate.middleware.js`         |
| Email                      | Brevo Transactional API / Nodemailer            | Untuk notifikasi/OTP saat modul terkait dibuat   |
| Security Headers           | Helmet                                          | Default secure headers                          |
| Rate Limiting              | express-rate-limit                              | Global limiter + limiter khusus per route sensitif |
| NoSQL Injection Guard      | express-mongo-sanitize                          | Sanitasi `req.body`/`req.query`                 |
| Logging                    | winston + morgan                                | HTTP access log diarahkan ke winston            |
| Testing                    | Jest + Supertest + mongodb-memory-server        | Unit & integration test tanpa DB eksternal      |
| Lint & Format              | ESLint + Prettier + Husky + lint-staged         | Enforced di pre-commit                          |

## Prasyarat

- Node.js ≥ 18
- MongoDB (lokal via `mongod`, atau Atlas — cukup ganti `MONGO_URI`)
- npm ≥ 9

## Menjalankan Proyek

```bash
npm install
cp .env.example .env   # sesuaikan MONGO_URI, CLIENT_URL, dll.
npm run dev             # nodemon, auto-restart saat file berubah
```

Endpoint yang tersedia di base code saat ini:

| Method | Endpoint            | Deskripsi                              |
| ------ | -------------------- | ---------------------------------------- |
| GET    | `/`                   | Status server (mode env aktif)          |
| GET    | `/api/v1/health`      | Health check, dipakai CI/monitoring     |

## Environment Variables

Divalidasi terpusat di `src/config/env.js` memakai Joi — **server sengaja gagal start (fail
fast)** kalau ada variabel wajib yang belum diset, daripada baru error di tengah request.

| Variabel                 | Wajib | Default   | Keterangan                                      |
| -------------------------- | :---: | :---------: | -------------------------------------------------- |
| `NODE_ENV`                  | ❌    | `development` | `development` \| `production` \| `test`         |
| `PORT`                      | ❌    | `5000`       | Port HTTP server                                |
| `CLIENT_URL`                | ✅    | —           | Origin frontend untuk konfigurasi CORS          |
| `MONGO_URI`                  | ✅    | —           | Connection string MongoDB                       |
| `RATE_LIMIT_WINDOW_MS`      | ❌    | `900000`     | Window rate limit global (ms)                   |
| `RATE_LIMIT_MAX`             | ❌    | `100`        | Maks request per window per IP                  |

> Saat menambah modul baru yang butuh variabel baru (mis. `JWT_SECRET`, `JWT_REFRESH_SECRET`,
> `OTP_EXPIRES_IN`, `BREVO_API_KEY`), **tambahkan juga validasinya di `envSchema`** —
> jangan hanya `process.env.X` liar di file lain. Ini menjaga semua konfigurasi terpusat di satu
> tempat dan gagal cepat kalau ada yang lupa di-set.

## Struktur Folder

```
kada-backend/
├── server.js                    # Entrypoint: connect DB → start server → graceful shutdown
├── src/
│   ├── app.js                    # Express app: middleware pipeline + mounting routes
│   ├── config/
│   │   ├── env.js                 # Validasi & export environment variable (Joi, fail-fast)
│   │   └── db.js                  # Koneksi Mongoose ke MongoDB
│   ├── middlewares/
│   │   ├── error.middleware.js     # Global error handler, normalisasi ke ApiError
│   │   ├── notFound.middleware.js  # Handler untuk route yang tidak terdaftar (404)
│   │   └── validate.middleware.js  # Generic Joi validator untuk body/params/query
│   ├── utils/
│   │   ├── ApiError.js             # Custom error class (statusCode + message + details)
│   │   ├── ApiResponse.js          # Format response sukses yang konsisten
│   │   ├── asyncHandler.js         # Wrapper controller async, auto-forward error ke next()
│   │   ├── logger.js               # Winston logger (console + file di production)
│   │   └── paginate.js             # Helper pagination + search generik untuk Mongoose model
│   └── routes/
│       └── index.js                # Root router `/api/v1`, tempat route domain didaftarkan
└── tests/
    └── health.test.js               # Contoh pola test (Jest + Supertest)
```

Folder yang **belum ada dan dibuat per modul** saat modul tersebut mulai dikerjakan:

```
src/
├── controllers/   <module>.controller.js
├── services/       <module>.service.js
├── models/          <module>.model.js
├── validations/      <module>.validation.js
└── routes/            <module>.routes.js
```

Lihat [Konvensi Penamaan Modul Baru](#konvensi-penamaan-modul-baru) untuk aturan lengkapnya.

## Arsitektur & Request Lifecycle

Setiap request masuk lewat pipeline middleware berikut (didefinisikan di `src/app.js`, urutan
ini **penting** dan tidak boleh diubah tanpa alasan kuat):

```
Client
  │
  ▼
helmet()                     → security headers
  │
  ▼
cors({ origin: CLIENT_URL })  → hanya izinkan origin frontend yang terdaftar
  │
  ▼
express.json / urlencoded     → body parsing (limit 10kb)
  │
  ▼
cookieParser()                 → parsing cookie (untuk refresh token, dst.)
  │
  ▼
mongoSanitize()                 → strip operator MongoDB ($, .) dari body/query
  │
  ▼
compression()                    → gzip response
  │
  ▼
morgan → winston                  → access log tiap request
  │
  ▼
rateLimit (global)                 → 100 req / 15 menit per IP (default)
  │
  ▼
router '/api/v1'                    → route domain (auth, inventory, plan, dst.)
  │         │
  │         ▼
  │      validate(schema)  → Joi validasi body/params/query, reject di sini kalau invalid
  │         │
  │         ▼
  │      asyncHandler(controller)  → controller → service → model
  │         │
  │         ▼
  │      ApiResponse(...).send(res)  → response sukses format konsisten
  │
  ▼ (kalau route tidak match)
notFound.middleware               → lempar ApiError(404)
  │
  ▼
error.middleware                    → normalisasi semua error → response format konsisten
```

**Prinsip pembagian layer** (berlaku untuk semua modul domain nanti):

- **Route** — hanya mendaftarkan endpoint + middleware (`validate`, `auth`, dst). Tidak ada
  logic di sini.
- **Controller** — menerima `req`, memanggil service, mengembalikan `ApiResponse`. Tidak ada
  query database langsung di controller.
- **Service** — seluruh business logic & query ke model ada di sini. Service yang melempar
  `ApiError` kalau ada pelanggaran aturan bisnis (mis. stok tidak cukup, plan sudah aktif, dll).
- **Model** — schema Mongoose murni. Boleh berisi instance/static method sederhana (mis.
  `isEmailTaken`), tapi bukan tempat business logic kompleks.

## Konvensi Kode

### 1. Response Format

Semua response sukses **wajib** lewat `ApiResponse`, jangan `res.json(...)` manual:

```js
const ApiResponse = require('../utils/ApiResponse');

// GET tanpa pagination
return new ApiResponse(200, user, 'Berhasil mengambil data user').send(res);

// GET dengan pagination (lihat bagian Pagination)
return new ApiResponse(200, data, 'Berhasil mengambil data user', meta).send(res);
```

Bentuk response yang dihasilkan konsisten untuk seluruh API:

```json
{
  "success": true,
  "message": "Berhasil mengambil data user",
  "data": {},
  "meta": { "page": 1, "limit": 10, "total": 42 }
}
```

### 2. Error Handling

Jangan pernah `throw new Error(...)` biasa di service/controller — selalu `ApiError`:

```js
const ApiError = require('../utils/ApiError');

if (!user) throw new ApiError(404, 'User tidak ditemukan');
if (stockQty < requestedQty) throw new ApiError(400, 'Stok tidak mencukupi');
```

`error.middleware.js` sudah menangani otomatis dan mengubah ke format konsisten:

- **Mongoose duplicate key (`11000`)** → `409 Conflict`
- **Mongoose `ValidationError`** → `400 Bad Request` dengan `details` array
- **`JsonWebTokenError` / `TokenExpiredError`** → `401 Unauthorized`
- **Error lain yang tak terduga** → `500`, di-log via winston, stack trace hanya tampil di
  `NODE_ENV=development`

Bentuk response error:

```json
{
  "success": false,
  "message": "Stok tidak mencukupi",
  "details": null
}
```

### 3. Validasi Input

Semua endpoint yang menerima body/params/query **wajib** punya Joi schema, didaftarkan lewat
`validate.middleware.js` di level route:

```js
// src/validations/auth.validation.js
const Joi = require('joi');

module.exports = {
  register: {
    body: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(8).required(),
    }),
  },
};

// src/routes/auth.routes.js
router.post('/register', validate(authValidation.register), authController.register);
```

`stripUnknown: true` otomatis aktif — field yang tidak didefinisikan di schema akan dibuang, jadi
tidak perlu whitelist manual di controller.

### 4. Async Handler

Semua controller async **wajib** dibungkus `asyncHandler` supaya error otomatis diteruskan ke
`error.middleware` tanpa try-catch manual di tiap controller:

```js
const asyncHandler = require('../utils/asyncHandler');

exports.register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return new ApiResponse(201, user, 'Registrasi berhasil').send(res);
});
```

### 5. Pagination

Untuk endpoint list dengan pagination + search, pakai helper `paginate` — jangan menulis ulang
logic `skip`/`limit` manual di tiap service:

```js
const paginate = require('../utils/paginate');

const { data, meta } = await paginate(
  InventoryModel,
  { deletedAt: null }, // base filter wajib
  req.query,             // ?page=2&limit=20&search=kopi
  { searchableFields: ['name'] }
);
```

Query param yang didukung secara default: `page`, `limit` (maks 100), `sort`, `search`.

### 6. Logging

Pakai `logger` (winston), **jangan `console.log`** — ESLint sudah men-set `no-console: warn`.

```js
const logger = require('../utils/logger');
logger.info('Plan berhasil diapprove');
logger.error(`Gagal deduksi stok: ${err.message}`);
```

## Konvensi Penamaan Modul Baru

Setiap modul domain (auth, inventory, menu, plan, selling, plan-report, dashboard, forecasting)
mengikuti pola file & penamaan yang sama:

| File                                        | Isi                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| `src/models/<module>.model.js`                 | Mongoose schema + index                                    |
| `src/validations/<module>.validation.js`         | Joi schema per endpoint (`create`, `update`, `getById`, dst.) |
| `src/services/<module>.service.js`                | Business logic + query ke model, melempar `ApiError`       |
| `src/controllers/<module>.controller.js`           | Menerima request, panggil service, kembalikan `ApiResponse` |
| `src/routes/<module>.routes.js`                     | Definisi endpoint + middleware `validate`/`auth`             |

Route prefix mengikuti nama modul dan didaftarkan di `src/routes/index.js`:

```js
const authRoutes = require('./auth.routes');
router.use('/auth', authRoutes); // → /api/v1/auth/*
```

## Testing

```bash
npm test         # jest --runInBand --detectOpenHandles
npm run test:watch
```

Pola dasar mengikuti `tests/health.test.js` — integration test lewat Supertest langsung ke
`src/app.js` (bukan lewat `server.js`, supaya tidak perlu koneksi network sungguhan). Untuk modul
yang menyentuh database, gunakan `mongodb-memory-server` supaya test tidak bergantung pada
instance MongoDB eksternal dan aman dijalankan di CI.

Minimal test yang wajib ada per endpoint baru:

1. Skenario sukses (happy path)
2. Skenario validasi gagal (`400`)
3. Skenario aturan bisnis dilanggar (mis. `404`/`409` sesuai kasus)

## Lint & Format

```bash
npm run lint        # eslint . --ext .js
npm run lint:fix
npm run format        # prettier --write .
```

Husky + lint-staged sudah dikonfigurasi (`npm run prepare`) — `eslint --fix` dan
`prettier --write` otomatis jalan di file yang di-stage sebelum commit berhasil dibuat.

## Alur Kerja Git & PR

- **Satu modul = satu branch = satu PR.** Branch dari `main`, penamaan: `feat/<module>`
  (mis. `feat/authentication`, `feat/inventory`).
- Commit message ringkas & deskriptif, sebaiknya mengikuti [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- PR wajib menyertakan ringkasan endpoint yang ditambahkan/diubah dan link ke dokumentasi modul
  terkait (lihat [Dokumentasi Per Modul](#dokumentasi-per-modul)).
- Tidak menyentuh contract/schema modul lain yang sudah final tanpa diskusi — perubahan lintas
  modul harus dijelaskan alasannya di deskripsi PR.

## Definition of Done (per Modul)

Sebuah PR modul dianggap selesai kalau memenuhi semua poin berikut:

- [ ] Endpoint berjalan sesuai validasi Joi (semua field wajib tervalidasi, error message jelas)
- [ ] Business logic ada di service, bukan di controller
- [ ] Error case dilempar sebagai `ApiError` dengan status code yang tepat
- [ ] Test ditambahkan mengikuti pola `tests/health.test.js` (happy path + error case)
- [ ] `npm run lint` lolos tanpa warning baru
- [ ] Dokumentasi modul (model schema, logic flow, request/response) diperbarui — lihat
      [Dokumentasi Per Modul](#dokumentasi-per-modul)
- [ ] Environment variable baru (jika ada) ditambahkan ke `.env.example` **dan** ke
      `envSchema` di `src/config/env.js`

## Roadmap Modul

Urutan pengerjaan, satu modul = satu branch = satu PR:

| # | Modul                    | Route Prefix         | Deskripsi Singkat                                             |
| - | -------------------------- | ----------------------- | ------------------------------------------------------------------ |
| 1 | Authentication              | `/api/v1/auth`            | Register/login/refresh token, role `ADMIN` & `CASHIER`             |
| 2 | Inventory Management         | `/api/v1/inventory`         | Ingredient, batch, expiry, status available/unavailable            |
| 3 | Menu Management                | `/api/v1/menu`                | Recipe, kalkulasi margin                                            |
| 4 | Production Planning              | `/api/v1/plan`                  | Draft Plan → Active Plan, diskon per menu per plan (live-evaluated) |
| 5 | Selling / Simulasi Kasir            | `/api/v1/selling`                 | Pencatatan penjualan, waste/leftover/shortage, snapshot harga         |
| 6 | Report Planning                       | `/api/v1/plan-reports`              | Laporan hasil plan yang telah berjalan (final, disimpan permanen)     |
| 7 | Dashboard                                | `/api/v1/dashboard`                   | Agregasi revenue, trend, top menu                                     |
| 8 | Create Plan with AI                        | `/api/v1/predictions`                   | Rekomendasi plan berbasis data historis + LLM                          |

## Dashboard & Prediction

`Dashboard` dan `Prediction` adalah modul insight yang bekerja di atas data plan dan selling. Keduanya memakai JWT access token karena data yang dikembalikan bersifat sensitif dan hanya boleh diakses oleh user terautentikasi.

### Dashboard

- Prefix: `/api/v1/dashboard`
- Endpoint utama:
  - `GET /api/v1/dashboard/plan/:planId/daily?date=YYYY-MM-DD`
- Deskripsi:
  - Mengembalikan ringkasan harian untuk satu plan.
  - Response biasanya berisi agregasi revenue, performa menu, target vs aktual, dan metrik plan terkait untuk tanggal yang diminta.
- Validasi input:
  - `planId` harus berupa MongoDB ObjectId 24 karakter hex.
  - `date` wajib dalam format `YYYY-MM-DD`.
- Autentikasi:
  - `Authorization: Bearer <accessToken>`

### Prediction

- Prefix: `/api/v1/predictions`
- Endpoint utama:
  - `POST /api/v1/predictions/assortment`
- Deskripsi:
  - Menghasilkan rekomendasi assortment/plan berbasis input durasi, tanggal mulai, dan tag.
  - Output digunakan untuk membantu front-end memilih prospek menu dan stok yang cocok selama periode plan.
- Request body:
  - `duration`: integer, antara `3` dan `30` hari.
  - `startDate`: ISO date string.
  - `tags`: array string optional.
- Autentikasi:
  - `Authorization: Bearer <accessToken>`

### Dashboard

- Prefix: `/api/v1/dashboard`
- Endpoint utama:
  - `GET /api/v1/dashboard/plan/:planId/daily?date=YYYY-MM-DD`
- Deskripsi:
  - Mengembalikan ringkasan harian untuk satu plan.
  - Response biasanya berisi agregasi revenue, performa menu, target vs aktual, dan metrik plan terkait untuk tanggal yang diminta.
- Validasi input:
  - `planId` harus berupa MongoDB ObjectId 24 karakter hex.
  - `date` wajib dalam format `YYYY-MM-DD`.
- Autentikasi:
  - `Authorization: Bearer <accessToken>`

## Dokumentasi Per Modul

Dokumentasi berikut akan terletak di `docs/<module>.md` (atau lokasi yang disepakati tim)
dan **wajib** mencakup:

1. **Ringkasan & scope** — apa yang termasuk dan tidak termasuk di modul ini
2. **Model/schema** — struktur Mongoose schema, index, relasi ke modul lain
3. **Business rules** — aturan yang tidak terlihat langsung dari schema (mis. "satu plan aktif
   dalam satu waktu", "diskon live-evaluated bukan frozen")
4. **Logic flow** — alur proses per aksi penting (mis. approve plan → deduksi stok), idealnya
   disertai diagram
5. **API contract** — daftar endpoint, request payload, response payload (sukses & error), status
   code per skenario
6. **Keputusan desain & alasan** — kenapa suatu pendekatan dipilih dibanding alternatif lain,
   supaya keputusan tidak perlu didiskusikan ulang di kemudian hari