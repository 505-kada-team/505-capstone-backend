const Joi = require('joi');

const objectId = () =>
  Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .message('must be a valid ObjectId');

const menuInputSchema = Joi.object({
  menuId: objectId().required(),
  quantityPlanned: Joi.number().integer().greater(0).required(),
});

// --- A1: Create plan -------------------------------------------------------

const createPlan = {
  body: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    tags: Joi.array().items(Joi.string()).default([]),
    startDate: Joi.date().iso().required(),
    // duration 7-30 hari — samakan batasnya dengan productionPlanSchema
    // (model), supaya request yang jelas invalid ditolak di sini duluan,
    // bukan lolos ke Mongoose validation error yang kurang informatif.
    duration: Joi.number().integer().min(7).max(30).required(),
    menus: Joi.array().items(menuInputSchema).min(1).required(),
  }),
};

// --- A2: List plans ----------------------------------------------------

const listPlans = {
  query: Joi.object({
    status: Joi.string().valid('draft', 'active', 'completed', 'stopped', 'cancelled'),
    search: Joi.string().allow(''),
    // string comma-separated — service.js men-split manual (tags.split(','))
    // bukan array, jangan diubah ke Joi.array() tanpa menyesuaikan service.
    tags: Joi.string().allow(''),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

// --- A3: Get plan detail -------------------------------------------------

const getPlanById = {
  params: Joi.object({
    id: objectId().required(),
  }),
};

// --- A4: Update plan (draft only) ---------------------------------------

const updatePlan = {
  params: Joi.object({
    id: objectId().required(),
  }),
  // Semua field opsional — hanya yang dikirim yang berubah (pola sama
  // seperti updateMenu). `menus`, kalau dikirim, tetap full-replace di
  // service layer (bukan patch per-item).
  body: Joi.object({
    name: Joi.string().min(1).max(100),
    tags: Joi.array().items(Joi.string()),
    startDate: Joi.date().iso(),
    duration: Joi.number().integer().min(7).max(30),
    menus: Joi.array().items(menuInputSchema).min(1),
  }).min(1),
};

// --- A5: Refresh check-availability ---------------------------------------

const refreshAvailability = {
  params: Joi.object({
    id: objectId().required(),
  }),
};

// --- A6: Approve plan ------------------------------------------------------

const approvePlan = {
  params: Joi.object({
    id: objectId().required(),
  }),
  // Body opsional — actor pada umumnya diambil controller dari req.user
  // (hasil authenticate()). `actor` di body cuma fallback kalau controller
  // memang membaca dari sana; tidak wajib dikirim.
  body: Joi.object({
    actor: Joi.object({
      name: Joi.string(),
      id: Joi.string(),
    }),
  }),
};

// --- A7: Stop plan (active only) --------------------------------------

const stopPlan = {
  params: Joi.object({
    id: objectId().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(1).max(500).required(),
    stoppedBy: Joi.string().min(1).max(100).required(),
  }),
};

// --- A8: Cancel plan (draft only) ---------------------------------------

const cancelPlan = {
  params: Joi.object({
    id: objectId().required(),
  }),
};

// --- A9: Set/replace discount --------------------------------------------

const setDiscount = {
  params: Joi.object({
    id: objectId().required(),
    menuId: objectId().required(),
  }),
  body: Joi.object({
    discountPercentage: Joi.number().integer().min(1).max(100).required(),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().required(),
    reason: Joi.string().allow('').max(500),
  }),
};

// --- A10: Remove discount --------------------------------------------------

const removeDiscount = {
  params: Joi.object({
    id: objectId().required(),
    menuId: objectId().required(),
  }),
};

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
