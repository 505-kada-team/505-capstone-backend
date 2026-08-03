/**
 * Helper pagination generik dengan dukungan filter & search sederhana.
 * Dipakai nanti oleh service/controller domain (inventory, menu, dst)
 * begitu model Mongoose-nya sudah ada.
 *
 * @param {import('mongoose').Model} model - Mongoose model
 * @param {Object} [baseFilter] - filter wajib, misal { deletedAt: null }
 * @param {Object} [query] - req.query dari client
 * @param {Object} [options] - konfigurasi tambahan
 * @param {string[]} [options.searchableFields] - field yang bisa di-search, misal ['name', 'email']
 * @param {string} [options.defaultSort] - default '-createdAt'
 * @param {number} [options.defaultLimit] - default 10
 * @param {number} [options.maxLimit] - default 100
 *
 * @example
 *   const { data, meta } = await paginate(
 *     UserModel,
 *     {},
 *     req.query, // ?page=2&limit=20&search=budi
 *     { searchableFields: ['name', 'email'] }
 *   );
 *   return new ApiResponse(200, data, 'Berhasil mengambil data user', meta).send(res);
 */
const paginate = async (model, baseFilter = {}, query = {}, options = {}) => {
  const {
    searchableFields = [],
    defaultSort = '-createdAt',
    defaultLimit = 10,
    maxLimit = 100,
  } = options;

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(query.limit, 10) || defaultLimit, maxLimit);
  const skip = (page - 1) * limit;
  const sort = query.sort || defaultSort;

  const filter = { ...baseFilter };

  if (query.search && searchableFields.length > 0) {
    filter.$or = searchableFields.map((field) => ({
      [field]: { $regex: query.search, $options: 'i' },
    }));
  }

  const [data, total] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(limit),
    model.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
  };
};

module.exports = paginate;
