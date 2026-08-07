const Menu = require('../models/menu/menu.model');
const Inventory = require('../models/inventory/inventory.model');
const ProductionPlan = require('../models/plan/productionPlan.model');
const ApiError = require('../utils/ApiError');

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate-before-write: every inventoryId must resolve to an `active`
 * Inventory doc, and there must be no duplicate inventoryId in the
 * payload. Used by both create and edit (doc §5, endpoints 1 & 4).
 */
async function validateIngredients(ingredients) {
  const errors = [];
  const seen = new Set();

  for (let i = 0; i < ingredients.length; i += 1) {
    const { inventoryId } = ingredients[i];
    const key = String(inventoryId);

    if (seen.has(key)) {
      errors.push({
        field: 'ingredients',
        message: `inventoryId '${inventoryId}' muncul lebih dari sekali`,
      });
      continue;
    }
    seen.add(key);

    const inv = await Inventory.findOne({ _id: inventoryId, status: 'active' });
    if (!inv) {
      errors.push({
        field: `ingredients[${i}].inventoryId`,
        message: 'Inventory tidak ditemukan atau berstatus deleted',
      });
    }
  }

  if (errors.length > 0) {
    const isDuplicate = errors.some((e) => e.field === 'ingredients');
    throw new ApiError(
      400,
      isDuplicate
        ? 'Validation error: terdapat inventoryId yang sama lebih dari satu kali'
        : 'Validation error: ada ingredient yang inventoryId-nya tidak valid',
      errors
    );
  }
}

/**
 * Populates ingredients with live Inventory data and computes the cost/
 * margin breakdown. A missing lastCostBatch or an archived Inventory
 * never gets silently treated as 0 — it flips costComplete to false and
 * the whole triplet becomes null instead (doc §2, "Estimasi Cost").
 */
async function buildCostBreakdown(ingredients, sellingPrice) {
  let costComplete = true;

  const populated = await Promise.all(
    ingredients.map(async (ing) => {
      const inv = await Inventory.findById(ing.inventoryId);
      const missingCost = !inv || inv.status === 'deleted' || inv.lastCostBatch == null;

      if (missingCost) {
        costComplete = false;
        return {
          inventoryId: ing.inventoryId,
          nameInventory: inv ? inv.name : null,
          category: inv ? inv.category : null,
          unit: inv ? inv.unit : null,
          inventoryStatus: inv ? inv.status : 'deleted',
          quantityNeeded: ing.quantityNeeded,
          currentCostPerUnit: null,
          subtotalCost: null,
        };
      }

      const currentCostPerUnit = inv.lastCostBatch;
      const subtotalCost = ing.quantityNeeded * currentCostPerUnit;

      return {
        inventoryId: ing.inventoryId,
        nameInventory: inv.name,
        category: inv.category,
        unit: inv.unit,
        inventoryStatus: inv.status,
        quantityNeeded: ing.quantityNeeded,
        currentCostPerUnit,
        subtotalCost,
      };
    })
  );

  if (!costComplete) {
    return {
      ingredients: populated,
      currentCostEstimate: null,
      marginEstimate: null,
      marginPercentage: null,
      costComplete: false,
      warning:
        'Terdapat ingredient yang inventory-nya sudah diarsipkan atau belum pernah punya batch, estimasi cost tidak dapat dihitung penuh',
    };
  }

  const currentCostEstimate = populated.reduce((sum, ing) => sum + ing.subtotalCost, 0);
  const marginEstimate = sellingPrice - currentCostEstimate;
  const marginPercentage = sellingPrice > 0 ? (marginEstimate / sellingPrice) * 100 : null;

  return {
    ingredients: populated,
    currentCostEstimate,
    marginEstimate,
    marginPercentage,
    costComplete: true,
    warning: null,
  };
}

/**
 * Bulk-flags draft Production Plans referencing this menu as stale.
 * Cheap field-only update (doc §5), returns the affected plan IDs so the
 * caller can report them as `affectedDraftPlans`.
 */
