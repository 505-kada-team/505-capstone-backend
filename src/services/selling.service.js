const mongoose = require('mongoose');
const ProductionPlan = require('../models/plan/productionPlan.model');
const PlanSale = require('../models/selling/selling.model');
const ApiError = require('../utils/ApiError');
const { computePricing, computeCommittedIngredientsDetail } = require('../utils/planCompute');

// --- B1: List plan aktif ----------------------------------------------

async function getActivePlans() {
  const now = new Date();

  await ProductionPlan.updateMany(
    { status: 'active', endDate: { $lt: now } },
    { $set: { status: 'completed', completedAt: now } }
  );

  const plans = await ProductionPlan.find({ status: 'active' });
  if (plans.length === 0) return [];

  return plans.map((plan) => {
    const sellable = now >= plan.startDate && now <= plan.endDate;

    const menus = plan.menus.map((m) => {
      const { effectiveSellingPrice, discountedPrice, discountStatus } = computePricing(
        m,
        null,
        plan.status
      );
      const isDiscounted = discountStatus === 'active';
      const remainingQuantity = Math.max(0, m.quantityPlanned - m.soldQuantity - m.lossQuantity);

      // Reuse compute Production Plan, buang field cost -- kasir/barista
      // nggak perlu lihat harga modal bahan.
      const { ingredientsDetail: full } = computeCommittedIngredientsDetail({
        planMenu: m,
        committedIngredients: plan.committedIngredients,
      });
      const ingredientsDetail = full.map(
        ({
          inventoryId,
          nameInventory,
          unit,
          quantityNeeded,
          quantityAvailable,
          poolShared,
          nearestExpiry,
          hasUnsafeBatch,
        }) => ({
          inventoryId,
          nameInventory,
          unit,
          quantityNeeded,
          quantityAvailable,
          poolShared,
          nearestExpiry,
          hasUnsafeBatch,
        })
      );

      return {
        menuId: m.menuId,
        name: m.frozenMenuName,
        image: m.frozenMenuImage,
        sellingPrice: effectiveSellingPrice,
        currentPrice: isDiscounted ? discountedPrice : effectiveSellingPrice,
        isDiscounted,
        discountPercentage: isDiscounted ? m.discount.discountPercentage : null,
        discountEndsAt: isDiscounted ? m.discount.endDate : null,
        remainingQuantity,
        ingredientsDetail,
      };
    });

    // Antrean batch level-plan -- semua batch tersisa lintas ingredient,
    // urut FEFO (expiry ascending), TANPA harga.
    const committedBatchesQueue = plan.committedIngredients
      .flatMap((ing) =>
        ing.batches
          .filter((b) => b.quantityRemaining > 0)
          .map((b) => ({
            inventoryId: ing.inventoryId,
            nameInventory: ing.nameInventory,
            unit: ing.unit, // BARU
            batchCode: b.batchCode,
            quantityRemaining: b.quantityRemaining,
            expired: b.expired,
            batchSafetyStatus: b.batchSafetyStatus,
          }))
      )
      .sort((a, b) => new Date(a.expired) - new Date(b.expired));

    return {
      planId: plan._id,
      name: plan.name,
      startDate: plan.startDate,
      endDate: plan.endDate,
      sellable,
      menus,
      committedBatchesQueue,
      warning: plan.hasPendingLossReplacement
        ? 'Ada laporan kerugian bahan yang sudah disetujui tapi belum diganti stoknya'
        : null,
    };
  });
}

// --- B2: Catat penjualan (multi-item + FEFO decrement) ---------------

