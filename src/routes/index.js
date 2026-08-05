const express = require('express');
const authRoutes = require('./auth.routes');
const inventoryRoutes = require('./inventory.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/', inventoryRoutes);

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

module.exports = router;
