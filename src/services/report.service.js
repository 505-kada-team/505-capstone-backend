// services/planReport.service.js
const mongoose = require('mongoose');
const ProductionPlan = require('../models/plan/productionPlan.model');
const Menu = require('../models/menu/menu.model');
const PlanReport = require('../models/report/report.model');
const inventoryService = require('./inventory.service');
const Inventory = require('../models/inventory/inventory.model');
const ApiError = require('../utils/ApiError');

const LATE_REPORT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // §isLateReport, dapat dikonfigurasi nanti

// ---------------------------------------------------------------------------
// computeMenuLossValuation — D-PR2/D-PR2a: resep LIVE dari Menu.ingredients,
// weighted cost dari committedIngredients (match by inventoryId). Ingredient
// resep yang tidak ketemu di committedIngredients DIKECUALIKAN dari
// perhitungan, bukan bikin request gagal -- costComplete: false + warning.
//
// originalPriceAtLoss (D-PR1) = planMenu.frozenSellingPrice, BUKAN live
// Menu.sellingPrice -- baseline harus sama dengan PlanSale.originalPrice.
//
// discount dievaluasi terhadap incidentAt, BUKAN now().
// ---------------------------------------------------------------------------
function computeMenuLossValuation({
  planMenu,
  menuDoc,
  committedIngredients,
  incidentAt,
  quantityLost,
}) {
  const committedByInventoryId = new Map(
    (committedIngredients || []).map((ci) => [String(ci.inventoryId), ci])
  );

  let unitCostAtLoss = 0;
  let costComplete = true;
  let missingCount = 0;

  for (const ing of menuDoc.ingredients) {
    const committed = committedByInventoryId.get(String(ing.inventoryId));
    if (!committed || !committed.batches || committed.batches.length === 0) {
      costComplete = false;
      missingCount += 1;
      continue; // dikecualikan, bukan bikin gagal (D-PR2a)
    }

    const totalQty = committed.batches.reduce((sum, b) => sum + b.quantityUsed, 0);
    const totalCost = committed.batches.reduce(
      (sum, b) => sum + b.quantityUsed * b.costPriceUsed,
      0
    );
    const weightedAvgCost = totalQty > 0 ? totalCost / totalQty : 0;

    unitCostAtLoss += weightedAvgCost * ing.quantityNeeded;
  }

  const costLoss = unitCostAtLoss * quantityLost;

  // D-PR1
  const originalPriceAtLoss = planMenu.frozenSellingPrice;

  let discountAppliedAtLoss = false;
  let discountPercentageAtLoss = null;
  const discount = planMenu.discount;
  if (
    discount &&
    incidentAt >= new Date(discount.startDate) &&
    incidentAt <= new Date(discount.endDate)
  ) {
    discountAppliedAtLoss = true;
    discountPercentageAtLoss = discount.discountPercentage;
  }

  const priceUsedAtLoss = discountAppliedAtLoss
    ? Math.round(originalPriceAtLoss * (1 - discountPercentageAtLoss / 100))
    : originalPriceAtLoss;

  const lostRevenueEstimate = priceUsedAtLoss * quantityLost;

  const warning = costComplete
    ? null
    : `${missingCount} ingredient resep tidak ditemukan di committedIngredients plan, dikecualikan dari perhitungan cost`;

  return {
    unitCostAtLoss,
    costLoss,
    originalPriceAtLoss,
    discountAppliedAtLoss,
    discountPercentageAtLoss,
    priceUsedAtLoss,
    lostRevenueEstimate,
    costComplete,
    warning,
  };
}

