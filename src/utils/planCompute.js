// utils/planCompute.js
//
// Semua fungsi di sini murni compute-at-access-time (RFC v3 §4.2) — tidak
// ada yang menyentuh DB atau disimpan. Dipanggil dari productionPlan.service.js
// di toSummaryResponse (A1/A2/A4) dan toDetailedResponse (A3).

/**
 * §2 & §7 — harga efektif menu di dalam sebuah plan, plus status diskon.
 *
 * - draft  -> pakai harga LIVE dari Menu (belum dibekukan)
 * - selain draft (active/completed/stopped) -> pakai frozenSellingPrice
 *   (dibekukan saat approve, PRD §5 langkah 7)
 *
 * discountedPrice dihitung dari effectiveSellingPrice (bukan selalu live
 * Menu.sellingPrice) — sesuai PRD §7 poin terakhir.
 */
function computePricing(planMenu, menuDoc, planStatus) {
  const effectiveSellingPrice =
    planStatus === 'draft'
      ? (menuDoc?.sellingPrice ?? null)
      : (planMenu.frozenSellingPrice ?? null);

  const discount = planMenu.discount;
  if (!discount) {
    return { effectiveSellingPrice, discountedPrice: null, discountStatus: null };
  }

  const now = new Date();
  let discountStatus;
  if (now < new Date(discount.startDate)) {
    discountStatus = 'scheduled';
  } else if (now > new Date(discount.endDate)) {
    discountStatus = 'expired';
  } else {
    discountStatus = 'active';
  }

  const discountedPrice =
    effectiveSellingPrice != null
      ? Math.round(effectiveSellingPrice * (1 - discount.discountPercentage / 100))
      : null;

  return { effectiveSellingPrice, discountedPrice, discountStatus };
}

/**
 * remainingQuantity = quantityPlanned − soldQuantity − lossQuantity + replacedQuantity.
 * `replacedQuantity` sengaja jadi parameter (bukan diambil dari sini) karena
 * sumbernya Plan Report — modul yang belum ada (lihat TODO di
 * toDetailedResponse, caller pass 0 untuk sementara).
 */
function computeRemainingQuantity(planMenu, replacedQuantity = 0) {
  return Math.max(
    0,
    planMenu.quantityPlanned - planMenu.soldQuantity - planMenu.lossQuantity + replacedQuantity
  );
}

/**
 * §4.1/§4.2 — breakdown per-menu, HANYA dipakai di A3 (toDetailedResponse).
 * `checkResult` di sini WAJIB checkResult AGREGAT (hasil runAvailabilityCheck
 * yang sudah dikirim ke inventoryService.checkAvailability dengan `items`
 * gabungan semua menu) — tidak dihitung ulang per menu secara independen.
 *
 * shortfall/hasUnsafeBatch untuk inventoryId yang sama akan IDENTIK di semua
 * kartu menu yang memakainya (poolShared: true) — ini disengaja, bukan bug,
 * lihat PRD §4.1.
 */
function computeIngredientsDetail({ planMenu, menuDoc, checkResult }) {
  const checkResultByInventoryId = new Map(
    (checkResult || []).map((entry) => [String(entry.inventoryId), entry])
  );

  const ingredientsDetail = (menuDoc?.ingredients || []).map((ing) => {
    const entry = checkResultByInventoryId.get(String(ing.inventoryId));
    const quantityNeeded = ing.quantityNeeded * planMenu.quantityPlanned;

    // eligibleBatches (bukan batches), field expired sesuai eligibleBatchSchema
    const nearestExpiry = entry?.eligibleBatches?.length
      ? entry.eligibleBatches.reduce((min, b) => {
          if (!b.expired) return min;
          const t = new Date(b.expired).getTime();
          return min === null || t < min ? t : min;
        }, null)
      : null;

    return {
      inventoryId: ing.inventoryId,
      nameInventory: ing.nameInventory,
      unit: ing.unit, // BARU
      quantityNeeded,
      // angka ASLI dari checkAvailability, bukan approksimasi
      availableQuantity: entry?.availableQuantity ?? null,
      shortfall: entry?.shortfall ?? 0,
      poolShared: true,
      nearestExpiry: nearestExpiry ? new Date(nearestExpiry) : null,
      hasUnsafeBatch: entry?.hasUnsafeBatch ?? false,
      unitCost: ing.currentCostPerUnit ?? null,
      costContribution:
        ing.currentCostPerUnit != null ? ing.subtotalCost * planMenu.quantityPlanned : null,
    };
  });

  const lowStock = ingredientsDetail.some((d) => d.shortfall > 0);

  return { ingredientsDetail, lowStock };
}

