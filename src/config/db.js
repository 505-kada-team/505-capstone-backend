const mongoose = require('mongoose');

const { mongoUri } = require('./env');
const logger = require('../utils/logger');

/**
 * Buka koneksi ke MongoDB. Proses sengaja dihentikan (exit code 1) kalau
 * koneksi gagal di awal, supaya tidak ada server yang "hidup" tapi tidak
 * bisa akses database sama sekali.
 */
const connectDB = async () => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(mongoUri);
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
