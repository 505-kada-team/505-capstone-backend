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
const { uploadSingleImage, parseJsonFields } = require('../middlewares/upload.middleware');
const menuValidation = require('../validations/menu.validation');

const router = express.Router();

router.use(authenticate);

router.get('/dropdown', validate(menuValidation.getMenuDropdown), getMenuDropdown);

router
  .route('/')
  .post(
    uploadSingleImage('image'),
    parseJsonFields('ingredients'),
    validate(menuValidation.createMenu),
    createMenu
  )
  .get(validate(menuValidation.getMenus), getMenus);

router
  .route('/:id')
  .get(validate(menuValidation.getMenuById), getMenuById)
  .put(
    uploadSingleImage('image'),
    parseJsonFields('ingredients'),
    validate(menuValidation.updateMenu),
    updateMenu
  )
  .delete(validate(menuValidation.deleteMenu), deleteMenu);

module.exports = router;
