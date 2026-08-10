const ProductionPlan = require('../models/plan/productionPlan.model');
const ApiError = require('../utils/ApiError');
const {
  computePricing,
  computeRemainingQuantity,
  computeIngredientsDetail,
  computeMenuCost,
  computeInventorySafetyStatus,
  computeSuggestion,
} = require('../utils/planCompute');

// ---------------------------------------------------------------------------
// ASUMSI INTERFACE MODUL LAIN — tolong dikonfirmasi/disesuaikan dengan
// implementasi asli menuService & inventoryService di project ini.
//
// menuService.getMenusByIds(menuIds: ObjectId[]) => Promise<Array<{
//   _id, name, status ('active'|'deleted'), sellingPrice,
//   ingredients: [{ inventoryId, nameInventory, quantityNeeded /* per porsi */,
//                    currentCostPerUnit, subtotalCost /* per porsi */ }],
//   currentCostEstimate, costComplete, warning
// }>>
//
// inventoryService.checkAvailability({ items: [{inventoryId, amountNeeded}], availableUntil })
//   => Promise<{ results: [{ inventoryId, nameInventory, amountNeeded, sufficient,
//                shortfall, hasUnsafeBatch, batches }], overallSufficient, overallHasUnsafeBatch }>
//   Catatan: TIDAK ada field `availableQuantity` terpisah — draft plan murni
//   simulasi lewat `sufficient`/`shortfall`; tidak ada reservasi stok apapun
//   sampai admin panggil endpoint approve (A6). `batches` (bukan
//   `eligibleBatches`) adalah hasil FEFO plan dari `planFefoDeduction`,
//   berisi `subInventoryId` per batch — inilah yang dipakai propagateStale
//   untuk match `batch_removed`.>
//   (endpoint 11, dry-run, dipanggil paralel per inventoryId teragregasi)
//
// inventoryService.deduct({ planId, inventoryId, quantityNeeded, availableUntil }, session)
//   => Promise<{ inventoryId, nameInventory, quantityNeeded,
//                batches: [{ subInventoryId, quantityUsed, costPriceUsed, batchSafetyStatus }] }>
//   throws ApiError(409, ...) kalau stok tidak lagi cukup (dipanggil di dalam transaction)
// ---------------------------------------------------------------------------
const menuService = require('../services/menu.service');
const inventoryService = require('../services/inventory.service');

const BLOCKING_STALE_REASONS = ['recipe_changed', 'menu_archived'];

// --- Helpers internal ------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getPlanOrThrow(id) {
  const plan = await ProductionPlan.findById(id);
  if (!plan) throw new ApiError(404, 'Plan tidak ditemukan');
  return plan;
}

/**
 * Lazy-check status `completed` — dijalankan di titik akses (A2/A3), bukan cron.
 * Mutasi plan in-place kalau perlu, TIDAK menyimpan (caller yang save, supaya
 * bisa digabung dengan operasi lain dalam 1 write kalau perlu).
 */
function applyLazyCompleteCheck(plan) {
  if (plan.status === 'active' && plan.endDate < new Date()) {
    plan.status = 'completed';
    plan.completedAt = new Date();
    return true;
  }
  return false;
}

/**
 * Validasi semua menuId merujuk Menu berstatus active. Dipakai di create,
 * edit, DAN sebagai defense-in-depth kedua di approve (RFC v3 §5 langkah 5).
 */
function assertMenusActive(menuDocs, requestedMenuIds) {
  const missingOrInactive = [];

  requestedMenuIds.forEach((id, idx) => {
    const doc = menuDocs.find((m) => String(m._id) === String(id));
    if (!doc || doc.status !== 'active') {
      missingOrInactive.push({ index: idx, menuId: id });
    }
  });

  if (missingOrInactive.length > 0) {
    throw new ApiError(
      400,
      'Validation error: ada menuId yang tidak ditemukan atau sudah diarsipkan',
      missingOrInactive.map((m) => ({
        field: `menus[${m.index}].menuId`,
        message: 'Menu tidak ditemukan atau berstatus deleted',
      }))
    );
  }
}

/**
 * Agregasi kebutuhan bahan LINTAS MENU — jumlahkan inventoryId yang sama
 * antar menu berbeda. Ini yang jadi basis checkResult (bukan per-menu).
 */
