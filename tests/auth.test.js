jest.mock('../src/utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('express-rate-limit', () => {
  return function rateLimit() {
    return function rateLimitMiddleware(req, res, next) {
      return next();
    };
  };
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let app;
let User;
let RefreshToken;
let sendOtpEmail;

// Set test env before anything else
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-that-is-long-enough-32chars';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-that-is-long-enough-32chars';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.JWT_RESET_SECRET = 'test-reset-secret-key-that-is-long-enough-32ch';
process.env.JWT_RESET_EXPIRES = '10m';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_FROM_NAME = 'Test App';
process.env.OTP_LENGTH = '6';
process.env.OTP_EXPIRES_MINUTES = '10';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';
process.env.OTP_MAX_ATTEMPTS = '5';
process.env.EMAIL_SANDBOX_MODE = 'true';

beforeAll(async () => {
  sendOtpEmail = require('../src/utils/mailer').sendOtpEmail;

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();

  await mongoose.connect(process.env.MONGO_URI);
  User = require('../src/models/auth/user.model');
  RefreshToken = require('../src/models/auth/refreshToken.model');
  app = require('../src/app');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
  jest.clearAllMocks();
});

const BASE = '/api/v1/auth';

const registerUser = (overrides = {}) =>
  request(app)
    .post(`${BASE}/register`)
    .send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      ...overrides,
    });

const getLatestOtp = () => {
  const call = sendOtpEmail.mock.calls[sendOtpEmail.mock.calls.length - 1];
  return call ? call[0].code : null;
};

