const Joi = require('joi');

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message('"{{#label}}" harus berupa ObjectId yang valid');

const createSale = {
  body: Joi.object({
    planId: objectId.required(),
    menuId: objectId.required(),
    quantitySold: Joi.number().integer().min(1).required(),
    // cashierName SENGAJA TIDAK ADA di sini -- diambil controller dari
    // req.user.name (hasil authenticate()), bukan input kasir. Karena
    // validate.middleware.js pakai stripUnknown: true, kalau FE masih
    // mengirim cashierName di body, field itu otomatis dibuang diam-diam
    // (bukan error) -- aman, tapi sebaiknya FE tidak lagi mengirimnya.
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
