const express = require('express');
const {
  createPlan,
  listPlans,
  getPlanById,
  updatePlan,
  refreshAvailability,
  approvePlan,
  stopPlan,
  cancelPlan,
  setDiscount,
  removeDiscount,
} = require('../controllers/plan.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const planValidation = require('../validations/plan.validation');

const router = express.Router();

// Seluruh endpoint Plan diakses admin — asumsi authenticate() sudah cukup
// untuk gating "Admin" di dokumen (role-check tambahan tinggal disisipkan
// di sini kalau project punya middleware authorize(role) terpisah).
router.use(authenticate);

// A1
router.post('/', validate(planValidation.createPlan), createPlan);

// A2
router.get('/', validate(planValidation.listPlans), listPlans);

// A3
router.get('/:id', validate(planValidation.getPlanById), getPlanById);

// A4
router.put('/:id', validate(planValidation.updatePlan), updatePlan);

// A5
router.post(
  '/:id/check-availability',
  validate(planValidation.refreshAvailability),
  refreshAvailability
);

// A6
router.post('/:id/approve', validate(planValidation.approvePlan), approvePlan);

// A7
router.post('/:id/stop', validate(planValidation.stopPlan), stopPlan);

// A8
router.delete('/:id', validate(planValidation.cancelPlan), cancelPlan);

// A9
router.put('/:id/menus/:menuId/discount', validate(planValidation.setDiscount), setDiscount);

// A10
router.delete(
  '/:id/menus/:menuId/discount',
  validate(planValidation.removeDiscount),
  removeDiscount
);

module.exports = router;
