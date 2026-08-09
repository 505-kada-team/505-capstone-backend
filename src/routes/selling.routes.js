const express = require('express');
const { getActivePlans, createSale, getSaleHistory } = require('../controllers/selling.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const sellingValidation = require('../validations/selling.validation');

const router = express.Router();

// Seluruh endpoint Selling diakses user yang sudah login (Kasir & Admin) --
// authenticate() juga yang menyuplai req.user.name untuk cashierName di B2.
router.use(authenticate);

// B1
router.get('/active', getActivePlans);

// B2
router.post('/', validate(sellingValidation.createSale), createSale);

// B3
router.get('/history', validate(sellingValidation.getSaleHistory), getSaleHistory);

module.exports = router;