function aggregateIngredientNeeds(menuInputs, menuDocsById) {
  const needsByInventoryId = new Map();

  menuInputs.forEach(({ menuId, quantityPlanned }) => {
    const menuDoc = menuDocsById.get(String(menuId));
    (menuDoc.ingredients || []).forEach((ing) => {
      const key = String(ing.inventoryId);
      const quantityForThisMenu = ing.quantityNeeded * quantityPlanned;
      const existing = needsByInventoryId.get(key);
      if (existing) {
        existing.quantityNeeded += quantityForThisMenu;
      } else {
        needsByInventoryId.set(key, {
          inventoryId: ing.inventoryId,
          nameInventory: ing.nameInventory,
          quantityNeeded: quantityForThisMenu,
        });
      }
    });
  });

  return Array.from(needsByInventoryId.values());
}

/**
 * Jalankan check-availability (Inventory endpoint 11) paralel per inventoryId
 * teragregasi. Mengembalikan { checkResult, readyToApprove }.
 */
async function runAvailabilityCheck(aggregatedNeeds, availableUntil) {
  const { results, overallSufficient } = await inventoryService.checkAvailability({
    items: aggregatedNeeds.map((need) => ({
      inventoryId: need.inventoryId,
      amountNeeded: need.quantityNeeded, // input ke inventoryService tetap amountNeeded
    })),
    availableUntil,
  });

  return { checkResult: results, readyToApprove: overallSufficient };
}

async function assertOnlyOneActivePlan(excludePlanId) {
  const query = { status: 'active' };
  if (excludePlanId) query._id = { $ne: excludePlanId };

  const activePlan = await ProductionPlan.findOne(query).select('_id');
  if (activePlan) {
    throw new ApiError(
      409,
      'Masih ada plan lain yang sedang aktif, selesaikan atau hentikan plan tersebut dulu',
      [{ field: 'status', message: 'Hanya boleh 1 plan berstatus active pada satu waktu' }]
    );
  }
}

/**
 * A4 (perubahan durasi/startDate): tolak kalau slot diskon existing jadi
 * keluar dari rentang plan baru.
 */
function assertDiscountsWithinNewRange(plan, newEndDate) {
  const violations = plan.menus
    .filter((m) => m.discount && m.discount.endDate > newEndDate)
    .map((m) => ({
      field: 'duration',
      message: `Diskon ${m.menuId} (${m.discount.startDate.toISOString().slice(0, 10)} s/d ${m.discount.endDate
        .toISOString()
        .slice(0, 10)}) melebihi endDate baru ${newEndDate.toISOString().slice(0, 10)}`,
    }));

  if (violations.length > 0) {
    throw new ApiError(
      409,
      `Perubahan durasi plan membuat slot diskon ${plan.menus.find((m) => m.discount)?.menuId} berada di luar rentang plan baru, hapus atau sesuaikan diskon tersebut dulu`,
      violations
    );
  }
}

// --- A1: Create plan ---------------------------------------------------

async function createPlan(payload) {
  const menuIds = payload.menus.map((m) => m.menuId);
  const menuDocs = await menuService.getMenusByIds(menuIds);
  assertMenusActive(menuDocs, menuIds);

  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));

  const endDate = new Date(payload.startDate);
  endDate.setDate(endDate.getDate() + payload.duration);

  const aggregatedNeeds = aggregateIngredientNeeds(payload.menus, menuDocsById);
  const { checkResult, readyToApprove } = await runAvailabilityCheck(aggregatedNeeds, endDate);

  const plan = await ProductionPlan.create({
    name: payload.name,
    tags: payload.tags || [],
    startDate: payload.startDate,
    duration: payload.duration,
    endDate,
    status: 'draft',
    menus: payload.menus.map((m) => ({
      menuId: m.menuId,
      quantityPlanned: m.quantityPlanned,
      soldQuantity: 0,
      lossQuantity: 0,
      soldOutAt: null,
      frozenSellingPrice: null,
      frozenMenuName: null,
      discount: null,
    })),
    checkResult,
    checkResultStale: false,
    staleReason: null,
    readyToApprove,
    hasPendingLossReplacement: false,
  });

  return toSummaryResponse(plan, menuDocsById);
}

// --- A2: List plans ------------------------------------------------------

