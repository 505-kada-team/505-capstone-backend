# RFC Dashboard

## Scope

Modul Dashboard menampilkan ringkasan performa per plan pada level harian. Tujuan utamanya adalah memberi insight cepat ke tim operasi tentang revenue, penjualan, dan metrik plan tanpa harus menelusuri detail transaksi.

## Goals

- Sediakan endpoint yang dapat mengambil metrik dashboard per plan dan per tanggal.
- Pastikan endpoint hanya bisa diakses oleh user yang terautentikasi.
- Validasi input `planId` dan `date` secara ketat.

## API Contract

### GET `/api/v1/dashboard/plan/:planId/daily?date=YYYY-MM-DD`

Request:
- Path param: `planId` (24-digit hex ObjectId)
- Query param: `date` (`YYYY-MM-DD`)
- Header: `Authorization: Bearer <accessToken>`

Response success:
- `success: true`
- `data`: objek metrik dashboard
- `message`: teks deskriptif

## Decision

- Endpoint dashboard tetap berada di prefix `/dashboard`, bukan digabung dengan `/plan`.
- Hanya satu endpoint utama diperlukan untuk saat ini, karena fokusnya adalah daily summary.
- Backend tidak mengeluarkan rekomendasi AI di modul ini. Prediction berbeda dan diletakkan di `/predictions`.
