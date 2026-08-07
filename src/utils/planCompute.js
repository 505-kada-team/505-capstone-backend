function computeIngredientsDetail({ planMenu, menuDoc, checkResult }) {
  const checkResultByInventoryId = new Map(
    (checkResult || []).map((entry) => [String(entry.inventoryId), entry])
  );

  const ingredientsDetail = (menuDoc?.ingredients || []).map((ing) => {
    const entry = checkResultByInventoryId.get(String(ing.inventoryId));
    const quantityNeeded = ing.quantityNeeded * planMenu.quantityPlanned;

    // ⬅️ eligibleBatches (bukan batches), field expired sesuai eligibleBatchSchema
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
      quantityNeeded,
      // ⬅️ sekarang angka ASLI, bukan approksimasi lagi
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