async function listPlans({ status, search, tags, page = 1, limit = 10 }) {
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };
  if (tags) filter.tags = { $in: tags.split(',').map((t) => t.trim()) };

  const skip = (page - 1) * limit;
  const [items, totalData] = await Promise.all([
    ProductionPlan.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProductionPlan.countDocuments(filter),
  ]);

  const data = items.map((plan) => {
    const hasActiveDiscount = plan.menus.some(
      (m) => m.discount && new Date() >= m.discount.startDate && new Date() <= m.discount.endDate
    );
    const hasUnsafeBatch = computeInventorySafetyStatus(plan.checkResult) === 'unsafe';

    return {
      _id: plan._id,
      name: plan.name,
      tags: plan.tags,
      status: plan.status,
      startDate: plan.startDate,
      endDate: plan.endDate,
      totalMenu: plan.menus.length,
      readyToApprove: plan.readyToApprove,
      hasPendingLossReplacement: plan.hasPendingLossReplacement,
      hasActiveDiscount,
      hasUnsafeBatch,
    };
  });

  return {
    data,
    pagination: {
      totalData,
      totalPage: Math.ceil(totalData / limit),
      currentPage: page,
      limit,
    },
  };
}

// --- A3: Get plan detail (dengan breakdown per-menu, RFC v3) ------------

async function getPlanById(id) {
  const plan = await getPlanOrThrow(id);

  const wasMutated = applyLazyCompleteCheck(plan);
  if (wasMutated) await plan.save();

  const menuIds = plan.menus.map((m) => m.menuId);
  const menuDocs = await menuService.getMenusByIds(menuIds);
  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));

  return toDetailedResponse(plan, menuDocsById);
}

// --- A4: Update plan (hanya saat draft) ---------------------------------

async function updatePlan(id, payload) {
  const plan = await getPlanOrThrow(id);
  if (plan.status !== 'draft') {
    throw new ApiError(400, 'Plan hanya bisa diedit selagi berstatus draft', [
      { field: 'status', message: `Status saat ini: ${plan.status}` },
    ]);
  }

  const nextStartDate = payload.startDate || plan.startDate;
  const nextDuration = payload.duration || plan.duration;
  const nextEndDate = new Date(nextStartDate);
  nextEndDate.setDate(nextEndDate.getDate() + nextDuration);

  if (payload.startDate || payload.duration) {
    assertDiscountsWithinNewRange(plan, nextEndDate);
  }

  const nextMenuInputs = payload.menus
    ? payload.menus
    : plan.menus.map((m) => ({ menuId: m.menuId, quantityPlanned: m.quantityPlanned }));

  const menuIds = nextMenuInputs.map((m) => m.menuId);
  const menuDocs = await menuService.getMenusByIds(menuIds);
  assertMenusActive(menuDocs, menuIds);
  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));

  const aggregatedNeeds = aggregateIngredientNeeds(nextMenuInputs, menuDocsById);
  const { checkResult, readyToApprove } = await runAvailabilityCheck(aggregatedNeeds, nextEndDate);

  plan.name = payload.name ?? plan.name;
  plan.tags = payload.tags ?? plan.tags;
  plan.startDate = nextStartDate;
  plan.duration = nextDuration;
  plan.endDate = nextEndDate;

  if (payload.menus) {
    // Pertahankan progres (soldQuantity/lossQuantity/discount) untuk menuId
    // yang masih ada; menu baru mulai dari nol. Karena A4 hanya boleh saat
    // draft, soldQuantity/lossQuantity di titik ini seharusnya masih 0 —
    // tetap dipertahankan by-id untuk aman kalau ada kasus tepi.
    const prevByMenuId = new Map(plan.menus.map((m) => [String(m.menuId), m]));
    plan.menus = payload.menus.map((m) => {
      const prev = prevByMenuId.get(String(m.menuId));
      return {
        menuId: m.menuId,
        quantityPlanned: m.quantityPlanned,
        soldQuantity: prev ? prev.soldQuantity : 0,
        lossQuantity: prev ? prev.lossQuantity : 0,
        soldOutAt: prev ? prev.soldOutAt : null,
        frozenSellingPrice: null,
        frozenMenuName: null,
        discount: prev ? prev.discount : null,
      };
    });
  }

  // Edit dianggap bentuk refresh implisit.
  plan.checkResult = checkResult;
  plan.checkResultStale = false;
  plan.staleReason = null;
  plan.readyToApprove = readyToApprove;

  await plan.save();
  return toSummaryResponse(plan, menuDocsById);
}

