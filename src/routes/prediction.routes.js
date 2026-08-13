const express = require('express');
const {getAssortmentPrediction} = require('../controllers/prediction.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const predictionValidation = require('../validations/prediction.validation');

const router = express.Router();

router.use(authenticate);

// --- ML Predictions ---
router.post(
  '/assortment',
  validate(predictionValidation.getAssortmentPrediction),
  getAssortmentPrediction
);

module.exports = router;