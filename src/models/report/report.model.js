const mongoose = require('mongoose');

const { Schema } = mongoose;

// D-PR6.2 — reason wajib. Draft awal tidak eksplisit mewajibkan, tapi
// laporan tanpa alasan tidak informatif untuk admin yang review.
const MAX_REASON_LENGTH = 500;

// Sub-skema replacementBatches — bentuk sama dengan committedBatchSchema
// milik ProductionPlan (subInventoryId, quantityUsed, costPriceUsed), tapi
// SENGAJA didefinisikan ulang di sini (bukan reuse/import) karena
// PlanReport tidak boleh punya dependency langsung ke internal schema
// ProductionPlan — dua modul ini disambungkan lewat planId saja.
const replacementBatchSchema = new Schema(
  {
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    quantityUsed: { type: Number, required: true, min: 0 },
    costPriceUsed: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// D-PR2a — hanya terisi kalau category: "menu". costComplete/warning wajib
// ada di sini (bukan opsional) karena unitCostAtLoss dihitung dari live
// Menu.ingredients yang bisa saja punya ingredient yang tidak match di
// committedIngredients plan (mis. resep diedit setelah approve) — lihat
// D-PR2/D-PR2a di rfc-plan-report-final.md.
const valuationSchema = new Schema(
  {
    unitCostAtLoss: { type: Number, required: true, min: 0 },
    costLoss: { type: Number, required: true, min: 0 },

    // D-PR1 — SUMBER: plan.menus[].frozenSellingPrice, BUKAN live
    // Menu.sellingPrice. Baseline harus sama dengan PlanSale.originalPrice
    // supaya Forecasting bisa membandingkan revenueActual vs kerugian
    // dengan baseline yang konsisten.
    originalPriceAtLoss: { type: Number, required: true, min: 0 },

    // Dievaluasi terhadap incidentAt, BUKAN now() atau reviewedAt.
    discountAppliedAtLoss: { type: Boolean, required: true, default: false },
    discountPercentageAtLoss: { type: Number, default: null, min: 1, max: 100 },
    priceUsedAtLoss: { type: Number, required: true, min: 0 },
    lostRevenueEstimate: { type: Number, required: true, min: 0 },

    // D-PR2a — true kalau SEMUA ingredient resep live berhasil di-match ke
    // committedIngredients plan. false + warning terisi kalau ada yang
    // di-skip (dikecualikan dari perhitungan, bukan bikin request gagal).
    costComplete: { type: Boolean, required: true, default: true },
    warning: { type: String, default: null },
  },
  { _id: false }
);

const planReportSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', required: true },

    category: { type: String, enum: ['ingredient', 'menu'], required: true },

    // D-PR6.1 — TANPA `ref` statis, karena bisa menunjuk Inventory atau
    // Menu tergantung category. Resolusi dokumen asli (nameRef di C2)
    // jadi tanggung jawab planReport.service.js (join manual), bukan
    // populate() — konsisten dengan pola PlanReport lain di codebase ini.
    refId: { type: Schema.Types.ObjectId, required: true },

    // Fakta kejadian, immutable setelah dilaporkan — tidak divalidasi
    // terhadap committedIngredients, tidak berubah walau direview/ditolak.
    quantityLost: { type: Number, required: true, min: 0 },

    // Waktu kejadian sebenarnya (bukan waktu lapor). Wajib, <= now(), dan
    // harus berada dalam rentang durasi plan — divalidasi di service,
    // bukan di sini (butuh baca dokumen Plan).
    incidentAt: { type: Date, required: true },

    // Turunan: true kalau createdAt - incidentAt > 24 jam. Dihitung sekali
    // di C1, disimpan (bukan getter virtual) supaya konsisten dengan pola
    // "semua yang dihitung saat create, dibekukan" di modul ini.
    isLateReport: { type: Boolean, required: true, default: false },

    reason: { type: String, required: true, trim: true, maxlength: MAX_REASON_LENGTH },
    reportedBy: { type: String, required: true, trim: true },
    reportedByRole: { type: String, enum: ['cashier', 'admin'], required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    adminNote: { type: String, default: null },

    // Hanya terisi kalau category: "menu". null untuk category: "ingredient".
    valuation: { type: valuationSchema, default: null },

    // --- Khusus category: "ingredient" (C4) ---------------------------
    // Keputusan operasional admin, TIDAK wajib sama dengan quantityLost.
    replacementQuantity: { type: Number, default: null, min: 0 },
    varianceNote: { type: String, default: null },
    replacementDeducted: { type: Boolean, default: false },
    replacementBatches: { type: [replacementBatchSchema], default: [] },
    replacementCost: { type: Number, default: null, min: 0 },
    replacedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
  },
  { timestamps: true }
);

// D-PR6.3 — 3 index terpisah untuk 3 pola akses berbeda.

// C2: list laporan, filter planId+status+category (semua kombinasi opsional
// di query, tapi planId jadi filter paling umum dipakai duluan).
planReportSchema.index({ planId: 1, status: 1, category: 1 });

// C4: cari laporan category:ingredient yang siap di-deduct
// (status: approved, replacementDeducted: false) untuk refId tertentu.
planReportSchema.index({ refId: 1, category: 1, status: 1, replacementDeducted: 1 });

// D-PR4: cek apakah masih ada laporan ingredient pending replacement untuk
// satu plan (dipakai C4 saat re-check sebelum set hasPendingLossReplacement
// jadi false — WAJIB re-check, bukan asumsi).
planReportSchema.index({ planId: 1, category: 1, status: 1, replacementDeducted: 1 });

module.exports = mongoose.model('PlanReport', planReportSchema);