// ─── 1. Registration ───────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('creates user and returns 201 with user data (no tokens)', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toHaveProperty('id');
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('accessToken');
  });

  it('sends verification email after registration', async () => {
    await registerUser();
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(sendOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com', purpose: 'verify-email' })
    );
  });

  it('returns 409 EMAIL_ALREADY_REGISTERED on duplicate email', async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('returns 400 VALIDATION_ERROR for invalid email', async () => {
    const res = await registerUser({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for short password', async () => {
    const res = await registerUser({ password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ─── 2. Email Verification ─────────────────────────────────────────────────

describe('Email verification', () => {
  describe('POST /auth/verify-email/send', () => {
    it('returns 200 for registered unverified email (sends code)', async () => {
      await registerUser();
      await User.findOneAndUpdate(
        { email: 'test@example.com' },
        { emailVerificationSentAt: new Date(0) }
      );
      sendOtpEmail.mockClear();

      const res = await request(app)
        .post(`${BASE}/verify-email/send`)
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    });

    it('returns 200 silently for unknown email (no enumeration)', async () => {
      sendOtpEmail.mockClear();
      const res = await request(app)
        .post(`${BASE}/verify-email/send`)
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(sendOtpEmail).not.toHaveBeenCalled();
    });

    it('returns 200 silently for already-verified email', async () => {
      await registerUser();
      await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });
      sendOtpEmail.mockClear();

      const res = await request(app)
        .post(`${BASE}/verify-email/send`)
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/verify-email/confirm', () => {
    it('verifies email with valid code', async () => {
      await registerUser();
      const code = getLatestOtp();

      const res = await request(app)
        .post(`${BASE}/verify-email/confirm`)
        .send({ email: 'test@example.com', code });

      expect(res.status).toBe(200);
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.isEmailVerified).toBe(true);
    });

    it('returns 400 OTP_INVALID for wrong code', async () => {
      await registerUser();
      const res = await request(app)
        .post(`${BASE}/verify-email/confirm`)
        .send({ email: 'test@example.com', code: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('returns 400 OTP_INVALID for unknown email (no enumeration)', async () => {
      const res = await request(app)
        .post(`${BASE}/verify-email/confirm`)
        .send({ email: 'unknown@example.com', code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('returns 400 OTP_INVALID for already-verified email', async () => {
      await registerUser();
      await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

      const res = await request(app)
        .post(`${BASE}/verify-email/confirm`)
        .send({ email: 'test@example.com', code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });
  });
});

// ─── 3. Login ──────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });
  });

  it('returns 200 with accessToken and user on valid credentials', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  it('sets httpOnly cookie for web platform', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('returns refreshToken in body for mobile platform', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('refreshToken');
  });

  it('returns 401 INVALID_CREDENTIALS for wrong password', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 INVALID_CREDENTIALS for unknown email', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'unknown@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 403 EMAIL_NOT_VERIFIED for unverified email', async () => {
    await registerUser({ email: 'unverified@example.com' });

    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'unverified@example.com', password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

// ─── 4. Refresh Token ──────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('returns 200 with new accessToken using cookie', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    const cookie = loginRes.headers['set-cookie'][0];
    const res = await request(app).post(`${BASE}/refresh`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
  });

  it('returns 200 with new tokens using body (mobile)', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    const refreshToken = loginRes.body.data.refreshToken;
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('x-platform', 'mobile')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
  });

  it('returns 401 REFRESH_TOKEN_MISSING when no token provided', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_MISSING');
  });

  it('returns 401 REFRESH_TOKEN_INVALID for invalid token', async () => {
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('x-platform', 'mobile')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('old refresh token is invalidated after rotation', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    const oldRefreshToken = loginRes.body.data.refreshToken;

    // Use the refresh token
    await request(app)
      .post(`${BASE}/refresh`)
      .set('x-platform', 'mobile')
      .send({ refreshToken: oldRefreshToken });

    // Try to use the old one again - should fail
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('x-platform', 'mobile')
      .send({ refreshToken: oldRefreshToken });

    expect(res.status).toBe(401);
  });
});

// ─── 5. Logout ─────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 200 and revokes refresh token', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    const refreshToken = loginRes.body.data.refreshToken;

    const res = await request(app)
      .post(`${BASE}/logout`)
      .set('x-platform', 'mobile')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Refresh token should no longer work
    const refreshRes = await request(app)
      .post(`${BASE}/refresh`)
      .set('x-platform', 'mobile')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });
});

// ─── 6. Forgot Password ────────────────────────────────────────────────────

describe('Forgot password flow', () => {
  describe('POST /auth/forgot-password', () => {
    it('returns 200 silently even for unknown email (no enumeration)', async () => {
      sendOtpEmail.mockClear();
      const res = await request(app)
        .post(`${BASE}/forgot-password`)
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(sendOtpEmail).not.toHaveBeenCalled();
    });

    it('returns 200 and sends code for registered email', async () => {
      await registerUser();
      sendOtpEmail.mockClear();

      const res = await request(app)
        .post(`${BASE}/forgot-password`)
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /auth/forgot-password/verify-code', () => {
    it('returns 200 with resetToken for valid code', async () => {
      await registerUser();
      await request(app).post(`${BASE}/forgot-password`).send({ email: 'test@example.com' });

      const code = getLatestOtp();
      const res = await request(app)
        .post(`${BASE}/forgot-password/verify-code`)
        .send({ email: 'test@example.com', code });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('resetToken');
    });

    it('returns 400 OTP_INVALID for wrong code', async () => {
      await registerUser();
      await request(app).post(`${BASE}/forgot-password`).send({ email: 'test@example.com' });

      const res = await request(app)
        .post(`${BASE}/forgot-password/verify-code`)
        .send({ email: 'test@example.com', code: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('resets password with valid resetToken', async () => {
      await registerUser();
      await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });
      await request(app).post(`${BASE}/forgot-password`).send({ email: 'test@example.com' });

      const code = getLatestOtp();
      const verifyRes = await request(app)
        .post(`${BASE}/forgot-password/verify-code`)
        .send({ email: 'test@example.com', code });

      const { resetToken } = verifyRes.body.data;

      const res = await request(app)
        .post(`${BASE}/reset-password`)
        .send({ resetToken, newPassword: 'newpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Old password should no longer work
      const loginRes = await request(app)
        .post(`${BASE}/login`)
        .send({ email: 'test@example.com', password: 'password123' });
      expect(loginRes.status).toBe(401);

      // New password should work
      const loginRes2 = await request(app)
        .post(`${BASE}/login`)
        .send({ email: 'test@example.com', password: 'newpassword123' });
      expect(loginRes2.status).toBe(200);
    });

    it('returns 401 RESET_TOKEN_INVALID for invalid token', async () => {
      const res = await request(app)
        .post(`${BASE}/reset-password`)
        .send({ resetToken: 'invalid-token', newPassword: 'newpassword123' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('RESET_TOKEN_INVALID');
    });
  });
});

// ─── 7. Change Password ────────────────────────────────────────────────────

describe('PATCH /auth/change-password', () => {
  let accessToken;

  beforeEach(async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    accessToken = loginRes.body.data.accessToken;
  });

  it('returns 200 and invalidates old session', async () => {
    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'password123', newPassword: 'newpassword123' });

    expect(res.status).toBe(200);

    // Old access token should no longer work
    const meRes = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.status).toBe(401);
  });

  it('returns 401 for wrong old password', async () => {
    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'wrongpassword', newPassword: 'newpassword123' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 without token', async () => {
    const res = await request(app)
      .patch(`${BASE}/change-password`)
      .send({ oldPassword: 'password123', newPassword: 'newpassword123' });

    expect(res.status).toBe(401);
  });
});

// ─── 8. Authenticated Requests ─────────────────────────────────────────────

describe('GET /auth/me', () => {
  it('returns 200 with user data for valid token', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@example.com');
  });

  it('returns 401 for invalid token', async () => {
    const res = await request(app).get(`${BASE}/me`).set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
  });

  it('returns 401 when token version mismatches', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@example.com', password: 'password123' });

    const token = loginRes.body.data.accessToken;

    // Simulate tokenVersion bump
    await User.findOneAndUpdate({ email: 'test@example.com' }, { $inc: { tokenVersion: 1 } });

    const res = await request(app).get(`${BASE}/me`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

// ─── 9. Error Format Consistency ───────────────────────────────────────────

describe('Error response format', () => {
  it('all error responses have success, message, and code fields', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'nonexistent@example.com', password: 'password123' });

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('code');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get(`${BASE}/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── 10. Single Session Enforcement ────────────────────────────────────────

describe('Single session enforcement', () => {
  it('new login invalidates previous session', async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { isEmailVerified: true });

    // First login
    const login1 = await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    const token1 = login1.body.data.accessToken;

    // Second login (should kill first session)
    await request(app)
      .post(`${BASE}/login`)
      .set('x-platform', 'mobile')
      .send({ email: 'test@example.com', password: 'password123' });

    // First token should be dead
    const res = await request(app).get(`${BASE}/me`).set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(401);
  });
});
