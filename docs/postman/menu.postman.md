# Menu Service — Postman Collection

File: `kada-menu.postman.json` (Postman Collection v2.1). Import langsung lewat **Import → File** di Postman.

## Isi collection

**Folder "Happy Path Flow"** — dirancang jalan berurutan (pakai Postman Runner), saling terhubung lewat collection variable `menuId` yang di-set otomatis oleh test script di request pertama:

| #   | Request                        | Endpoint                 | Efek yang diuji                                                                      |
| --- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------ |
| 1   | Create Menu                    | `POST /api/menu`         | validasi ingredient + set `menuId`                                                   |
| 2   | Get Menus (List)               | `GET /api/menu`          | pagination, search, filter status                                                    |
| 3   | Get Menu Dropdown              | `GET /api/menu/dropdown` | field minimal (`_id, name, sellingPrice, image`)                                     |
| 4   | Get Menu By Id                 | `GET /api/menu/:id`      | cost breakdown live dari Inventory                                                   |
| 5   | Update — Name/Description Only | `PUT /api/menu/:id`      | **tidak** memicu stale cascade                                                       |
| 6   | Update — Ingredients/Price     | `PUT /api/menu/:id`      | memicu `checkResultStale=true`, `staleReason='recipe_changed'` di draft Plan terkait |
| 7   | Delete Menu                    | `DELETE /api/menu/:id`   | soft delete + cascade `staleReason='menu_archived'`                                  |
| 8   | Get Menu By Id (After Delete)  | `GET /api/menu/:id`      | expect `404`                                                                         |

**Folder "Validation & Edge Cases"** — request independen, tidak bergantung pada `menuId`:

- Create Menu — duplicate `inventoryId` → `400`
- Create Menu — `inventoryId` tidak valid / status bukan `active` → `400`
- Get Menu By Id — id valid tapi tidak ada di DB → `404`
- Get Menus — `includeDeleted=true` untuk verifikasi menu hasil folder pertama sudah ter-soft-delete

## Variables

Diset di level Collection (tab **Variables**), bisa di-override per Environment:

| Variable                       | Default                 | Keterangan                                                                |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| `baseUrl`                      | `http://localhost:3000` | ganti sesuai environment (local/staging)                                  |
| `accessToken`                  | _(kosong)_              | dipakai di Authorization: Bearer (lihat catatan auth di bawah)            |
| `menuId`                       | _(kosong)_              | otomatis ke-set setelah request "Create Menu" sukses                      |
| `inventoryIdA`, `inventoryIdB` | _(kosong)_              | isi manual dengan `_id` Inventory berstatus `active` di DB kamu           |
| `inventoryIdArchived`          | _(kosong)_              | isi dengan `_id` Inventory berstatus `deleted`, dipakai di test edge case |

**Wajib diisi sebelum run:** `accessToken`, `inventoryIdA`, `inventoryIdB`, `inventoryIdArchived` — collection tidak bisa jalan tanpa ini karena route menu di-guard `authenticate` middleware dan `validateIngredients` cek eksistensi Inventory ke DB beneran.

## Catatan soal auth

Route menu dipasangi `router.use(authenticate)`. Collection ini pakai skema **Bearer Token** (`Authorization: Bearer {{accessToken}}`) di level collection karena itu cara paling gampang dites lewat Postman.

Kalau di implementasi kamu access token dikirim sebagai **cookie** (sesuai desain multiplatform delivery yang lagi kamu kerjakan — cookie untuk web, body untuk mobile via header `x-platform`), sesuaikan salah satu dari dua opsi:

1. Tambah request "Login" terpisah di awal folder yang nge-set cookie otomatis (Postman ikut simpan cookie kalau domain sama), lalu hapus auth Bearer di collection level.
2. Kalau access token dikirim lewat body untuk mobile flow, tambahkan header `x-platform: mobile` manual di tiap request dan sesuaikan cara ambil token dari response login.

Saat ini collection **belum** menyertakan request login/refresh karena modul Auth tidak ada di kode yang di-share — tinggal tambahkan foldernya kalau mau full end-to-end dari login.

## Catatan soal model Production Plan

Kode `menu.service.js` mengasumsikan model Production Plan punya field `status`, `menus[].menuId`, `checkResultStale`, `staleReason` (lihat komentar `TODO` di paling atas file). Field `affectedDraftPlans` di response Update/Delete hanya akan berisi data kalau model itu sudah match — kalau masih pakai nama field lain, hasil test `affectedDraftPlans` di request #6 dan #7 perlu disesuaikan lagi.

## Cara pakai cepat

1. Import `kada-menu.postman.json`.
2. Isi variable di atas (klik nama collection → tab **Variables**).
3. Jalankan folder **Happy Path Flow** lewat Runner secara berurutan.
4. Jalankan folder **Validation & Edge Cases** kapan saja, independen.