async function createSale({ planId, items, cashierName }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Transaksi harus punya minimal 1 item', [
      { field: 'items', message: 'items tidak boleh kosong' },
    ]);
  }
  const menuIdStrings = items.map((i) => String(i.menuId));
  if (new Set(menuIdStrings).size !== menuIdStrings.length) {
    throw new ApiError(400, 'menuId yang sama muncul lebih dari sekali dalam satu transaksi', [
      { field: 'items', message: 'menuId harus unik per transaksi' },
    ]);
  }

  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const plan = await ProductionPlan.findOne({ _id: planId, status: 'active' }).session(session);
      if (!plan) throw new ApiError(404, 'Plan tidak ditemukan atau bukan berstatus active');

      const now = new Date();
      if (now < plan.startDate) {
        throw new ApiError(
          400,
          `Plan belum dimulai, penjualan baru bisa dicatat mulai ${plan.startDate.toISOString().slice(0, 10)}`,
          [{ field: 'startDate', message: 'Tanggal sekarang masih sebelum startDate plan' }]
        );
      }
      if (now > plan.endDate) {
        throw new ApiError(400, 'Plan sudah melewati endDate, penjualan tidak bisa dicatat lagi', [
          { field: 'endDate', message: 'Tanggal sekarang sudah melewati endDate plan' },
        ]);
      }

      const menuMap = new Map(plan.menus.map((m) => [String(m.menuId), m]));
      const pricedItems = items.map(({ menuId, quantitySold }) => {
        const planMenu = menuMap.get(String(menuId));
        if (!planMenu) {
          throw new ApiError(404, `Menu ${menuId} tidak ada di plan yang sedang aktif ini`, [
            { field: 'menuId', message: 'menuId tidak ditemukan di plan.menus' },
          ]);
        }
        const remainingQuantity = Math.max(
          0,
          planMenu.quantityPlanned - planMenu.soldQuantity - planMenu.lossQuantity
        );
        if (quantitySold > remainingQuantity) {
          throw new ApiError(409, `Sisa porsi menu "${planMenu.frozenMenuName}" tidak mencukupi`, [
            {
              field: 'quantitySold',
              message: `Sisa ${remainingQuantity}, diminta ${quantitySold}`,
            },
          ]);
        }

        const { effectiveSellingPrice, discountedPrice, discountStatus } = computePricing(
          planMenu,
          null,
          plan.status
        );
        const discountApplied = discountStatus === 'active';
        const originalPrice = effectiveSellingPrice;
        const priceUsed = discountApplied ? discountedPrice : effectiveSellingPrice;
        const discountPercentage = discountApplied ? planMenu.discount.discountPercentage : null;

        return {
          menuId: new mongoose.Types.ObjectId(menuId),
          menuName: planMenu.frozenMenuName,
          quantitySold,
          originalPrice,
          priceUsed,
          discountApplied,
          discountPercentage,
        };
      });

      // --- Stock guard (porsi menu) -- sama seperti sebelumnya ---
      const stockGuardExpr = {
        $and: pricedItems.map((item) => ({
          $anyElementTrue: {
            $map: {
              input: '$menus',
              as: 'm',
              in: {
                $and: [
                  { $eq: ['$$m.menuId', item.menuId] },
                  {
                    $gte: [
                      {
                        $subtract: [
                          '$$m.quantityPlanned',
                          { $add: ['$$m.soldQuantity', '$$m.lossQuantity'] },
                        ],
                      },
                      item.quantitySold,
                    ],
                  },
                ],
              },
            },
          },
        })),
      };

      const menuUpdateBranches = pricedItems.map((item) => ({
        case: { $eq: ['$$m.menuId', item.menuId] },
        then: {
          $mergeObjects: [
            '$$m',
            {
              soldQuantity: { $add: ['$$m.soldQuantity', item.quantitySold] },
              soldOutAt: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          {
                            $subtract: [
                              '$$m.quantityPlanned',
                              {
                                $add: [
                                  { $add: ['$$m.soldQuantity', item.quantitySold] },
                                  '$$m.lossQuantity',
                                ],
                              },
                            ],
                          },
                          0,
                        ],
                      },
                      { $lt: [now, '$endDate'] },
                    ],
                  },
                  now,
                  '$$m.soldOutAt',
                ],
              },
            },
          ],
        },
      }));

      // --- FEFO decrement (bahan) -- baru ---
      const itemsForFefo = pricedItems.map((item) => {
        const planMenu = menuMap.get(String(item.menuId));
        return {
          menuId: item.menuId,
          ingredientsNeeded: (planMenu.frozenRecipe || []).map((r) => ({
            inventoryId: r.inventoryId,
            needed: r.quantityPerUnit * item.quantitySold,
          })),
        };
      });

      const fefoWalkOneIngredient = {
        $let: {
          vars: {
            sortedBatches: {
              $sortArray: {
                input: { $ifNull: ['$$ingredientEntry.batches', []] },
                sortBy: { expired: 1 },
              },
            },
          },
          in: {
            $reduce: {
              input: '$$sortedBatches',
              initialValue: { remainingNeed: '$$this.needed', batches: [], taken: [] },
              in: {
                $let: {
                  vars: {
                    allocate: { $min: ['$$value.remainingNeed', '$$this.quantityRemaining'] },
                  },
                  in: {
                    remainingNeed: { $subtract: ['$$value.remainingNeed', '$$allocate'] },
                    batches: {
                      $concatArrays: [
                        '$$value.batches',
                        [
                          {
                            $mergeObjects: [
                              '$$this',
                              {
                                quantityRemaining: {
                                  $subtract: ['$$this.quantityRemaining', '$$allocate'],
                                },
                              },
                            ],
                          },
                        ],
                      ],
                    },
                    taken: {
                      $concatArrays: [
                        '$$value.taken',
                        {
                          $cond: [
                            { $gt: ['$$allocate', 0] },
                            [
                              {
                                subInventoryId: '$$this.subInventoryId',
                                batchCode: '$$this.batchCode',
                                quantityUsed: '$$allocate',
                                expired: '$$this.expired',
                              },
                            ],
                            [],
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      };

      const applyItemToCommittedIngredients = {
        $reduce: {
          input: '$$this.ingredientsNeeded',
          initialValue: { committedIngredients: '$$value.committedIngredients', itemBreakdown: [] },
          in: {
            $let: {
              vars: {
                ingredientEntry: {
                  $first: {
                    $filter: {
                      input: '$$value.committedIngredients',
                      as: 'ing',
                      cond: { $eq: ['$$ing.inventoryId', '$$this.inventoryId'] },
                    },
                  },
                },
              },
              in: {
                $let: {
                  vars: { walk: fefoWalkOneIngredient },
                  in: {
                    committedIngredients: {
                      $map: {
                        input: '$$value.committedIngredients',
                        as: 'ing',
                        in: {
                          $cond: [
                            { $eq: ['$$ing.inventoryId', '$$this.inventoryId'] },
                            { $mergeObjects: ['$$ing', { batches: '$$walk.batches' }] },
                            '$$ing',
                          ],
                        },
                      },
                    },
                    itemBreakdown: {
                      $concatArrays: [
                        '$$value.itemBreakdown',
                        [
                          {
                            inventoryId: '$$this.inventoryId',
                            nameInventory: '$$ingredientEntry.nameInventory',
                            batches: '$$walk.taken',
                            shortfall: { $max: ['$$walk.remainingNeed', 0] },
                          },
                        ],
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      };

      const fefoReduceExpr = {
        $reduce: {
          input: { $literal: itemsForFefo },
          initialValue: { committedIngredients: '$committedIngredients', breakdown: [] },
          in: {
            $let: {
              vars: { applied: applyItemToCommittedIngredients },
              in: {
                committedIngredients: '$$applied.committedIngredients',
                breakdown: {
                  $concatArrays: [
                    '$$value.breakdown',
                    [{ menuId: '$$this.menuId', ingredientsUsed: '$$applied.itemBreakdown' }],
                  ],
                },
              },
            },
          },
        },
      };

      const updatedPlan = await ProductionPlan.findOneAndUpdate(
        { _id: planId, status: 'active', $expr: stockGuardExpr },
        [
          { $set: { _fefoResult: fefoReduceExpr } },
          {
            $set: {
              menus: {
                $map: {
                  input: '$menus',
                  as: 'm',
                  in: { $switch: { branches: menuUpdateBranches, default: '$$m' } },
                },
              },
              committedIngredients: '$_fefoResult.committedIngredients',
              _pendingSaleAllocation: '$_fefoResult.breakdown',
            },
          },
          { $unset: '_fefoResult' },
        ],
        { session, new: true }
      );

      if (!updatedPlan) {
        throw new ApiError(409, 'Sisa porsi salah satu menu tidak mencukupi', [
          {
            field: 'items',
            message: 'Stok berubah oleh transaksi lain, silakan cek ulang sisa porsi',
          },
        ]);
      }

      // FIX: _pendingSaleAllocation bukan path yang terdaftar di
      // productionPlanSchema -- ini cuma field sementara yang di-set lewat
      // aggregation pipeline update di atas. Mongoose hanya membuat getter
      // untuk path yang ADA di schema, jadi akses langsung
      // `updatedPlan._pendingSaleAllocation` selalu balikin undefined
      // meskipun datanya beneran ada di dokumen hasil pipeline. Harus pakai
      // .get() supaya dibaca langsung dari data internal document.
      const pendingSaleAllocation = updatedPlan.get('_pendingSaleAllocation') || [];

      const shortfallItem = pendingSaleAllocation.find((b) =>
        b.ingredientsUsed.some((i) => i.shortfall > 0)
      );
      if (shortfallItem) {
        const bad = shortfallItem.ingredientsUsed.find((i) => i.shortfall > 0);
        throw new ApiError(
          409,
          `Reservasi bahan "${bad.nameInventory}" tidak mencukupi untuk transaksi ini`,
          [
            {
              field: 'items',
              message: 'Kemungkinan ada bahan hilang/rusak yang belum dilaporkan lewat loss report',
            },
          ]
        );
      }

      const breakdownByMenuId = new Map(
        pendingSaleAllocation.map((b) => [String(b.menuId), b.ingredientsUsed])
      );
      await ProductionPlan.updateOne(
        { _id: planId },
        { $unset: { _pendingSaleAllocation: '' } },
        { session }
      );

      const finalPricedItems = pricedItems.map((item) => ({
        ...item,
        ingredientsUsed: breakdownByMenuId.get(String(item.menuId)) || [],
      }));

      const [transaction] = await PlanSale.create(
        [{ planId, cashierName, soldAt: now, items: finalPricedItems }],
        { session }
      );

      const updatedMenuMap = new Map(updatedPlan.menus.map((m) => [String(m.menuId), m]));

      response = {
        _id: transaction._id,
        planId: transaction.planId,
        cashierName: transaction.cashierName,
        soldAt: transaction.soldAt,
        items: transaction.items.map((it) => {
          const m = updatedMenuMap.get(String(it.menuId));
          return {
            menuId: it.menuId,
            menuName: it.menuName,
            quantitySold: it.quantitySold,
            originalPrice: it.originalPrice,
            priceUsed: it.priceUsed,
            discountApplied: it.discountApplied,
            discountPercentage: it.discountPercentage,
            ingredientsUsed: it.ingredientsUsed,
            remainingQuantity: Math.max(0, m.quantityPlanned - m.soldQuantity - m.lossQuantity),
          };
        }),
        totalRevenue: transaction.items.reduce(
          (sum, it) => sum + it.priceUsed * it.quantitySold,
          0
        ),
      };
    });
    return response;
  } finally {
    session.endSession();
  }
}

// --- B3: Riwayat penjualan (per transaksi/struk) ---------------------

async function getSaleHistory(query) {
  const { planId, date, cashierName, menuId, startTime, endTime } = query;

  // BARU -- sebelumnya endpoint ini tidak punya pagination sama sekali,
  // semua transaksi yang match filter langsung di-load penuh ke memory.
  // Pola clamp sama seperti getMenus()/listPlans() di modul lain.
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);

  const filter = {};
  if (planId) filter.planId = planId;
  if (cashierName) filter.cashierName = cashierName;
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    filter.soldAt = { $gte: start, $lt: end };
  }
  if (startTime) {
    const s = new Date(startTime);
    if (!filter.soldAt) filter.soldAt = {};
    filter.soldAt.$gte = s;
  }
  if (endTime) {
    const e = new Date(endTime);
    if (!filter.soldAt) filter.soldAt = {};
    filter.soldAt.$lte = e;
  }
  if (menuId) filter['items.menuId'] = menuId;

  const skip = (page - 1) * limit;

  const [totalData, transactions, summaryAgg] = await Promise.all([
    PlanSale.countDocuments(filter),
    PlanSale.find(filter).sort({ soldAt: -1 }).skip(skip).limit(limit),
    // FIX -- summary WAJIB dihitung atas SELURUH hasil filter, bukan cuma
    // transaksi di halaman yang sedang ditampilkan. Query terpisah ini
    // sengaja tidak ikut skip/limit, supaya angka ringkasan laporan tidak
    // berubah-ubah tergantung halaman berapa yang sedang dibuka user.
    PlanSale.aggregate([
      { $match: filter },
      { $unwind: '$items' },
      // Kalau filter by menuId, summary hanya boleh hitung item untuk menu
      // itu saja — bukan semua item dari transaksi yang match.
      ...(menuId ? [{ $match: { 'items.menuId': menuId } }] : []),
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $multiply: ['$items.priceUsed', '$items.quantitySold'] } },
          totalDiscountGiven: {
            $sum: {
              $multiply: [
                { $subtract: ['$items.originalPrice', '$items.priceUsed'] },
                '$items.quantitySold',
              ],
            },
          },
        },
      },
    ]),
  ]);

  const data = transactions.map((t) => ({
    _id: t._id,
    planId: t.planId,
    cashierName: t.cashierName,
    soldAt: t.soldAt,
    items: t.items.map((it) => ({
      menuId: it.menuId,
      menuName: it.menuName,
      quantitySold: it.quantitySold,
      originalPrice: it.originalPrice,
      priceUsed: it.priceUsed,
      discountApplied: it.discountApplied,
      discountPercentage: it.discountPercentage,
      ingredientsUsed: it.ingredientsUsed,
    })),
    transactionRevenue: t.items.reduce((sum, it) => sum + it.priceUsed * it.quantitySold, 0),
  }));

  const summary = {
    totalTransaction: totalData,
    totalRevenue: summaryAgg[0]?.totalRevenue || 0,
    totalDiscountGiven: summaryAgg[0]?.totalDiscountGiven || 0,
  };

  return {
    data,
    summary,
    pagination: { totalData, totalPage: Math.ceil(totalData / limit), currentPage: page, limit },
  };
}

module.exports = { getActivePlans, createSale, getSaleHistory };
