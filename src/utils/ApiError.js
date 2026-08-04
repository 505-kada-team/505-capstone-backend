/**
 * Custom error class supaya semua error operasional (yang sengaja kita lempar)
 * punya bentuk yang konsisten: statusCode + message + optional details.
 *
 * Contoh pemakaian di service/controller:
 *   throw new ApiError(404, 'User tidak ditemukan');
 *   throw new ApiError(400, 'Validasi gagal', validationErrors);
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message - error message safe for client display
   * @param {object} [opts] - options
   * @param {string} [opts.code] - machine-readable error code (e.g. INVALID_CREDENTIALS)
   * @param {any} [opts.details] - additional detail, e.g. validation error array
   * @param {boolean} [opts.isOperational] - true for expected/throwaway errors,
   *   false for unexpected bugs that should be logged as incidents
   */
  constructor(statusCode, message, { code, details, isOperational = true } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || undefined;
    this.details = details || undefined;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
