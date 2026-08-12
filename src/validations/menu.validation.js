const Joi = require('joi');

const objectId = () =>
  Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .message('must be a valid ObjectId');

const ingredientSchema = Joi.object({
  inventoryId: objectId().required(),
  quantityNeeded: Joi.number().greater(0).required(),
});

const createMenu = {
  body: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().allow('').max(500),
    image: Joi.string().uri().allow(null, ''),
    sellingPrice: Joi.number().greater(0).required(),
    ingredients: Joi.array().items(ingredientSchema).min(1).required(),
  }),
};

const getMenus = {
  query: Joi.object({
    search: Joi.string().allow(''),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    includeDeleted: Joi.boolean(),
  }),
};

const getMenuById = {
  params: Joi.object({
    id: objectId().required(),
  }),
};

const updateMenu = {
  params: Joi.object({
    id: objectId().required(),
  }),
  // All fields optional — only what's sent gets changed. `ingredients`,
  // when sent, is still treated as a full replace at the service layer.
  body: Joi.object({
    name: Joi.string().min(1).max(100),
    description: Joi.string().allow('').max(500),
    image: Joi.string().uri().allow(null, ''),
    sellingPrice: Joi.number().greater(0),
    ingredients: Joi.array().items(ingredientSchema).min(1),
  }).min(1),
};

const deleteMenu = {
  params: Joi.object({
    id: objectId().required(),
  }),
};

const getMenuDropdown = {
  query: Joi.object({
    search: Joi.string().allow(''),
  }),
};

module.exports = {
  createMenu,
  getMenus,
  getMenuById,
  updateMenu,
  deleteMenu,
  getMenuDropdown,
};
