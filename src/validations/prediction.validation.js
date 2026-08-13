const Joi = require('joi');

const getAssortmentPrediction = {
  body: Joi.object().keys({
    duration: Joi.number().integer().min(3).max(30).required(),
    startDate: Joi.date().iso().required(),
    tags: Joi.array().items(Joi.string()).default([]),
  }),
};

module.exports = {
  getAssortmentPrediction,
};