// --- A5: Refresh check-availability --------------------------------------

async function refreshAvailability(id) {
  const plan = await getPlanOrThrow(id);
  if (plan.status !== 'draft') {
    throw new ApiError(400, 'Refresh simulasi hanya bisa dilakukan selagi plan berstatus draft', [
      { field: 'status', message: `Status saat ini: ${plan.status}` },
    ]);
  }

  const menuIds = plan.menus.map((m) => m.menuId);
  const menuDocs = await menuService.getMenusByIds(menuIds);
  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));

  const menuInputs = plan.menus.map((m) => ({
    menuId: m.menuId,
    quantityPlanned: m.quantityPlanned,
  }));
  const aggregatedNeeds = aggregateIngredientNeeds(menuInputs, menuDocsById);
  const { checkResult, readyToApprove } = await runAvailabilityCheck(aggregatedNeeds, plan.endDate);

  plan.checkResult = checkResult;
  plan.checkResultStale = false;
  plan.staleReason = null;
  plan.readyToApprove = readyToApprove;
  await plan.save();

  return {
    readyToApprove: plan.readyToApprove,
    checkResultStale: plan.checkResultStale,
    staleReason: plan.staleReason,
    checkResult: plan.checkResult,
  };
}

// --- A6: Approve plan ------------------------------------------------------

