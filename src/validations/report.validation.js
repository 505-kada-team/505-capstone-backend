const Joi = require('joi');

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message('"{{#label}}" harus berupa ObjectId yang valid');

const createReport = {
  body: Joi.object({
    planId: objectId.required(),
    category: Joi.string().valid('ingredient', 'menu').required(),
    refId: objectId.required(),
    quantityLost: Joi.number().min(0).required(),
    incidentAt: Joi.date().iso().required(),
    reason: Joi.string().trim().max(500).required(),
    // reportedBy/reportedByRole SENGAJA TIDAK ADA di sini -- diambil
    // controller dari req.user (hasil authenticate()), pola sama persis
    // dengan cashierName di Selling. stripUnknown: true akan membuang
    // diam-diam kalau FE masih mengirimnya di body.
  }),
};

const listReports = {
  query: Joi.object({
    planId: objectId,
    status: Joi.string().valid('pending', 'approved', 'rejected'),
    category: Joi.string().valid('ingredient', 'menu'),
  }),
};

const reviewReport = {
  params: Joi.object({
    id: objectId.required(),
  }),
  body: Joi.object({
    decision: Joi.string().valid('approved', 'rejected').required(),
    adminNote: Joi.string().trim().max(500).allow(null, '').default(null),
  }),
};

const addInventoryReplacement = {
  params: Joi.object({
    id: objectId.required(),
  }),
  body: Joi.object({
    replacementQuantity: Joi.number().min(0),
    availableUntil: Joi.date().iso(),
    varianceNote: Joi.string().trim().max(500).allow(null, '').default(null),
  }),
};

module.exports = {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
};
