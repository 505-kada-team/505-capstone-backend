const mongoose = require('mongoose');
const ProductionPlan = require('../models/plan/productionPlan.model');
const PlanSale = require('../models/selling/selling.model');
const ApiError = require('../utils/ApiError');
const menuService = require('./menu.service');
const { computePricing } = require('../utils/planCompute');

// ---------------------------------------------------------------------------
// Prinsip modul ini (RFC §1): HANYA baca ProductionPlan (status/tanggal/
// harga) dan HANYA tulis PlanSale + menus[].soldQuantity/soldOutAt. Tidak
// pernah menyentuh Inventory, ProductionPlan.status, atau menus[].discount.
//
// Harga dihitung via computePricing() -- fungsi YANG SAMA dipakai Production
// Plan module -- supaya tidak ada metodologi harga kedua yang berjalan
// paralel (prinsip sama seperti Menu.currentCostEstimate reuse). Untuk plan
// yang sudah `active`, computePricing() selalu mengembalikan
// effectiveSellingPrice = frozenSellingPrice (dibekukan saat approve),
// BUKAN Menu.sellingPrice live -- lihat catatan konflik RFC.
// ---------------------------------------------------------------------------

// --- B1: List plan aktif + sisa stok + harga berlaku per menu -------------

async function getActivePlans() {
  const now = new Date();

  // Lazy-check completed, pola sama dengan Production Plan module (endDate
  // sudah lewat -> completed). Bulk update dulu supaya query 'active' di
  // bawah sudah bersih -- lebih murah daripada lazy-check per dokumen untuk
  // endpoint list.
  await ProductionPlan.updateMany(
    { status: 'active', endDate: { $lt: now } },
    { $set: { status: 'completed', completedAt: now } }
  );

  const plans = await ProductionPlan.find({ status: 'active' });
  if (plans.length === 0) return [];

  const menuIds = [...new Set(plans.flatMap((p) => p.menus.map((m) => String(m.menuId))))];
  const menuDocs = await menuService.getMenusByIds(menuIds);
  const menuDocsById = new Map(menuDocs.map((m) => [String(m._id), m]));

  return plans.map((plan) => {
    const sellable = now >= plan.startDate && now <= plan.endDate;

    const menus = plan.menus.map((m) => {
      const menuDoc = menuDocsById.get(String(m.menuId));
      const { effectiveSellingPrice, discountedPrice, discountStatus } = computePricing(
        m,
        menuDoc,
        plan.status
      );
      const isDiscounted = discountStatus === 'active';
      const remainingQuantity = Math.max(0, m.quantityPlanned - m.soldQuantity - m.lossQuantity);

      return {
        menuId: m.menuId,
        name: menuDoc ? menuDoc.name : null,
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
      // Level PLAN, bukan per-menu -- lihat catatan ambiguitas RFC.
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

      // Pre-check cepat, pesan ramah -- bukan pengaman utama race condition
      // (itu ada di atomic guard saat write, di bawah).
      const remainingQuantity = Math.max(
        0,
        planMenu.quantityPlanned - planMenu.soldQuantity - planMenu.lossQuantity
      );
      if (quantitySold > remainingQuantity) {
        throw new ApiError(409, 'Sisa porsi menu ini tidak mencukupi', [
          { field: 'quantitySold', message: `Sisa ${remainingQuantity}, diminta ${quantitySold}` },
        ]);
      }

      // Harga dihitung SEKARANG, di dalam transaction yang sama dengan
      // baca/tulis stok -- RFC §5.2/D6, mencegah celah antara admin hapus
      // diskon dan kasir mencatat sale di detik yang nyaris bersamaan.
      const { effectiveSellingPrice, discountedPrice, discountStatus } = computePricing(
        planMenu,
        null,
        plan.status
      );
      const discountApplied = discountStatus === 'active';
      const originalPrice = effectiveSellingPrice;
      const priceUsed = discountApplied ? discountedPrice : effectiveSellingPrice;
      const discountPercentage = discountApplied ? planMenu.discount.discountPercentage : null;

      // Atomic conditional update -- guard KEDUA di titik tulis (bukan cuma
      // pre-check di atas), pola sama dengan atomic deduct di Inventory
      // module. $expr di dalam $elemMatch membandingkan sisa stok TERBARU
      // (bukan hasil read di awal transaction ini) melawan quantitySold,
      // supaya dua kasir yang rebutan porsi terakhir di detik yang nyaris
      // bersamaan tidak bisa dua-duanya lolos.
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
                            // soldOutAt terisi kalau SETELAH increment ini
                            // sisa porsi = 0 DAN belum lewat endDate (RFC
                            // D4 -- Plan tetap active, cuma menu ini yang
                            // habis).
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
        // Stok berubah tepat di antara pre-check di atas dan write ini --
        // kasir lain lebih cepat. Bukan error input, murni race condition.
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

  const sales = await PlanSale.find(filter).sort({ soldAt: -1 });

  const menuIds = [...new Set(sales.map((s) => String(s.menuId)))];
  const menuDocs = menuIds.length ? await menuService.getMenusByIds(menuIds) : [];
  const menuNameById = new Map(menuDocs.map((m) => [String(m._id), m.name]));

  const data = sales.map((s) => ({
    _id: s._id,
    menuId: s.menuId,
    menuName: menuNameById.get(String(s.menuId)) || null,
    quantitySold: s.quantitySold,
    originalPrice: s.originalPrice,
    priceUsed: s.priceUsed,
    discountApplied: s.discountApplied,
    discountPercentage: s.discountPercentage,
    cashierName: s.cashierName,
    soldAt: s.soldAt,
  }));

  // Dihitung di response time (bukan field tersimpan) -- RFC §8 catatan B3.
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
