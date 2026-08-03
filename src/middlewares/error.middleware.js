const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/* eslint-disable no-unused-vars */
const errorHandler = (err, req, res, next) => {
  let error = err;

  // Kalau error bukan instance ApiError (misal dari mongoose/library lain),
  // convert dulu jadi ApiError supaya format response tetap konsisten.
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, null, false);
  }

  // Mongoose duplicate key error.
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    error = new ApiError(409, `${field} sudah terdaftar, gunakan yang lain`);
  }

  // Mongoose validation error.
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    error = new ApiError(400, 'Validasi gagal', messages);
  }

  // JWT error (siap dipakai begitu modul Authentication ditambahkan).
  if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Token tidak valid');
  }
  if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Token sudah kedaluwarsa');
  }

  if (!error.isOperational || error.statusCode >= 500) {
    logger.error(err.stack || err.message);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    details: error.details || undefined,
    // Stack trace hanya muncul di development, jangan bocor ke production.
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = errorHandler;