async function approvePlan(id, actor) {
  const plan = await getPlanOrThrow(id);
  if (plan.status !== 'draft') {
    throw new ApiError(404, 'Plan tidak ditemukan atau bukan draft');
  }

  await assertOnlyOneActivePlan(plan._id);

  // Langkah 3 (RFC v3 §5): staleReason blocking → tolak sebelum apapun lain.
  if (plan.checkResultStale && BLOCKING_STALE_REASONS.includes(plan.staleReason)) {
    const messages = {
      recipe_changed:
        'Resep salah satu menu berubah sejak simulasi terakhir, wajib refresh check-availability sebelum approve',
      menu_archived:
        'Salah satu menu di plan ini sudah diarsipkan, wajib refresh check-availability sebelum approve',
    };
    throw new ApiError(400, messages[plan.staleReason], [
      { field: 'staleReason', message: `staleReason: ${plan.staleReason}` },
    ]);
  }

  if (!plan.readyToApprove) {
    throw new ApiError(400, 'Plan belum siap disetujui — kebutuhan bahan belum tercukupi', [
      { field: 'readyToApprove', message: 'readyToApprove: false' },
    ]);
  }

  // Langkah 5 (RFC v3, defense-in-depth): validasi ulang Menu.status
  // langsung — independen dari staleReason (jaga-jaga propagasi gagal).
  const menuIds = plan.menus.map((m) => m.menuId);
  const menuDocs = await menuService.getMenusByIds(menuIds);
  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));
  const inactiveMenu = plan.menus.find((m) => {
    const doc = menuDocsById.get(String(m.menuId));
    return !doc || doc.status !== 'active';
  });
  if (inactiveMenu) {
    throw new ApiError(
      400,
      'Salah satu menu di plan ini sudah diarsipkan, wajib refresh check-availability sebelum approve',
      [{ field: 'staleReason', message: 'staleReason: menu_archived' }]
    );
  }

  const menuInputs = plan.menus.map((m) => ({
    menuId: m.menuId,
    quantityPlanned: m.quantityPlanned,
  }));
  const aggregatedNeeds = aggregateIngredientNeeds(menuInputs, menuDocsById);

  const reference = String(plan._id);

  // Step 1 — deduct semua bahan sekaligus (1 transaction di dalam deduct()
  // sendiri). Kalau gagal, semua bahan di batch ini otomatis rollback.
  let deductResult;
  try {
    deductResult = await inventoryService.deduct({
      items: aggregatedNeeds.map((need) => ({
        inventoryId: need.inventoryId,
        amountNeeded: need.quantityNeeded,
      })),
      availableUntil: plan.endDate,
      reference,
    });
  } catch (deductError) {
    // Refresh checkResult di luar transaction supaya admin lihat kondisi
    // terbaru. Ini juga bentuk refresh implisit (sama seperti A4/A5) —
    // checkResultStale/staleReason WAJIB direset, bukan cuma checkResult-nya,
    // supaya admin gak lihat warning stale yang sudah gak relevan.
    const { checkResult, readyToApprove } = await runAvailabilityCheck(
      aggregatedNeeds,
      plan.endDate
    );
    plan.checkResult = checkResult;
    plan.checkResultStale = false;
    plan.staleReason = null;
    plan.readyToApprove = readyToApprove;
    await plan.save();

    throw new ApiError(
      409,
      'Ketersediaan stok berubah sejak simulasi terakhir, silakan check-availability ulang',
      [{ field: 'checkResult', message: '1 atau lebih inventoryId tidak lagi mencukupi' }]
    );
  }

  // Step 2 — commit plan jadi active. deductResult.items sudah persis bentuk
  // committedIngredientSchema — tinggal pass-through.
  try {
    plan.committedIngredients = deductResult.items;

    plan.menus = plan.menus.map((m) => {
      const menuDoc = menuDocsById.get(String(m.menuId));
      return {
        ...m.toObject(),
        frozenSellingPrice: menuDoc.sellingPrice,
        frozenMenuName: menuDoc.name,
      };
    });

    plan.status = 'active';
    plan.approvedAt = new Date();
    plan.approvedBy = actor?.name || actor?.id || 'system';

    await plan.save();
  } catch (saveError) {
    // Stok SUDAH terlanjur kepotong di Step 1 — wajib dikembalikan, bukan
    // dibiarkan nyangkut. Kalau reverseDeduct sendiri gagal, itu kondisi
    // paling parah (stok terpotong permanen + plan gagal jadi active +
    // kompensasi gagal) — WAJIB ke-log eksplisit, bukan ketelan diam-diam,
    // dan error asli (saveError) tetap yang dilempar ke caller.
    try {
      await inventoryService.reverseDeduct({ reference });
    } catch (reverseError) {
      console.error('CRITICAL: reverseDeduct gagal setelah plan.save() gagal — perlu manual fix', {
        planId: plan._id,
        reference,
        saveError: saveError?.message || saveError,
        reverseError: reverseError?.message || reverseError,
      });
    }
    throw saveError;
  }

  // Tandai draft LAIN yang memakai inventoryId sama sebagai stale (stock_taken).
  // Di luar transaction approve, sesuai pola "flag murah, bukan cascade" —
  // kegagalan di sini fail-open, bukan alasan approve dibatalkan.
  const affectedInventoryIds = aggregatedNeeds.map((n) => n.inventoryId);
  await ProductionPlan.updateMany(
    {
      _id: { $ne: plan._id },
      status: 'draft',
      'checkResult.inventoryId': { $in: affectedInventoryIds },
    },
    { $set: { checkResultStale: true, staleReason: 'stock_taken' } }
  );

  return { _id: plan._id, status: plan.status, approvedAt: plan.approvedAt };
}

// --- A7: Stop plan ---------------------------------------------------------

async function stopPlan(id, { reason, stoppedBy }) {
  const plan = await getPlanOrThrow(id);
  if (plan.status !== 'active') {
    throw new ApiError(400, 'Hanya plan berstatus active yang bisa dihentikan', [
      { field: 'status', message: `Status saat ini: ${plan.status}` },
    ]);
  }

  plan.status = 'stopped';
  plan.stoppedAt = new Date();
  plan.stoppedBy = stoppedBy;
  plan.stopReason = reason;
  await plan.save();

  // TODO: generate PlanFinalReport (reason: "stopped") — di luar scope
  // modul Production Plan, lihat dokumentasi Plan Report.

  return {
    _id: plan._id,
    status: plan.status,
    stoppedAt: plan.stoppedAt,
    stoppedBy: plan.stoppedBy,
    stopReason: plan.stopReason,
  };
}

// --- A8: Cancel draft --------------------------------------------------

async function cancelPlan(id) {
  const plan = await getPlanOrThrow(id);
  if (plan.status !== 'draft') {
    throw new ApiError(400, 'Hanya plan berstatus draft yang bisa dibatalkan', [
      {
        field: 'status',
        message: `Status saat ini: ${plan.status}${
          plan.status === 'active' ? ' — hentikan lewat endpoint stop, bukan dibatalkan' : ''
        }`,
      },
    ]);
  }

  plan.status = 'cancelled';
  plan.cancelledAt = new Date();
  await plan.save();

  return { _id: plan._id, status: plan.status, cancelledAt: plan.cancelledAt };
}

