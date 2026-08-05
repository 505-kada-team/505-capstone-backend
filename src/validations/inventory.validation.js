const Joi = require('joi');

const objectId = Joi.string().hex().length(24);

const createInventory = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  category: Joi.string().valid('ingredients', 'packaging').required(),
  unit: Joi.string().trim().min(1).max(30).required(),
  description: Joi.string().allow('').max(500).default(''),
  // itemCode is optional — auto-derived from name if omitted, but allowed
  // to be overridden (e.g. to avoid collisions like two items both -> "GUL").
  itemCode: Joi.string().trim().alphanum().min(2).max(6).uppercase().optional(),
});

const updateInventory = Joi.object({
  // category/unit are locked after creation per the flow doc — not accepted here.
  name: Joi.string().trim().min(1).max(120),
  description: Joi.string().allow('').max(500),
}).min(1);

const listInventoryQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  category: Joi.string().valid('ingredients', 'packaging'),
  search: Joi.string().allow(''),
  includeDeleted: Joi.boolean().default(false),
});

const idParam = Joi.object({
  id: objectId.required(),
});

const addSubInventory = Joi.object({
  quantity: Joi.number().positive().required(),
  costPrices: Joi.number().min(0).required(),
  inDate: Joi.date().default(() => new Date()),
  // required for ingredients, forced null for packaging — enforced in the service,
  // since that decision depends on the parent Inventory's category.
  expired: Joi.date().allow(null).optional(),
});

const historyQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  inventoryId: objectId,
  from: Joi.date(),
  to: Joi.date(),
});

const availabilityItem = Joi.object({
  inventoryId: objectId.required(),
  amountNeeded: Joi.number().positive().required(),
});

const checkAvailability = Joi.object({
  items: Joi.array().items(availabilityItem).min(1).required(),
  availableUntil: Joi.date().optional(), // omitted => no safety evaluation
});

const deduct = Joi.object({
  items: Joi.array().items(availabilityItem).min(1).required(),
  availableUntil: Joi.date().optional(),
  reference: Joi.string().trim().max(120).allow(null).default(null),
});

const reverseDeduct = Joi.object({
  reference: Joi.string().trim().max(120).required(),
});

module.exports = {
  createInventory,
  updateInventory,
  listInventoryQuery,
  idParam,
  addSubInventory,
  historyQuery,
  checkAvailability,
  deduct,
  reverseDeduct,
};