/**
 * §4.3 — cost level-menu, HARUS pass-through dari Menu.currentCostEstimate,
 * bukan dihitung ulang dari batch mentah (larangan eksplisit di RFC v3).
 * null (bukan 0) kalau costComplete: false — konsisten dengan cara Menu
 * sendiri melabeli cost yang tidak lengkap.
 */
function computeMenuCost({ planMenu, menuDoc, effectiveSellingPrice }) {
  const costComplete = menuDoc?.costComplete ?? false;
  const costPerPortion = costComplete ? menuDoc.currentCostEstimate : null;
  const estimatedProfit =
    costComplete && effectiveSellingPrice != null
      ? (effectiveSellingPrice - costPerPortion) * planMenu.quantityPlanned
      : null;

  return {
    costComplete,
    costPerPortion,
    estimatedProfit,
    costWarning: menuDoc?.warning || null,
  };
}

/**
 * §4.4 — "unsafe" kalau ADA MINIMAL SATU inventoryId di checkResult agregat
 * berstatus hasUnsafeBatch: true. Dipakai baik di listPlans (A2, ringkas)
 * maupun toDetailedResponse (A3).
 */
function computeInventorySafetyStatus(checkResult) {
  const hasUnsafe = (checkResult || []).some((entry) => entry.hasUnsafeBatch);
  return hasUnsafe ? 'unsafe' : 'safe';
}

/**
 * §4.4 — prioritas berurutan, stop di kondisi pertama match. Urutan ini
 * PENTING, jangan diacak: refresh_required > add_discount > review_stock >
 * ready_to_approve.
 */
function computeSuggestion({ staleReason, inventorySafetyStatus, readyToApprove }) {
  const BLOCKING_STALE_REASONS = ['recipe_changed', 'menu_archived'];

  if (BLOCKING_STALE_REASONS.includes(staleReason)) return 'refresh_required';
  if (inventorySafetyStatus === 'unsafe') return 'add_discount';
  if (!readyToApprove) return 'review_stock';
  return 'ready_to_approve';
}

function computeCommittedIngredientsDetail({ planMenu, committedIngredients }) {
  const committedByInventoryId = new Map(
    (committedIngredients || []).map((e) => [String(e.inventoryId), e])
  );

  const ingredientsDetail = (planMenu.frozenRecipe || []).map((recipeItem) => {
    const entry = committedByInventoryId.get(String(recipeItem.inventoryId));
    const quantityNeeded = recipeItem.quantityPerUnit * planMenu.quantityPlanned;
    const batches = entry?.batches || [];

    const totalOriginalQuantity = batches.reduce((sum, b) => sum + b.quantityUsed, 0);
    const totalOriginalCost = batches.reduce((sum, b) => sum + b.costPriceUsed, 0);
    const unitCost = totalOriginalQuantity > 0 ? totalOriginalCost / totalOriginalQuantity : null;

    const remainingBatches = batches.filter((b) => b.quantityRemaining > 0);
    const quantityAvailable = remainingBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
    const nearestExpiry = remainingBatches.length
      ? remainingBatches.reduce((min, b) => {
          if (!b.expired) return min;
          const t = new Date(b.expired).getTime();
          return min === null || t < min ? t : min;
        }, null)
      : null;

    return {
      inventoryId: recipeItem.inventoryId,
      nameInventory: recipeItem.nameInventory,
      unit: recipeItem.unit, // BARU
      quantityNeeded,
      quantityAvailable,
      poolShared: true,
      nearestExpiry: nearestExpiry ? new Date(nearestExpiry) : null,
      hasUnsafeBatch: remainingBatches.some((b) => b.batchSafetyStatus === 'unsafe'),
      unitCost,
      costContribution: unitCost != null ? quantityNeeded * unitCost : null,
    };
  });

  // FIX -- array kosong artinya frozenRecipe belum ada (data hilang), BUKAN
  // "semua ingredient lengkap costnya". .every() pada array kosong selalu
  // true -- itu yang bikin costPerPortion:0 muncul kayak angka valid di
  // respons, padahal seharusnya null + costComplete:false.
  const costComplete =
    ingredientsDetail.length > 0 && ingredientsDetail.every((d) => d.unitCost != null);
  const costPerPortion = costComplete
    ? ingredientsDetail.reduce((sum, d) => sum + (d.costContribution || 0), 0) /
      planMenu.quantityPlanned
    : null;
  const lowStock = ingredientsDetail.some((d) => d.quantityAvailable < d.quantityNeeded);

  return { ingredientsDetail, costComplete, costPerPortion, lowStock };
}

module.exports = {
  computePricing,
  computeRemainingQuantity,
  computeIngredientsDetail,
  computeCommittedIngredientsDetail,
  computeMenuCost,
  computeInventorySafetyStatus,
  computeSuggestion,
};