// --- A9: Set/replace discount ------------------------------------------

async function setDiscount(id, menuId, payload, actor) {
  const plan = await getPlanOrThrow(id);
  if (!['draft', 'active'].includes(plan.status)) {
    throw new ApiError(400, 'Diskon hanya bisa diset selagi plan draft atau active', [
      { field: 'status', message: `Status saat ini: ${plan.status}` },
    ]);
  }

  const planMenu = plan.menus.find((m) => String(m.menuId) === String(menuId));
  if (!planMenu) {
    throw new ApiError(400, 'Menu ini tidak ada di plan', [
      { field: 'menuId', message: 'menuId tidak ditemukan di plan.menus' },
    ]);
  }

  const now = new Date();
  if (payload.discountPercentage < 1 || payload.discountPercentage > 100) {
    throw new ApiError(400, 'discountPercentage harus di antara 1-100');
  }
  if (payload.startDate < now.setHours(0, 0, 0, 0)) {
    throw new ApiError(400, 'startDate diskon tidak boleh sebelum hari ini');
  }
  if (payload.startDate < plan.startDate) {
    throw new ApiError(400, 'startDate diskon tidak boleh sebelum startDate plan');
  }
  if (payload.endDate > plan.endDate) {
    throw new ApiError(400, 'endDate diskon tidak boleh melebihi endDate plan');
  }

  planMenu.discount = {
    discountPercentage: payload.discountPercentage,
    startDate: payload.startDate,
    endDate: payload.endDate,
    reason: payload.reason || '',
    setBy: actor?.name || actor?.id || 'system',
    setAt: new Date(),
  };

  await plan.save();

  const menuDocs = await menuService.getMenusByIds([menuId]);
  const menuDoc = menuDocs[0];
  const { effectiveSellingPrice, discountedPrice, discountStatus } = computePricing(
    planMenu,
    menuDoc,
    plan.status
  );

  return {
    menuId,
    effectiveSellingPrice,
    discount: { ...planMenu.discount.toObject(), discountedPrice, discountStatus },
  };
}

// --- A10: Remove discount ------------------------------------------------

async function removeDiscount(id, menuId) {
  const plan = await getPlanOrThrow(id);
  const planMenu = plan.menus.find((m) => String(m.menuId) === String(menuId));
  if (!planMenu) {
    throw new ApiError(400, 'Menu ini tidak ada di plan', [
      { field: 'menuId', message: 'menuId tidak ditemukan di plan.menus' },
    ]);
  }
  if (!planMenu.discount) {
    throw new ApiError(404, 'Menu ini tidak memiliki diskon aktif untuk dihapus', [
      { field: 'menuId', message: 'discount: null' },
    ]);
  }

  planMenu.discount = null;
  await plan.save();

  return { menuId, discount: null };
}

// --- Response formatters -------------------------------------------------

/**
 * Dipakai A1/A2/A4 — TIDAK menghitung ingredientsDetail (RFC v3 §4.5: hanya
 * A3 yang butuh breakdown per-menu, supaya create/edit tetap ringan).
 */
