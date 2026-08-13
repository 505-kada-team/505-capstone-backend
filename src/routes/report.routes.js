const express = require('express');
const {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
} = require('../controllers/report.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const planReportValidation = require('../validations/report.validation');

const router = express.Router();

// C1 bisa diakses Kasir & Admin, C2-C4 khusus Admin -- authenticate() saja
// sudah cukup untuk gating dasar (sama asumsi dengan plan.routes.js);
// authorize(role) tinggal disisipkan di C2/C3/C4 kalau project sudah
// punya middleware itu.
router.use(authenticate);

// C1
router.post('/', validate(planReportValidation.createReport), createReport);

// C2
router.get('/', validate(planReportValidation.listReports), listReports);

// C3
router.put('/:id/review', validate(planReportValidation.reviewReport), reviewReport);

// C4
router.post(
  '/:id/add-inventory',
  validate(planReportValidation.addInventoryReplacement),
  addInventoryReplacement
);

module.exports = router;