// ---------------------------------------------------------------------------
// applyApprovedMenuLoss / applyApprovedIngredientLoss -- SATU-SATUNYA titik
// tulis untuk efek approve, dipanggil dari DUA tempat: C1 (admin
// auto-approve) dan C3 (review approve). Wajib reuse, bukan duplikasi
// (report.flow.md, poin C1 auto-approve).
// ---------------------------------------------------------------------------
async function applyApprovedMenuLoss({ planId, refId, quantityLost }, session) {
  // D-PR3: SATU-SATUNYA titik yang menambah menus[].lossQuantity, hanya
  // untuk category: menu yang approved.
  await ProductionPlan.updateOne(
    { _id: planId, 'menus.menuId': refId },
    { $inc: { 'menus.$.lossQuantity': quantityLost } },
    { session }
  );
}

async function applyApprovedIngredientLoss({ planId }, session) {
  // D-PR4: C1 (ingredient, admin auto-approve) & C3 (ingredient, approved)
  // sama-sama set true. Re-check di C4 nanti, bukan di sini.
  await ProductionPlan.updateOne(
    { _id: planId },
    { $set: { hasPendingLossReplacement: true } },
    { session }
  );
}

// --- C1: Lapor kerusakan/kehilangan ----------------------------------------

async function createReport({
  planId,
  category,
  refId,
  quantityLost,
  incidentAt,
  reason,
  reportedBy,
  reportedByRole,
}) {
  const plan = await ProductionPlan.findById(planId);
  if (!plan) {
    throw new ApiError(404, 'Plan tidak ditemukan');
  }

  if (!['active', 'stopped', 'completed'].includes(plan.status)) {
    throw new ApiError(409, 'Laporan hanya bisa dibuat untuk plan yang sudah pernah aktif', [
      { field: 'planId', message: `Status plan saat ini: ${plan.status}` },
    ]);
  }

  const incidentAtDate = new Date(incidentAt);
  const now = new Date();

  if (incidentAtDate > now) {
    throw new ApiError(400, 'Validation error: incidentAt tidak boleh di masa depan', [
      { field: 'incidentAt', message: 'incidentAt melebihi waktu saat ini' },
    ]);
  }

  // Plan stopped -> batas efektif stoppedAt, bukan endDate asli (D-PR5).
  const rangeEnd = plan.status === 'stopped' ? plan.stoppedAt : plan.endDate;
  if (incidentAtDate < plan.startDate || incidentAtDate > rangeEnd) {
    throw new ApiError(400, 'Validation error: incidentAt berada di luar rentang durasi plan', [
      {
        field: 'incidentAt',
        message: `incidentAt (${incidentAtDate.toISOString().slice(0, 10)}) berada di luar rentang durasi plan`,
      },
    ]);
  }

  let valuation = null;
  if (category === 'menu') {
    const planMenu = plan.menus.find((m) => String(m.menuId) === String(refId));
    if (!planMenu) {
      throw new ApiError(404, 'Menu ini tidak ada di plan tersebut', [
        { field: 'refId', message: 'refId tidak ditemukan di plan.menus' },
      ]);
    }

    const menuDoc = await Menu.findById(refId);
    if (!menuDoc) {
      throw new ApiError(404, 'Menu tidak ditemukan', [
        { field: 'refId', message: 'Menu tidak ditemukan' },
      ]);
    }

    valuation = computeMenuLossValuation({
      planMenu,
      menuDoc,
      committedIngredients: plan.committedIngredients,
      incidentAt: incidentAtDate,
      quantityLost,
    });
  } else {
    // category: 'ingredient' -> valuation tetap null. Validasi refId
    // benar-benar exist & masih active -- paralel dengan pengecekan
    // menuDoc di atas, supaya laporan dengan refId sembarangan tidak
    // lolos tersimpan.
    const inventory = await Inventory.findOne({ _id: refId, status: 'active' });
    if (!inventory) {
      throw new ApiError(404, 'Inventory tidak ditemukan', [
        { field: 'refId', message: 'Inventory tidak ditemukan atau sudah dihapus' },
      ]);
    }
  }

  const isLateReport = now.getTime() - incidentAtDate.getTime() > LATE_REPORT_THRESHOLD_MS;
  const isAdminAutoApprove = reportedByRole === 'admin';
  const reportDoc = {
    planId,
    category,
    refId,
    quantityLost,
    incidentAt: incidentAtDate,
    isLateReport,
    reason,
    reportedBy,
    reportedByRole,
    status: isAdminAutoApprove ? 'approved' : 'pending',
    valuation,
  };
  if (isAdminAutoApprove) {
    reportDoc.reviewedBy = reportedBy;
    reportDoc.reviewedAt = now;
  }

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const [report] = await PlanReport.create([reportDoc], { session });
      created = report;

      if (isAdminAutoApprove) {
        if (category === 'menu') {
          await applyApprovedMenuLoss({ planId, refId, quantityLost }, session);
        } else {
          await applyApprovedIngredientLoss({ planId }, session);
        }
      }
    });
    return created;
  } finally {
    session.endSession();
  }
}

