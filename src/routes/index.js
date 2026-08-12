const express = require('express');
const authRoutes = require('./auth.routes');
const inventoryRoutes = require('./inventory.routes');
const menuRoutes = require('./menu.routes');
const planRoutes = require('./plan.routes');
const sellingRoutes = require('./selling.routes');
const reportRoutes = require('./report.routes');
const dashboardRoutes = require('./dashboard.routes');
const predictionRoutes = require('./prediction.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/', inventoryRoutes);
router.use('/menu', menuRoutes);
router.use('/plan', planRoutes);
router.use('/selling', sellingRoutes);
router.use('/plan-reports', reportRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/predictions', predictionRoutes);

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

module.exports = router;
