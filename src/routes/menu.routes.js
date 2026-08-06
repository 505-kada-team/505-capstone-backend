const express = require('express');
const {
  createMenu,
  getMenus,
  getMenuById,
  updateMenu,
  deleteMenu,
  getMenuDropdown,
} = require('../controllers/menu.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const menuValidation = require('../validations/menu.validation');

const router = express.Router();

router.use(authenticate);

// Static path registered before '/:id' so it doesn't get swallowed by the
// dynamic param route — same ordering used for Inventory's dropdown.
router.get('/dropdown', validate(menuValidation.getMenuDropdown), getMenuDropdown);

router
  .route('/')
  .post(validate(menuValidation.createMenu), createMenu)
  .get(validate(menuValidation.getMenus), getMenus);

router
  .route('/:id')
  .get(validate(menuValidation.getMenuById), getMenuById)
  .put(validate(menuValidation.updateMenu), updateMenu)
  .delete(validate(menuValidation.deleteMenu), deleteMenu);

module.exports = router;
