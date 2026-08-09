const Joi = require('joi');

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message('"{{#label}}" harus berupa ObjectId yang valid');

const createReport = {
  body: Joi.object({
    planId: objectId.required(),
    category: Joi.string().valid('ingredient', 'menu').required(),
    refId: objectId.required(),
    // quantityLost TIDAK dipaksa integer -- kategori ingredient bisa
    // pecahan (mis. 200.5 gram), kategori menu logisnya bulat tapi tidak
    // ada aturan tegas dari RFC. Dibedakan lewat .when() supaya category:
    // menu tetap dijaga bulat tanpa mengunci ingredient.
    quantityLost: Joi.number()
      .positive()
      .required()
      .when('category', { is: 'menu', then: Joi.number().integer() }),
    incidentAt: Joi.date().iso().required(),
    reason: Joi.string().trim().min(1).max(500).required(),
    // reportedBy & reportedByRole SENGAJA TIDAK ADA di sini -- diambil
    // server-side dari req.user (auth), bukan input klien. Perluasan dari
    // keputusan cashierName di Selling (#12): jangan percaya klien
    // menentukan role sendiri (implikasi keamanan -- auto-approve C1
    // tergantung reportedByRole).
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
    adminNote: Joi.string().trim().max(500).allow(''),
  }),
};

const addInventoryReplacement = {
  params: Joi.object({
    id: objectId.required(),
  }),
  body: Joi.object({
    // Positive, bukan integer -- replacementQuantity bahan baku bisa
    // pecahan (gram/kg), sama seperti quantityLost kategori ingredient.
    replacementQuantity: Joi.number().positive(),
    availableUntil: Joi.date().iso(),
    varianceNote: Joi.string().trim().max(500).allow(null, ''),
  }),
};

module.exports = {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
};
