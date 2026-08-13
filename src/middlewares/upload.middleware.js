const multer = require('multer');
const ApiError = require('../utils/ApiError');

const storage = multer.memoryStorage(); // buffer di-stream langsung ke Cloudinary, no disk write

const fileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new ApiError(400, 'File harus berupa gambar (jpg/png/webp/dll)'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// Wrapper supaya error multer (LIMIT_FILE_SIZE, dll) masuk ke error
// handler global sebagai ApiError yang konsisten, bukan raw MulterError.
function uploadSingleImage(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(400, 'Ukuran gambar maksimal 2MB'));
        }
        return next(new ApiError(400, err.message));
      }
      if (err) return next(err); // termasuk ApiError dari fileFilter
      next();
    });
  };
}

// Body multipart/form-data selalu string — field JSON (ingredients) perlu
// di-parse manual sebelum masuk ke validate.middleware, kalau tidak Joi
// bakal nolak karena expect array tapi dapet string.
function parseJsonFields(...fields) {
  return (req, res, next) => {
    for (const field of fields) {
      if (typeof req.body[field] === 'string') {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch {
          return next(new ApiError(400, `Field '${field}' harus berupa JSON array yang valid`));
        }
      }
    }
    next();
  };
}

module.exports = { uploadSingleImage, parseJsonFields };
