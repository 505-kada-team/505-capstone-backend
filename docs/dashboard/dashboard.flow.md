# dashboard.flow.md

> Ringkasan status & keputusan modul Dashboard. Update dokumen ini setiap ada perubahan endpoint, request/response contract, atau dependency terhadap data plan/penjualan.

## Status saat ini

| Layer | File | Status |
| --- | --- | --- |
| RFC awal | `dashboard.rfc.md` | ✅ Selesai |
| Model | `src/models/dashboard` | ⬜ Belum ada jika belum dibuat |
| Service | `src/services/dashboard.service.js` | ⬜ Belum ada jika belum dibuat |
| Controller | `src/controllers/dashboard.controller.js` | ✅ Selesai |
| Routes | `src/routes/dashboard.routes.js` | ✅ Selesai |
| Validasi | `src/validations/dashboard.validation.js` | ✅ Selesai |
| Postman collection | `docs/postman/kada-dashboard.postman.json` | ✅ Dibuat |

## Endpoint utama

| # | Method | Path | Tujuan |
| --- | --- | --- | --- |
| D1 | GET | `/api/v1/dashboard/plan/:planId/daily?date=YYYY-MM-DD` | Ambil agregasi metrik harian untuk plan |

## Catatan penting

- Endpoint dilindungi JWT dan memerlukan `Authorization: Bearer {{authToken}}`.
- `planId` adalah ObjectId Mongo yang valid.
- `date` harus format `YYYY-MM-DD`.
- Dashboard membaca data dari `plan` dan `selling` untuk menampilkan performa harian.
