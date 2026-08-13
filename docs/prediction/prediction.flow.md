# prediction.flow.md

> Ringkasan status & keputusan modul Prediction. Update dokumen ini setiap ada perubahan contract AI/ML atau perubahan flow prediksi plan.

## Status saat ini

| Layer | File | Status |
| --- | --- | --- |
| RFC awal | `prediction.rfc.md` | ✅ Selesai |
| Model | `src/models/prediction` | ⬜ Belum ada jika belum dibuat |
| Service | `src/services/prediction.service.js` | ⬜ Belum ada jika belum dibuat |
| Controller | `src/controllers/prediction.controller.js` | ✅ Selesai |
| Routes | `src/routes/prediction.routes.js` | ✅ Selesai |
| Validasi | `src/validations/prediction.validation.js` | ✅ Selesai |
| Postman collection | `docs/postman/kada-prediction.postman.json` | ✅ Dibuat |

## Endpoint utama

| # | Method | Path | Tujuan |
| --- | --- | --- | --- |
| P1 | POST | `/api/v1/predictions/assortment` | Ambil rekomendasi assortment/plan berdasar durasi + tanggal + tag |

## Catatan penting

- Prediction memakai JWT auth dan memerlukan `Authorization: Bearer {{authToken}}`.
- Input `duration` harus `3–30` hari.
- `startDate` harus valid ISO date.
- `tags` bersifat optional.
