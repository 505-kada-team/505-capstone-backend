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
    error = new ApiError(statusCode, message, { isOperational: false });
  }

  // Mongoose duplicate key error.
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    error = new ApiError(409, `${field} already in use`, { code: 'DUPLICATE_FIELD' });
  }

  // Mongoose validation error.
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    error = new ApiError(400, 'Validation failed', { code: 'VALIDATION_ERROR', details: messages });
  }

  // Mongoose CastError (invalid ObjectId).
  if (err.name === 'CastError') {
    error = new ApiError(400, 'Invalid identifier', { code: 'INVALID_ID' });
  }

  // JWT error (siap dipakai begitu modul Authentication ditambahkan).
  if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Token is invalid', { code: 'TOKEN_INVALID' });
  }
  if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Token has expired', { code: 'TOKEN_EXPIRED' });
  }

  if (!error.isOperational || error.statusCode >= 500) {
    logger.error(err.stack || err.message);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    // FIX: previously fell back to 'INTERNAL_ERROR' for ANY error missing an
    // explicit `code`, regardless of statusCode — so a well-formed 409/404
    // ApiError with no `code` set (e.g. reverseDeduct's "reference not found")
    // was mislabeled as an internal/500-class error in the response body,
    // even though the actual HTTP status was already correct.
    // Only unclassified 5xx errors should read as INTERNAL_ERROR; anything
    // 4xx without an explicit code is just a generic client-facing ERROR.
    code: error.code || ((error.statusCode || 500) >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
    details: error.details || undefined,
    // Stack trace hanya muncul di development, jangan bocor ke production.
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = errorHandler;