// --- C2: List laporan --------------------------------------------------

async function listReports({ planId, status, category }) {
  const filter = {};
  if (planId) filter.planId = planId;
  if (status) filter.status = status;
  if (category) filter.category = category;

  const reports = await PlanReport.find(filter).sort({ createdAt: -1 });

  const menuIds = reports.filter((r) => r.category === 'menu').map((r) => r.refId);
  const inventoryIds = reports.filter((r) => r.category === 'ingredient').map((r) => r.refId);

  const [menus, inventories] = await Promise.all([
    menuIds.length ? Menu.find({ _id: { $in: menuIds } }).select('name') : [],
    inventoryIds.length ? Inventory.find({ _id: { $in: inventoryIds } }).select('name') : [],
  ]);
  const menuNameById = new Map(menus.map((m) => [String(m._id), m.name]));
  const inventoryNameById = new Map(inventories.map((i) => [String(i._id), i.name]));

  return reports.map((r) => ({
    _id: r._id,
    planId: r.planId,
    category: r.category,
    refId: r.refId,
    nameRef:
      r.category === 'menu'
        ? (menuNameById.get(String(r.refId)) ?? null)
        : (inventoryNameById.get(String(r.refId)) ?? null),
    quantityLost: r.quantityLost,
    incidentAt: r.incidentAt,
    isLateReport: r.isLateReport,
    // BARU -- field yang diisi user waktu lapor (C1), sebelumnya kesimpen
    // di dokumen tapi nggak pernah dipetakan ke response GET history.
    reason: r.reason,
    reportedBy: r.reportedBy,
    reportedByRole: r.reportedByRole,
    status: r.status,
    // BARU -- jejak review (C3): siapa yang ACC/tolak, kapan, dan catatannya.
    // null selama status masih 'pending' (belum pernah direview).
    reviewedBy: r.reviewedBy ?? null,
    reviewedAt: r.reviewedAt ?? null,
    adminNote: r.adminNote ?? null,
    replacementDeducted: r.category === 'ingredient' ? r.replacementDeducted : undefined,
    // BARU -- detail penggantian stok (C4), hanya relevan utk category:
    // ingredient yang sudah replacementDeducted: true.
    replacementQuantity: r.category === 'ingredient' ? (r.replacementQuantity ?? null) : undefined,
    replacementCost: r.category === 'ingredient' ? (r.replacementCost ?? null) : undefined,
    replacementBatches: r.category === 'ingredient' ? (r.replacementBatches ?? []) : undefined,
    varianceNote: r.category === 'ingredient' ? (r.varianceNote ?? null) : undefined,
    replacedAt: r.category === 'ingredient' ? (r.replacedAt ?? null) : undefined,
    replacedBy: r.category === 'ingredient' ? (r.replacedBy ?? null) : undefined,
    valuation: r.valuation,
    createdAt: r.createdAt,
  }));
}

// --- C3: ACC/tolak laporan --------------------------------------------------

