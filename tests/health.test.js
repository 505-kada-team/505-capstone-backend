const request = require('supertest');

const app = require('../src/app');

describe('Health check', () => {
  it('GET /api/v1/health mengembalikan status OK', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'OK' });
  });

  it('GET /route-yang-tidak-ada mengembalikan 404 dengan format konsisten', async () => {
    const res = await request(app).get('/api/v1/route-yang-tidak-ada');

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
