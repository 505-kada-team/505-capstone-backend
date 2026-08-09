const express = require('express');
const authRoutes = require('./auth.routes');
const inventoryRoutes = require('./inventory.routes');
const menuRoutes = require('./menu.routes');
const planRoutes = require('./plan.routes');
const sellingRoutes = require('./selling.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/', inventoryRoutes);
router.use('/menu', menuRoutes);
router.use('/plan', planRoutes);
router.use('/selling', sellingRoutes);

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

module.exports = router;
