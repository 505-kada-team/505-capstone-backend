const ApiError = require('../utils/ApiError');

const notFound = (req, res, next) => {
  next(new ApiError(404, `Route tidak ditemukan - ${req.originalUrl}`));
};

module.exports = notFound;