async function flagDraftPlansStale(menuId, staleReason) {
  const affected = await ProductionPlan.find(
    { status: 'draft', 'menus.menuId': menuId },
    { _id: 1 }
  );

  if (affected.length === 0) return [];

  const affectedIds = affected.map((p) => p._id);

  await ProductionPlan.updateMany(
    { _id: { $in: affectedIds } },
    { $set: { checkResultStale: true, staleReason } }
  );

  return affectedIds;
}

async function createMenu(data) {
  await validateIngredients(data.ingredients);

  const menu = await Menu.create({
    name: data.name,
    description: data.description || '',
    image: data.image || null,
    sellingPrice: data.sellingPrice,
    status: 'active',
    ingredients: data.ingredients.map((ing) => ({
      inventoryId: ing.inventoryId,
      quantityNeeded: ing.quantityNeeded,
    })),
  });

  const breakdown = await buildCostBreakdown(menu.ingredients, menu.sellingPrice);

  return {
    _id: menu._id,
    name: menu.name,
    description: menu.description,
    image: menu.image,
    sellingPrice: menu.sellingPrice,
    status: menu.status,
    ingredients: breakdown.ingredients,
    currentCostEstimate: breakdown.currentCostEstimate,
    marginEstimate: breakdown.marginEstimate,
    marginPercentage: breakdown.marginPercentage,
    costComplete: breakdown.costComplete,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
  };
}

