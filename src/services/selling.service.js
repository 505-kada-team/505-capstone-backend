const mongoose = require('mongoose');
const ProductionPlan = require('../models/plan/productionPlan.model');
const PlanSale = require('../models/selling/selling.model');
const ApiError = require('../utils/ApiError');
const { computePricing } = require('../utils/planCompute');

// ---------------------------------------------------------------------------
// Prinsip modul ini (RFC §1): HANYA baca ProductionPlan (status/tanggal/
// harga) dan HANYA tulis PlanSale + menus[].soldQuantity/soldOutAt. Tidak
// pernah menyentuh Inventory, ProductionPlan.status, atau menus[].discount.
//
// TIDAK ADA dependency ke menu.service.js lagi -- baik harga
// (frozenSellingPrice) maupun nama (frozenMenuName) sudah dibekukan di
// ProductionPlan.menus[] saat approve, jadi modul ini tidak pernah perlu
// live-join ke Menu (cross-module reconciliation item #8).
//
// Harga dihitung via computePricing() -- fungsi YANG SAMA dipakai Production
// Plan module -- supaya tidak ada metodologi harga kedua yang berjalan
// paralel.
// ---------------------------------------------------------------------------

// --- B1: List plan aktif + sisa stok + harga berlaku per menu -------------

async function getActivePlans() {
  const now = new Date();

  // Lazy-check completed, pola sama dengan Production Plan module.
  await ProductionPlan.updateMany(
    { status: 'active', endDate: { $lt: now } },
    { $set: { status: 'completed', completedAt: now } }
  );

  const plans = await ProductionPlan.find({ status: 'active' });
  if (plans.length === 0) return [];

  return plans.map((plan) => {
    const sellable = now >= plan.startDate && now <= plan.endDate;

    const menus = plan.menus.map((m) => {
      // menuDoc param computePricing sengaja null -- untuk plan active,
      // computePricing tidak pernah membaca menuDoc sama sekali (selalu
      // pakai frozenSellingPrice).
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

// --- B2: Catat penjualan ---------------------------------------------------

async function createSale({ planId, menuId, quantitySold, cashierName }) {
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

      const planMenu = plan.menus.find((m) => String(m.menuId) === String(menuId));
      if (!planMenu) {
        throw new ApiError(404, 'Menu ini tidak ada di plan yang sedang aktif ini', [
          { field: 'menuId', message: 'menuId tidak ditemukan di plan.menus' },
        ]);
      }

      const remainingQuantity = Math.max(
        0,
        planMenu.quantityPlanned - planMenu.soldQuantity - planMenu.lossQuantity
      );
      if (quantitySold > remainingQuantity) {
        throw new ApiError(409, 'Sisa porsi menu ini tidak mencukupi', [
          { field: 'quantitySold', message: `Sisa ${remainingQuantity}, diminta ${quantitySold}` },
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

      const menuObjectId = new mongoose.Types.ObjectId(menuId);

      const updatedPlan = await ProductionPlan.findOneAndUpdate(
        {
          _id: planId,
          status: 'active',
          menus: {
            $elemMatch: {
              menuId: menuObjectId,
              $expr: {
                $gte: [
                  { $subtract: ['$quantityPlanned', { $add: ['$soldQuantity', '$lossQuantity'] }] },
                  quantitySold,
                ],
              },
            },
          },
        },
        [
          {
            $set: {
              menus: {
                $map: {
                  input: '$menus',
                  as: 'm',
                  in: {
                    $cond: [
                      { $eq: ['$$m.menuId', menuObjectId] },
                      {
                        $mergeObjects: [
                          '$$m',
                          {
                            soldQuantity: { $add: ['$$m.soldQuantity', quantitySold] },
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
                                                { $add: ['$$m.soldQuantity', quantitySold] },
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
                      '$$m',
                    ],
                  },
                },
              },
            },
          },
        ],
        { session, new: true }
      );

      if (!updatedPlan) {
        throw new ApiError(409, 'Sisa porsi menu ini tidak mencukupi', [
          {
            field: 'quantitySold',
            message: 'Stok berubah oleh transaksi lain, silakan cek ulang sisa porsi',
          },
        ]);
      }

      const updatedMenu = updatedPlan.menus.find((m) => String(m.menuId) === String(menuId));

      const [sale] = await PlanSale.create(
        [
          {
            planId,
            menuId,
            menuName: planMenu.frozenMenuName,
            quantitySold,
            originalPrice,
            priceUsed,
            discountApplied,
            discountPercentage,
            cashierName,
            soldAt: now,
          },
        ],
        { session }
      );

      response = {
        _id: sale._id,
        planId: sale.planId,
        menuId: sale.menuId,
        menuName: sale.menuName,
        quantitySold: sale.quantitySold,
        originalPrice: sale.originalPrice,
        priceUsed: sale.priceUsed,
        discountApplied: sale.discountApplied,
        discountPercentage: sale.discountPercentage,
        cashierName: sale.cashierName,
        soldAt: sale.soldAt,
        remainingQuantity: Math.max(
          0,
          updatedMenu.quantityPlanned - updatedMenu.soldQuantity - updatedMenu.lossQuantity
        ),
      };
    });
    return response;
  } finally {
    session.endSession();
  }
}

// --- B3: Riwayat penjualan (rekonsiliasi shift) ---------------------------

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

  // menuName sudah tersimpan di tiap PlanSale (snapshot) -- tidak perlu
  // live-join ke Menu lagi sama sekali.
  const sales = await PlanSale.find(filter).sort({ soldAt: -1 });

  const data = sales.map((s) => ({
    _id: s._id,
    menuId: s.menuId,
    menuName: s.menuName,
    quantitySold: s.quantitySold,
    originalPrice: s.originalPrice,
    priceUsed: s.priceUsed,
    discountApplied: s.discountApplied,
    discountPercentage: s.discountPercentage,
    cashierName: s.cashierName,
    soldAt: s.soldAt,
  }));

  const totalTransaction = sales.length;
  const totalRevenue = sales.reduce((sum, s) => sum + s.priceUsed * s.quantitySold, 0);
  const totalDiscountGiven = sales.reduce(
    (sum, s) => sum + s.quantitySold * (s.originalPrice - s.priceUsed),
    0
  );

  return {
    data,
    summary: { totalTransaction, totalRevenue, totalDiscountGiven },
  };
}

module.exports = {
  getActivePlans,
  createSale,
  getSaleHistory,
};
