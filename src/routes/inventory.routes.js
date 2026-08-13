const express = require('express');
const {
  createInventory,
  listInventory,
  dropdownInventory,
  getInventoryDetail,
  updateInventory,
  deleteInventory,
  addSubInventory,
  listSubInventory,
  deleteSubInventory,
  listHistorySubInventory,
  checkAvailability,
  deduct,
  reverseDeduct,
  listHistoryUsage,
} = require('../controllers/inventory.controller');
const validate = require('../middlewares/validate.middleware');
const inventoryValidation = require('../validations/inventory.validation');

const router = express.Router();

// --- Inventory (item card) ---
router.post('/inventory', validate(inventoryValidation.createInventory), createInventory);
router.get('/inventory', validate(inventoryValidation.listInventoryQuery, 'query'), listInventory);
router.get('/inventory/dropdown', dropdownInventory);
router.get('/inventory/:id', validate(inventoryValidation.idParam, 'params'), getInventoryDetail);
router.put(
  '/inventory/:id',
  validate(inventoryValidation.idParam, 'params'),
  validate(inventoryValidation.updateInventory),
  updateInventory
);
router.delete('/inventory/:id', validate(inventoryValidation.idParam, 'params'), deleteInventory);

// --- SubInventory (batch) ---
router.post(
  '/inventory/:id/subinventory',
  validate(inventoryValidation.idParam, 'params'),
  validate(inventoryValidation.addSubInventory),
  addSubInventory
);
router.get(
  '/inventory/:id/subinventory',
  validate(inventoryValidation.idParam, 'params'),
  listSubInventory
);
router.delete(
  '/subinventory/:id',
  validate(inventoryValidation.idParam, 'params'),
  deleteSubInventory
);

// --- Logs ---
router.get(
  '/history-sub-inventory',
  validate(inventoryValidation.historyQuery, 'query'),
  listHistorySubInventory
);
router.get('/history-usage', validate(inventoryValidation.historyQuery, 'query'), listHistoryUsage);

// --- FEFO ---
router.post(
  '/subinventory/check-availability',
  validate(inventoryValidation.checkAvailability),
  checkAvailability
);
router.post('/subinventory/deduct', validate(inventoryValidation.deduct), deduct);
router.post(
  '/subinventory/deduct/reverse',
  validate(inventoryValidation.reverseDeduct),
  reverseDeduct
);

module.exports = router;
