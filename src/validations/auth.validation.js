const Joi = require('joi');

const register = {
  body: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
  }),
};

const login = {
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),
};

const refresh = {
  body: Joi.object({
    refreshToken: Joi.string().optional(),
  }),
};

const otpCode = Joi.string()
  .pattern(/^\d{4,8}$/)
  .message('Code must be a number');

const sendVerificationEmail = {
  body: Joi.object({
    email: Joi.string().email().required(),
  }),
};

const confirmVerificationEmail = {
  body: Joi.object({
    email: Joi.string().email().required(),
    code: otpCode.required(),
  }),
};

const forgotPassword = {
  body: Joi.object({
    email: Joi.string().email().required(),
  }),
};

const verifyResetCode = {
  body: Joi.object({
    email: Joi.string().email().required(),
    code: otpCode.required(),
  }),
};

const resetPassword = {
  body: Joi.object({
    resetToken: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
  }),
};

const changePassword = {
  body: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required().invalid(Joi.ref('oldPassword')).messages({
      'any.invalid': 'New password cannot be the same as the old password',
    }),
  }),
};

module.exports = {
  register,
  login,
  refresh,
  sendVerificationEmail,
  confirmVerificationEmail,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
};
