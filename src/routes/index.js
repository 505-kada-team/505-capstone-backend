const express = require('express');

const router = express.Router();

// Daftarkan route domain di sini seiring fitur ditambahkan, contoh:
//   const authRoutes = require('./auth.routes');
//   router.use('/auth', authRoutes);

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

module.exports = router;
