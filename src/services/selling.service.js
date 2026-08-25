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
//
// Cerita singkat sebelum baca ke bawah:
//
// Kita bikin "session" dulu -- anggap ini kayak buka jalur telepon
// khusus ke database, belum ngobrolin apa-apa, cuma nyambungin dulu.
//
// Terus kita pakai session.withTransaction(...) dan kasih dia satu
// "paket pekerjaan" (function di dalamnya). withTransaction ini yang
// bakal ngurusin: "mulai kerjaan", terus kalau semua lancar dia
// "simpen permanen", kalau ada yang salah dia "batalin semua", dan
// khusus buat gangguan sementara (network kedip, ada yang lagi rebutan
// data yang sama) dia bakal "coba ulang dari awal" sendiri tanpa kita
// suruh. Makanya kamu gak bakal nemu kode manual kayak
// startTransaction()/commitTransaction()/abortTransaction() -- itu
// semua udah "dibungkus" di dalam withTransaction.
//
// Di paling luar, kita bungkus semuanya dengan try...finally (bukan
// try...catch ya, sengaja gak ada catch). finally itu janjinya:
// "apapun yang terjadi di dalam try -- lancar atau ada yang salah --
// baris di finally PASTI dijalanin". Kita pakai itu buat nutup jalur
// telepon tadi (session.endSession()), supaya jalur itu gak nyangkut
// kebuka terus. Errornya sendiri sengaja kita biarin "lewat" ke orang
// yang manggil fungsi ini (controller), bukan kita tangani di sini.