async function reviewReport(reportId, { decision, adminNote, reviewedBy }) {
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const report = await PlanReport.findById(reportId).session(session);
      if (!report) {
        throw new ApiError(404, 'Laporan tidak ditemukan');
      }
      if (report.status !== 'pending') {
        throw new ApiError(400, 'Laporan ini sudah pernah direview', [
          { field: 'status', message: `Status saat ini: ${report.status}` },
        ]);
      }

      const now = new Date();
      report.status = decision;
      report.reviewedBy = reviewedBy;
      report.reviewedAt = now;
      report.adminNote = adminNote ?? null;

      // Tidak ada penghitungan ulang valuation di sini -- dibekukan sejak C1.
      await report.save({ session });

      if (decision === 'approved') {
        if (report.category === 'menu') {
          await applyApprovedMenuLoss(
            { planId: report.planId, refId: report.refId, quantityLost: report.quantityLost },
            session
          );
        } else {
          await applyApprovedIngredientLoss({ planId: report.planId }, session);
        }
      }
      // decision: rejected -> tidak ada efek lanjutan ke Plan.

      updated = report;
    });
    return updated;
  } finally {
    session.endSession();
  }
}

// --- C4: Tarik stok pengganti akibat rugi -----------------------------

async function addInventoryReplacement(
  reportId,
  { replacementQuantity, availableUntil, varianceNote, replacedBy }
) {
  const report = await PlanReport.findOne({
    _id: reportId,
    status: 'approved',
    category: 'ingredient',
    replacementDeducted: false,
  });
  if (!report) {
    throw new ApiError(404, 'Laporan tidak ditemukan atau tidak siap untuk penggantian stok');
  }

  const plan = await ProductionPlan.findById(report.planId);
  if (!plan || plan.status !== 'active') {
    throw new ApiError(409, 'Penggantian stok hanya berlaku selama plan masih aktif', [
      {
        field: 'planId',
        message: `Status plan saat ini: ${plan ? plan.status : 'tidak ditemukan'}`,
      },
    ]);
  }

  const finalQuantity = replacementQuantity ?? report.quantityLost;

  // reference dibuat unik per laporan supaya reverseDeduct() (kompensasi
  // di bawah) hanya menyentuh usage yang benar-benar milik laporan ini.
  const reference = `planReport:${report._id}`;

  // deduct() punya transaction sendiri (saga pattern, lihat catatan
  // report.flow.md) -- titik ini SUDAH COMMIT begitu resolve, tidak bisa
  // digabung transaction dengan update PlanReport di bawah.
  const deductResult = await inventoryService.deduct({
    items: [{ inventoryId: report.refId, amountNeeded: finalQuantity }],
    availableUntil,
    reference,
  });

  const itemResult = deductResult.items[0];
  const replacementCost = itemResult.batches.reduce(
    (sum, b) => sum + b.quantityUsed * b.costPriceUsed,
    0
  );

  try {
    report.replacementQuantity = finalQuantity;
    report.varianceNote = varianceNote ?? null;
    report.replacementDeducted = true;
    report.replacementBatches = itemResult.batches;
    report.replacementCost = replacementCost;
    report.replacedAt = new Date();
    report.replacedBy = replacedBy;
    await report.save();
  } catch (err) {
    // Kompensasi: stok sudah terlanjur ditarik (deduct() sudah commit),
    // tapi laporan gagal disimpan -- kembalikan stok supaya tidak orphan.
    await inventoryService.reverseDeduct({ reference });
    throw err;
  }

  // D-PR4: WAJIB re-check, bukan asumsi -- baru set false kalau tidak ada
  // laporan ingredient/approved/replacementDeducted:false LAIN di plan ini.
  const stillPending = await PlanReport.exists({
    planId: report.planId,
    category: 'ingredient',
    status: 'approved',
    replacementDeducted: false,
  });
  if (!stillPending) {
    await ProductionPlan.updateOne(
      { _id: report.planId },
      { $set: { hasPendingLossReplacement: false } }
    );
  }

  return {
    reportId: report._id,
    replacementBatches: report.replacementBatches,
    replacementCost: report.replacementCost,
  };
}

module.exports = {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
};
