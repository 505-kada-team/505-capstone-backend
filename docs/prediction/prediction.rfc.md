# RFC Prediction

## Scope

Modul Prediction menyediakan rekomendasi assortment/plan berbasis input periode dan tag. Output bertujuan membantu tim perencanaan memilih menu yang tepat untuk periode mendatang.

## Goals

- Menyediakan endpoint analisis prediksi yang sederhana dan dapat digunakan oleh frontend.
- Memisahkan logika rekomendasi dari modul dashboard.
- Menjaga input yang mudah diverifikasi (durasi, tanggal mulai, tag).

## API Contract

### POST `/api/v1/predictions/assortment`

Request body:
- `duration`: integer, 3–30
- `startDate`: valid ISO date
- `tags`: array string, optional
- Header: `Authorization: Bearer <accessToken>`

Response success:
- `success: true`
- `data`: objek prediksi
- `message`: teks deskriptif

## Decision

- Prefix `/predictions` dipilih agar jelas dipisah dari dashboard dan plan CRUD.
- Endpoint saat ini hanya satu, untuk menampung logika model yang bisa berkembang nanti.
- Validasi dilakukan di middleware `validate(predictionValidation.getAssortmentPrediction)`.
