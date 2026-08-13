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
   * @param {string} message - pesan error yang aman ditampilkan ke client
   * @param {any} [details] - detail tambahan, misal array pesan validasi
   * @param {boolean} [isOperational] - true kalau error yang diprediksi/disengaja,
   *   false kalau error tak terduga (bug/library) yang perlu dicatat sebagai insiden
   */
  constructor(statusCode, message, details = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
