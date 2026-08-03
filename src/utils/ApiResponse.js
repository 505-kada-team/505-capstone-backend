/**
 * Helper supaya semua response sukses punya format seragam:
 *   { success: true, message, data, meta? }
 *
 * Contoh pemakaian di controller:
 *   return new ApiResponse(200, user, 'Berhasil mengambil data user').send(res);
 */
class ApiResponse {
  constructor(statusCode, data = null, message = 'Success', meta = null) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
    this.meta = meta;
  }

  send(res) {
    const body = {
      success: this.success,
      message: this.message,
      data: this.data,
    };

    if (this.meta) {
      body.meta = this.meta;
    }

    return res.status(this.statusCode).json(body);
  }
}

module.exports = ApiResponse;
