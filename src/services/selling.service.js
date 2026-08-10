const mongoose = require('mongoose');
const ProductionPlan = require('../models/plan/productionPlan.model');
const PlanSale = require('../models/selling/selling.model');
const ApiError = require('../utils/ApiError');
const { computePricing } = require('../utils/planCompute');

// --- B1: List plan aktif + sisa stok + harga berlaku per menu -------------

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

      return {
        menuId: m.menuId,
        name: m.frozenMenuName,
        // BARU -- dibekukan saat approvePlan(), pola sama dgn
        // frozenMenuName. Tidak live-join ke Menu.imageUrl.
        image: m.frozenMenuImage,
        sellingPrice: effectiveSellingPrice,
        currentPrice: isDiscounted ? discountedPrice : effectiveSellingPrice,
        isDiscounted,
        discountPercentage: isDiscounted ? m.discount.discountPercentage : null,
        discountEndsAt: isDiscounted ? m.discount.endDate : null,
        remainingQuantity,
      };
    });

    return {
      planId: plan._id,
      name: plan.name,
      startDate: plan.startDate,
      endDate: plan.endDate,
      sellable,
      menus,
      warning: plan.hasPendingLossReplacement
        ? 'Ada laporan kerugian bahan yang sudah disetujui tapi belum diganti stoknya'
        : null,
    };
  });
}

// --- B2: Catat penjualan (1 transaksi, banyak menu) ------------------------

async function createSale({ planId, items, cashierName }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Transaksi harus punya minimal 1 item', [
      { field: 'items', message: 'items tidak boleh kosong' },
    ]);
  }
  const menuIdStrings = items.map((i) => String(i.menuId));
  if (new Set(menuIdStrings).size !== menuIdStrings.length) {
    // Defense-in-depth -- idealnya sudah ditolak di validation layer juga.
    throw new ApiError(400, 'menuId yang sama muncul lebih dari sekali dalam satu transaksi', [
      { field: 'items', message: 'menuId harus unik per transaksi' },
    ]);
  }

  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const plan = await ProductionPlan.findOne({ _id: planId, status: 'active' }).session(session);
      if (!plan) {
        throw new ApiError(404, 'Plan tidak ditemukan atau bukan berstatus active');
      }

      const now = new Date();
      if (now < plan.startDate) {
        throw new ApiError(
          400,
          `Plan belum dimulai, penjualan baru bisa dicatat mulai ${plan.startDate
            .toISOString()
            .slice(0, 10)}`,
          [{ field: 'startDate', message: 'Tanggal sekarang masih sebelum startDate plan' }]
        );
      }
      if (now > plan.endDate) {
        throw new ApiError(400, 'Plan sudah melewati endDate, penjualan tidak bisa dicatat lagi', [
          { field: 'endDate', message: 'Tanggal sekarang sudah melewati endDate plan' },
        ]);
      }

      // Validasi in-memory dulu -- ngasih pesan error spesifik per menu.
      // Bukan sumber kebenaran akhir; itu tetap $expr di findOneAndUpdate
      // di bawah, buat defend against concurrent sale request lain.
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

      // $expr: SEMUA item harus punya elemen menus yang cocok & stok
      // cukup, dicek ulang atomic di titik commit.
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

      // $switch: tiap elemen $menus dicocokkan ke pricedItems berdasarkan
      // menuId. Yang cocok, soldQuantity-nya ditambah + soldOutAt di-set
      // kalau abis. Yang nggak dibeli di transaksi ini dikembalikan apa
      // adanya (default branch).
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

      const updatedPlan = await ProductionPlan.findOneAndUpdate(
        { _id: planId, status: 'active', $expr: stockGuardExpr },
        [
          {
            $set: {
              menus: {
                $map: {
                  input: '$menus',
                  as: 'm',
                  in: { $switch: { branches: menuUpdateBranches, default: '$$m' } },
                },
              },
            },
          },
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

      const [transaction] = await PlanSale.create(
        [{ planId, cashierName, soldAt: now, items: pricedItems }],
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

// --- B3: Riwayat penjualan (per transaksi/struk) ---------------------------

async function getSaleHistory(query) {
  const { planId, date, cashierName } = query;
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

  const transactions = await PlanSale.find(filter).sort({ soldAt: -1 });

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
    })),
    transactionRevenue: t.items.reduce((sum, it) => sum + it.priceUsed * it.quantitySold, 0),
  }));

  const totalTransaction = transactions.length; // 1 struk = 1
  const totalRevenue = data.reduce((sum, t) => sum + t.transactionRevenue, 0);
  const totalDiscountGiven = transactions.reduce(
    (sum, t) =>
      sum + t.items.reduce((s, it) => s + it.quantitySold * (it.originalPrice - it.priceUsed), 0),
    0
  );

  return {
    data,
    summary: { totalTransaction, totalRevenue, totalDiscountGiven },
  };
}

module.exports = { getActivePlans, createSale, getSaleHistory };
