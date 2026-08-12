const ApiError = require('../utils/ApiError');

/**
 * Middleware generik untuk validasi request pakai Joi schema.
 * Dipakai per route begitu modul fitur (auth, inventory, dst) dan
 * validation schema-nya sudah dibuat, contoh:
 *
 *   router.post('/register', validate(authValidation.register), authController.register);
 *
 * `schema` berbentuk: { body?: JoiSchema, params?: JoiSchema, query?: JoiSchema }
 */
const validate = (schema) => (req, res, next) => {
  const targets = ['body', 'params', 'query'].filter((key) => schema[key]);
  const errors = [];

  targets.forEach((key) => {
    const { error, value } = schema[key].validate(req[key], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      errors.push(...error.details.map((detail) => detail.message));
    } else {
      if (key === 'query') {
        Object.keys(req.query).forEach((k) => delete req.query[k]);
        Object.assign(req.query, value);
      } else {
        req[key] = value;
      }
    }
  });

  if (errors.length > 0) {
    return next(
      new ApiError(400, 'Validation failed', { code: 'VALIDATION_ERROR', details: errors })
    );
  }

  return next();
};

module.exports = validate;