async function getMenus(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const includeDeleted = query.includeDeleted === 'true' || query.includeDeleted === true;

  const filter = {};
  if (!includeDeleted) filter.status = 'active';
  if (query.search) {
    filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
  }

  const [menus, totalData] = await Promise.all([
    Menu.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Menu.countDocuments(filter),
  ]);

  const data = await Promise.all(
    menus.map(async (menu) => {
      const breakdown = await buildCostBreakdown(menu.ingredients, menu.sellingPrice);
      return {
        _id: menu._id,
        image: menu.image,
        name: menu.name,
        sellingPrice: menu.sellingPrice,
        status: menu.status,
        totalIngredients: menu.ingredients.length,
        currentCostEstimate: breakdown.currentCostEstimate,
        marginEstimate: breakdown.marginEstimate,
        marginPercentage: breakdown.marginPercentage,
        costComplete: breakdown.costComplete,
      };
    })
  );

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

async function getMenuById(id) {
  const menu = await Menu.findOne({ _id: id, status: { $ne: 'deleted' } });
  if (!menu) throw new ApiError(404, 'Menu tidak ditemukan');

  const breakdown = await buildCostBreakdown(menu.ingredients, menu.sellingPrice);

  const result = {
    _id: menu._id,
    image: menu.image,
    name: menu.name,
    description: menu.description,
    sellingPrice: menu.sellingPrice,
    status: menu.status,
    ingredients: breakdown.ingredients,
    currentCostEstimate: breakdown.currentCostEstimate,
    marginEstimate: breakdown.marginEstimate,
    marginPercentage: breakdown.marginPercentage,
    costComplete: breakdown.costComplete,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
  };

  if (breakdown.warning) result.warning = breakdown.warning;

  return result;
}

/**
 * NEW — batch-fetch untuk Production Plan (A1/A3/A4/A5/A6).
 *
 * Dipakai tiap kali Plan perlu resep+cost breakdown beberapa Menu sekaligus
 * (agregasi kebutuhan bahan lintas menu, breakdown ingredientsDetail per
 * menu, defense-in-depth validasi status Menu saat approve). Reuse
 * `buildCostBreakdown` yang sama dengan getMenuById/getMenus — TIDAK ada
 * metodologi cost kedua yang berjalan paralel (lihat RFC v3 Production
 * Plan §4.5, alasan kenapa ini penting).
 *
 * Sengaja TIDAK memfilter status: 'active' di query — caller (Plan) butuh
 * tahu status apa adanya (termasuk 'deleted') untuk menentukan menuId mana
 * yang tidak valid/sudah diarsipkan. menuId yang sama sekali tidak
 * ditemukan di DB tidak akan muncul di array hasil — caller yang membedakan
 * "missing" vs "status non-active".
 *
 * @param {Array<string|ObjectId>} menuIds
 * @returns {Promise<Array<{
 *   _id, name, status, sellingPrice,
 *   ingredients: Array<{ inventoryId, nameInventory, quantityNeeded, currentCostPerUnit, subtotalCost }>,
 *   currentCostEstimate, marginEstimate, marginPercentage, costComplete, warning
 * }>>}
 */
async function getMenusByIds(menuIds) {
  const uniqueIds = [...new Set(menuIds.map((id) => String(id)))];
  if (uniqueIds.length === 0) return [];

  const menus = await Menu.find({ _id: { $in: uniqueIds } });

  return Promise.all(
    menus.map(async (menu) => {
      const breakdown = await buildCostBreakdown(menu.ingredients, menu.sellingPrice);
      return {
        _id: menu._id,
        name: menu.name,
        status: menu.status,
        sellingPrice: menu.sellingPrice,
        ingredients: breakdown.ingredients,
        currentCostEstimate: breakdown.currentCostEstimate,
        marginEstimate: breakdown.marginEstimate,
        marginPercentage: breakdown.marginPercentage,
        costComplete: breakdown.costComplete,
        warning: breakdown.warning,
      };
    })
  );
}

async function updateMenu(id, data) {
  const menu = await Menu.findOne({ _id: id, status: 'active' });
  if (!menu) throw new ApiError(404, 'Menu tidak ditemukan');

  if (data.ingredients) {
    await validateIngredients(data.ingredients);
  }

  // Only ingredients/sellingPrice feed Plan calculations — name/description/
  // image edits never trigger the stale cascade (doc §5, endpoint 4 flow).
  const touchesPlans = data.ingredients !== undefined || data.sellingPrice !== undefined;

  if (data.name !== undefined) menu.name = data.name;
  if (data.description !== undefined) menu.description = data.description;
  if (data.image !== undefined) menu.image = data.image;
  if (data.sellingPrice !== undefined) menu.sellingPrice = data.sellingPrice;
  if (data.ingredients !== undefined) {
    // Full replace, never a patch (RFC §6) — no diffing to decide if
    // recipe_changed should fire, presence in payload is enough.
    menu.ingredients = data.ingredients.map((ing) => ({
      inventoryId: ing.inventoryId,
      quantityNeeded: ing.quantityNeeded,
    }));
  }

  await menu.save();

  const affectedDraftPlans = touchesPlans
    ? await flagDraftPlansStale(menu._id, 'recipe_changed')
    : [];

  return {
    data: {
      _id: menu._id,
      name: menu.name,
      sellingPrice: menu.sellingPrice,
      updatedAt: menu.updatedAt,
    },
    affectedDraftPlans,
  };
}

async function deleteMenu(id) {
  const menu = await Menu.findOne({ _id: id, status: { $ne: 'deleted' } });
  if (!menu) throw new ApiError(404, 'Menu tidak ditemukan');

  // Unconditional archive — no delete guard (RFC §4). Menu has nothing
  // analogous to "active stock" that a soft-delete could strand.
  menu.status = 'deleted';
  menu.deletedAt = new Date();
  await menu.save();

  const affectedDraftPlans = await flagDraftPlansStale(menu._id, 'menu_archived');

  return {
    data: { _id: menu._id, status: menu.status, deletedAt: menu.deletedAt },
    affectedDraftPlans,
  };
}

async function getMenuDropdown(query) {
  const filter = { status: 'active' };
  if (query.search) {
    filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
  }

  // Minimal fields on purpose — no ingredients/currentCostEstimate here,
  // keeps the dropdown query cheap (doc §5, endpoint 6 flow).
  const menus = await Menu.find(filter, { name: 1, sellingPrice: 1, image: 1 }).sort({
    name: 1,
  });

  return menus.map((m) => ({
    _id: m._id,
    name: m.name,
    sellingPrice: m.sellingPrice,
    image: m.image,
  }));
}

module.exports = {
  createMenu,
  getMenus,
  getMenuById,
  getMenusByIds,
  updateMenu,
  deleteMenu,
  getMenuDropdown,
};
