const express = require('express');
const { getActivePlans, createSale, getSaleHistory } = require('../controllers/selling.controller');
const validate = require('../middlewares/validate.middleware');
const sellingValidation = require('../validations/selling.validation');

const router = express.Router();

// --- Selling (Production Plan sales) ---
router.get('/plans', getActivePlans);
router.post('/sales', validate(sellingValidation.createSale), createSale);
router.get('/sales/history', validate(sellingValidation.getSaleHistory), getSaleHistory);

module.exports = router;
