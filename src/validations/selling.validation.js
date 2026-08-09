const Joi = require('joi');

// Kalau kamu sudah punya custom Joi extension untuk ObjectId (mis. via
// joi-objectid), ganti helper ini dengan itu supaya konsisten satu app.
const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message('"{{#label}}" harus berupa ObjectId yang valid');

const createSale = {
  body: Joi.object({
    planId: objectId.required(),
    menuId: objectId.required(),
    quantitySold: Joi.number().integer().min(1).required(),
    cashierName: Joi.string().trim().min(2).max(100).required(),
  }),
};

const getSaleHistory = {
  query: Joi.object({
    planId: objectId,
    date: Joi.date().iso(),
    cashierName: Joi.string().trim(),
  }),
};

module.exports = {
  createSale,
  getSaleHistory,
};
