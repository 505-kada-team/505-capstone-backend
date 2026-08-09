const express = require('express');
const {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
} = require('../controllers/report.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const planReportValidation = require('../validations/report.validation');

const router = express.Router();

// PERLU DIKONFIRMASI: `authorize` di sini adalah TEBAKAN nama middleware --
// saya belum pernah lihat file auth.middleware.js aslinya, cuma tahu
// `authenticate` dari selling.routes.js. Kalau middleware role-check di
// codebase ini bernama beda (mis. `requireRole`, `checkRole`, atau field
// role-nya bukan req.user.role), baris authorize(...) di bawah perlu
// disesuaikan.
router.use(authenticate);

// C1 -- Kasir & Admin
router.post('/', validate(planReportValidation.createReport), createReport);

// C2 -- Admin saja
router.get('/', authorize('admin'), validate(planReportValidation.listReports), listReports);

// C3 -- Admin saja
router.put(
  '/:id/review',
  authorize('admin'),
  validate(planReportValidation.reviewReport),
  reviewReport
);

// C4 -- Admin saja
router.post(
  '/:id/add-inventory',
  authorize('admin'),
  validate(planReportValidation.addInventoryReplacement),
  addInventoryReplacement
);

module.exports = router;
