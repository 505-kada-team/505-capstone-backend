const express = require('express');
const { getDailyDashboard } = require('../controllers/dashboard.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const dashboardValidation = require('../validations/dashboard.validation');

const router = express.Router();

router.use(authenticate);

router.get(
  '/plan/:planId/daily',
  validate(dashboardValidation.getDailyDashboard),
  getDailyDashboard
);

module.exports = router;