async function createSale({ planId, items, cashierName }) {
  // Sebelum apa-apa, kita cek dulu hal-hal yang sama sekali gak perlu
  // nanya ke database -- cukup ngecek apa yang dikirim orangnya aja.
  // Kalau ada yang aneh dari sini, ngapain repot-repot buka jalur
  // telepon ke database dulu, kan? Makanya ini ditaruh sebelum sesi
  // dibuka.
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

  // Nah, baru di sini kita buka jalur teleponnya. Tapi ingat -- ini
  // BARU buka jalur, belum ada obrolan transaksi apapun yang dimulai.
  const session = await mongoose.startSession();

  try {
    // Variabel ini kita taruh di luar, supaya nanti hasil kerjaan yang
    // kita simpan di dalam "paket pekerjaan" (callback withTransaction)
    // masih bisa kita pakai/kembalikan setelah paket itu selesai.
    let response;

    await session.withTransaction(async () => {
      // ======================================================================
      // Kita sekarang ada DI DALAM percobaan transaksi. Ingat baik-baik:
      // kalau nanti di tengah jalan ketemu "tabrakan" sama transaksi lain
      // (dijelaskan lebih detail di bawah), SEMUA yang ada di dalam sini
      // bakal DIULANG DARI ATAS lagi -- bukan cuma bagian yang tabrakan
      // doang. Itu sebabnya kita ambil data plan-nya DI DALAM SINI, bukan
      // di luar -- soalnya kalau diulang, kita mau lihat data yang paling
      // baru, bukan data basi dari percobaan sebelumnya.
      // ======================================================================

      // Pertama-tama, ambil dulu plan-nya. Kalau gak ketemu, atau
      // ternyata plan-nya bukan lagi berstatus "active", ya berarti
      // memang gak bisa jualan dari plan ini -- langsung stop.
      const plan = await ProductionPlan.findOne({ _id: planId, status: 'active' }).session(session);
      if (!plan) throw new ApiError(404, 'Plan tidak ditemukan atau bukan berstatus active');
      // Error kayak gini itu murni soal "aturan bisnis", bukan gangguan
      // teknis -- jadi withTransaction TIDAK akan coba ulang. Dia
      // langsung batalin semuanya dan lempar error ini apa adanya ke
      // yang manggil createSale().

      // Cek juga: sekarang udah masuk masa berlaku plan ini belum, atau
      // jangan-jangan udah lewat.
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

      // Sekarang kita siapin data harga untuk tiap item yang dipesan.
      // Untuk tiap item: cari menunya di plan, cek sisanya masih cukup
      // gak, terus hitung harganya.
      //
      // PENTING dicatat: cek "sisa cukup atau enggak" di sini itu masih
      // versi "kira-kira" -- kita cuma lihat data plan yang barusan kita
      // baca tadi. Bisa aja sebenarnya, sepersekian detik kemudian, ada
      // orang lain yang juga lagi beli menu yang sama dan bikin stok
      // berubah. Cek yang BENERAN final nanti ada di stockGuardExpr,
      // yang dijalankan langsung sama MongoDB pas nulis data -- itu
      // baru gak bisa disela siapapun. Cek di sini fungsinya cuma buat
      // kasih tau lebih cepat kalau memang udah jelas-jelas kurang.
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

        // Harganya diambil pakai harga yang udah "dibekukan" sejak plan
        // ini di-approve dulu (frozenSellingPrice) -- jadi kalau
        // ternyata harga menu aslinya diubah-ubah admin belakangan,
        // gak bakal ngaruh ke transaksi yang lagi berjalan di plan ini.
        // Diskon juga sama, dicek apa lagi aktif atau enggak.
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

      // ======================================================================
      // Nah, bagian ini yang keliatan paling ribet -- tapi sebenarnya
      // kita cuma lagi NYUSUN INSTRUKSI, belum ngobrol apa-apa ke
      // database. Bayangin kita lagi nulis "resep" yang nanti bakal kita
      // kasih ke MongoDB, dan MongoDB sendiri yang bakal "masak" resep
      // itu -- ngitung sekaligus nyimpen hasilnya, dalam satu gerakan
      // yang gak bisa disela siapapun. Makanya bahasanya beda dari
      // JavaScript biasa (banyak $), soalnya ini "bahasa" MongoDB.
      // ======================================================================

      // stockGuardExpr -- ini pertanyaan sederhana sebenarnya:
      // "Cari menu di plan.menus yang menuId-nya cocok dengan yang
      // dipesan. Kalau ketemu, cek: apakah (quantityPlanned -
      // soldQuantity - lossQuantity) masih >= jumlah yang mau dibeli?
      // Kalau SEMUA item dalam transaksi ini lolos cek itu, baru boleh
      // lanjut." Ini yang jadi "penjaga gerbang" sungguhan -- dievaluasi
      // MongoDB sendiri pas dia lagi nulis data, jadi gak ada celah
      // waktu buat disalip transaksi lain.
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

      // menuUpdateBranches -- kalau penjagaan di atas lolos, ini
      // instruksi buat "kalau ketemu menu yang cocok, tambahin
      // soldQuantity-nya sebanyak yang dibeli. Terus kalau ternyata
      // abis (sisa jadi nol), catat jam segini sebagai waktu abisnya."
      // Menu yang gak dibeli di transaksi ini ya dibiarin aja apa
      // adanya.
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

      // itemsForFefo -- ini masih JavaScript biasa, belum nyentuh
      // database. Kita cuma lagi nyiapin: "oke, buat tiap item yang
      // dipesan, berapa total bahan mentah yang dibutuhin?" Resepnya
      // diambil dari frozenRecipe (resep yang udah dibekukan pas
      // approve), bukan resep menu yang sekarang, biar konsisten.
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

      // fefoWalkOneIngredient -- ini jantungnya logika FEFO (bahan yang
      // lebih cepat kadaluarsa, dihabiskan duluan). Ceritanya begini,
      // untuk SATU jenis bahan:
      //
      //   1. Urutkan semua batch bahan ini dari yang paling cepat
      //      kadaluarsa.
      //   2. Jalan satu-satu dari batch paling depan:
      //      - Ambil sebanyak mungkin dari batch ini, tapi jangan lebih
      //        dari sisa kebutuhan kita, DAN jangan lebih dari sisa
      //        stok batch itu sendiri (mana yang lebih kecil, itu yang
      //        diambil).
      //      - Kurangi kebutuhan kita sebesar yang barusan diambil.
      //      - Kurangi juga stok batch itu sebesar yang barusan diambil.
      //      - Catat: "dari batch ini, kita ambil sekian."
      //   3. Lanjut ke batch berikutnya, ulangi, sampai kebutuhan
      //      terpenuhi atau batch-batchnya abis semua.
      //
      // Kalau di akhir ternyata masih ada sisa kebutuhan yang belum
      // kepenuhi (batch-batchnya udah abis semua tapi kebutuhan masih
      // ada), itu artinya bahan fisiknya beneran kurang -- angka sisa
      // itu yang nanti disebut "shortfall".
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
                    // Cuma dicatat kalau beneran ada yang kita ambil
                    // dari batch ini -- biar gak numpuk catatan kosong
                    // buat batch yang gak kesentuh sama sekali.
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

      // applyItemToCommittedIngredients -- satu item menu (misal Nasi
      // Goreng) biasanya butuh lebih dari 1 jenis bahan (beras, minyak,
      // bawang, dst). Fungsi ini yang menjalankan "cerita FEFO" di atas
      // untuk SETIAP bahan yang dibutuhin item ini, satu-satu, sambil
      // ngumpulin hasilnya jadi satu breakdown lengkap buat item ini.
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
                            // Kalau angka ini lebih dari 0, artinya
                            // walaupun porsi menunya lolos penjagaan
                            // tadi, bahan fisiknya ternyata gak cukup --
                            // mungkin ada yang hilang/rusak dan belum
                            // dilaporkan.
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

      // fefoReduceExpr -- ini level paling luar. Kalau transaksinya
      // beli beberapa menu sekaligus (misal 2 Nasi Goreng + 1 Es Teh),
      // ini yang menjalankan "cerita" di atas untuk SETIAP item
      // pesanan, satu-satu secara berurutan -- sambil terus
      // ngumpulin sisa stok bahan yang udah ke-update, supaya item
      // kedua ngitung sisa stok SETELAH item pertama udah "ambil
      // jatah"-nya duluan. Ini penting biar gak ada bahan yang
      // "dihitung dua kali" buat dua item berbeda.
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

      // ======================================================================
      // Nah, ini baru beneran kita "telepon" MongoDB dan minta dia
      // jalanin semua resep di atas -- ini WRITE PERTAMA yang beneran
      // dikirim ke database dalam transaksi ini.
      //
      // MongoDB bakal cari dokumen plan-nya, cek penjagaan
      // (stockGuardExpr), dan kalau lolos, langsung eksekusi semua
      // "resep" update-nya -- semua dalam SATU GERAKAN yang gak bisa
      // disela.
      //
      // Ada dua hal yang mungkin terjadi:
      //
      // Kemungkinan 1: MongoDB SEMPAT ngecek, tapi ternyata gak ada
      // dokumen yang cocok (mungkin stoknya udah berubah, atau plan-nya
      // udah bukan "active" lagi). Ini bukan error dari MongoDB --
      // jawabannya cuma "gak nemu apa-apa" (null). Kita sendiri yang
      // memutuskan ini jadi error 409 di bawah.
      //
      // Kemungkinan 2: MongoDB BELUM SEMPAT ngecek apa-apa, karena pas
      // dia mau mulai nulis, ternyata dokumen yang sama lagi "dipegang"
      // sama transaksi lain yang belum kelar. Ini baru beneran error
      // dari MongoDB (disebut write conflict) -- dan ini jenis error
      // "coba lagi", jadi withTransaction bakal otomatis ngulang
      // SEMUANYA dari paling atas (dari baris findOne plan tadi), biar
      // pas dicoba lagi, datanya udah yang paling baru.
      // ======================================================================
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
        // Ini kemungkinan 1 di atas tadi -- error bisnis biasa, TIDAK
        // dicoba ulang. Semuanya langsung dibatalkan dan error ini
        // dilempar apa adanya.
        throw new ApiError(409, 'Sisa porsi salah satu menu tidak mencukupi', [
          {
            field: 'items',
            message: 'Stok berubah oleh transaksi lain, silakan cek ulang sisa porsi',
          },
        ]);
      }

      // FIX: _pendingSaleAllocation itu field "titipan sementara" yang
      // gak terdaftar resmi di skema ProductionPlan -- makanya kalau
      // diakses langsung (updatedPlan._pendingSaleAllocation) hasilnya
      // selalu undefined, walau datanya beneran ada. Harus pakai .get()
      // buat baca langsung dari data mentahnya.
      const pendingSaleAllocation = updatedPlan.get('_pendingSaleAllocation') || [];

      // Sekarang kita cek: dari semua bahan yang barusan dipakai,
      // apakah ada yang kekurangan (shortfall > 0)? Ini kejadiannya
      // langka -- porsi menunya kelihatan cukup, tapi bahan mentahnya
      // ternyata gak cukup secara fisik.
      const shortfallItem = pendingSaleAllocation.find((b) =>
        b.ingredientsUsed.some((i) => i.shortfall > 0)
      );
      if (shortfallItem) {
        const bad = shortfallItem.ingredientsUsed.find((i) => i.shortfall > 0);
        // Sama kayak tadi -- ini keputusan bisnis, bukan gangguan
        // teknis. Perhatikan: walaupun findOneAndUpdate di atas udah
        // "kepalang" nulis data, karena kita throw di sini SEBELUM
        // transaksinya di-commit, withTransaction bakal batalin SEMUA
        // yang udah "dicoba" tulis tadi -- dokumen plan-nya balik lagi
        // seperti semula, gak ada perubahan setengah-setengah yang
        // ketinggalan.
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

      // WRITE KEDUA -- bersih-bersih, buang field titipan sementara
      // tadi biar gak nyangkut permanen di dokumen plan-nya.
      await ProductionPlan.updateOne(
        { _id: planId },
        { $unset: { _pendingSaleAllocation: '' } },
        { session }
      );

      const finalPricedItems = pricedItems.map((item) => ({
        ...item,
        ingredientsUsed: breakdownByMenuId.get(String(item.menuId)) || [],
      }));

      // WRITE KETIGA -- ini baru catat struknya, di koleksi yang beda
      // (PlanSale, bukan ProductionPlan). Tetap kita kasih { session }
      // yang sama, supaya kalau baris ini gagal, dua write sebelumnya
      // ikut dibatalkan juga -- bukan cuma yang ini doang.
      const [transaction] = await PlanSale.create(
        [{ planId, cashierName, soldAt: now, items: finalPricedItems }],
        { session }
      );

      const updatedMenuMap = new Map(updatedPlan.menus.map((m) => [String(m.menuId), m]));

      // Susun jawaban yang bakal dibalikin ke pemanggil. Ini murni
      // JavaScript, gak nyentuh database lagi. Kita simpen ke variabel
      // `response` yang tadi kita siapin di luar, biar masih kepake
      // setelah "paket pekerjaan" ini kelar.
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

      // Sampai sini tanpa ada yang "throw", artinya paket pekerjaan
      // kita selesai dengan mulus. withTransaction bakal nyimpen
      // semuanya secara permanen (commit) -- ketiga write di atas jadi
      // kelihatan ke luar secara bersamaan, seolah terjadi dalam satu
      // kedipan mata. Kalaupun proses nyimpen ini sendiri gagal karena
      // gangguan (misal koneksi putus pas lagi nyimpen), withTransaction
      // bakal coba ulang lagi dari paling atas, sama kayak kasus
      // tabrakan data tadi.
    });

    return response;
  } finally {
    // Baris ini dijamin selalu jalan, apapun yang terjadi di atas --
    // baik semuanya lancar, baik ada error bisnis yang dilempar setelah
    // semua percobaan ulang habis, atau error lain yang gak terduga.
    // Ini murni soal nutup jalur telepon yang kita buka di awal tadi,
    // biar gak nyangkut kebuka terus. Errornya sendiri kita biarin
    // "lewat" ke yang manggil createSale(), supaya bisa dibalas sebagai
    // pesan error yang sesuai ke pengguna.
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