function toSummaryResponse(plan, menuDocsById) {
  const menus = plan.menus.map((m) => {
    const menuDoc = menuDocsById.get(String(m.menuId));
    const pricing = computePricing(m, menuDoc, plan.status);
    return {
      menuId: m.menuId,
      name: menuDoc ? menuDoc.name : null,
      quantityPlanned: m.quantityPlanned,
      soldQuantity: m.soldQuantity,
      lossQuantity: m.lossQuantity,
      soldOutAt: m.soldOutAt,
      frozenSellingPrice: m.frozenSellingPrice,
      ...pricing,
      discount: m.discount || null,
    };
  });

  return {
    _id: plan._id,
    name: plan.name,
    tags: plan.tags,
    status: plan.status,
    startDate: plan.startDate,
    duration: plan.duration,
    endDate: plan.endDate,
    menus,
    checkResult: plan.checkResult,
    checkResultStale: plan.checkResultStale,
    staleReason: plan.staleReason,
    readyToApprove: plan.readyToApprove,
    hasPendingLossReplacement: plan.hasPendingLossReplacement,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

/**
 * Dipakai A3 — full detail termasuk ingredientsDetail per menu, cost,
 * suggestion (RFC v3). ingredientsDetail/cost hanya relevan selagi draft;
 * untuk active/completed/stopped, committedIngredients yang jadi acuan.
 */
function toDetailedResponse(plan, menuDocsById) {
  const inventorySafetyStatus = computeInventorySafetyStatus(plan.checkResult);

  const menus = plan.menus.map((m) => {
    const menuDoc = menuDocsById.get(String(m.menuId));
    const pricing = computePricing(m, menuDoc, plan.status);

    const base = {
      menuId: m.menuId,
      name: menuDoc ? menuDoc.name : null,
      quantityPlanned: m.quantityPlanned,
      soldQuantity: m.soldQuantity,
      lossQuantity: m.lossQuantity,
      soldOutAt: m.soldOutAt,
      remainingQuantity:
        plan.status !== 'draft'
          ? computeRemainingQuantity(m, 0 /* TODO: dari Plan Report */)
          : undefined,
      frozenSellingPrice: m.frozenSellingPrice,
      ...pricing,
      discount: m.discount
        ? {
            ...m.discount.toObject(),
            discountedPrice: pricing.discountedPrice,
            discountStatus: pricing.discountStatus,
          }
        : null,
    };

    if (plan.status === 'draft' && menuDoc) {
      const { ingredientsDetail, lowStock } = computeIngredientsDetail({
        planMenu: m,
        menuDoc,
        checkResult: plan.checkResult,
      });
      const costInfo = computeMenuCost({
        planMenu: m,
        menuDoc,
        effectiveSellingPrice: pricing.effectiveSellingPrice,
      });
      return { ...base, lowStock, ...costInfo, ingredientsDetail };
    }

    return base;
  });

  const suggestion = computeSuggestion({
    staleReason: plan.staleReason,
    inventorySafetyStatus,
    readyToApprove: plan.readyToApprove,
  });

  const response = {
    _id: plan._id,
    name: plan.name,
    tags: plan.tags,
    status: plan.status,
    startDate: plan.startDate,
    duration: plan.duration,
    endDate: plan.endDate,
    inventorySafetyStatus,
    suggestion,
    checkResultStale: plan.checkResultStale,
    staleReason: plan.staleReason,
    readyToApprove: plan.readyToApprove,
    hasPendingLossReplacement: plan.hasPendingLossReplacement,
    menus,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };

  if (plan.status === 'draft') {
    response.checkResult = plan.checkResult;
  } else {
    response.committedIngredients = plan.committedIngredients;
    response.approvedAt = plan.approvedAt;
    response.approvedBy = plan.approvedBy;
    if (plan.status === 'stopped') {
      response.stoppedAt = plan.stoppedAt;
      response.stoppedBy = plan.stoppedBy;
      response.stopReason = plan.stopReason;
    }
    if (plan.status === 'completed') {
      response.completedAt = plan.completedAt;
    }
  }

  if (plan.hasPendingLossReplacement) {
    response.warning = 'Ada laporan kerugian bahan yang sudah disetujui tapi belum diganti stoknya';
  } else if (plan.checkResultStale) {
    const warnings = {
      stock_taken:
        'Stok bahan berkurang sejak simulasi terakhir. Disarankan refresh check-availability.',
      batch_removed:
        'Salah satu batch bahan yang disimulasikan sudah dihapus. Disarankan refresh check-availability.',
      inventory_archived:
        'Salah satu bahan yang dipakai draft ini sudah diarsipkan. Disarankan refresh check-availability.',
      recipe_changed:
        'Resep salah satu menu di plan ini berubah sejak simulasi terakhir. Refresh check-availability wajib dilakukan sebelum approve.',
      menu_archived:
        'Salah satu menu di plan ini sudah diarsipkan sejak simulasi terakhir. Refresh check-availability wajib dilakukan sebelum approve.',
    };
    response.warning = warnings[plan.staleReason];
  }

  return response;
}

module.exports = {
  createPlan,
  listPlans,
  getPlanById,
  updatePlan,
  refreshAvailability,
  approvePlan,
  stopPlan,
  cancelPlan,
  setDiscount,
  removeDiscount,
};
