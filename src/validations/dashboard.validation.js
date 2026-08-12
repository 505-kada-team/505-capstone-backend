const Joi = require('joi');

const getDailyDashboard = {
  params: Joi.object().keys({
    planId: Joi.string().hex().length(24).required(),
  }),
  
  query: Joi.object().keys({
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'date format should be YYYY-MM-DD',
        'any.required': 'date parameter is required'
      }),
  }),
};

module.exports = {
  getDailyDashboard,
};