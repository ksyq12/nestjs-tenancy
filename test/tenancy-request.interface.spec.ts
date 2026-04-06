import { TenancyRequest, TenancyResponse } from '../src/interfaces/tenancy-request.interface';

describe('TenancyRequest type compatibility', () => {
  it('should accept minimal request-like objects', () => {
    const req: TenancyRequest = {
      headers: { 'x-tenant-id': 'abc' },
    };
    expect(req.headers['x-tenant-id']).toBe('abc');
  });

  it('should accept objects with hostname and path', () => {
    const req: TenancyRequest = {
      headers: {},
      hostname: 'tenant1.app.com',
      path: '/api/users',
      url: '/api/users?page=1',
    };
    expect(req.hostname).toBe('tenant1.app.com');
  });

  it('should accept Express-like request objects via index signature', () => {
    const req: TenancyRequest = {
      headers: { authorization: 'Bearer token' },
      hostname: 'localhost',
      path: '/api',
      url: '/api',
      cookies: { session: 'abc' },
      ip: '127.0.0.1',
      method: 'GET',
    };
    expect(req.cookies.session).toBe('abc');
  });

  it('should accept minimal response-like objects', () => {
    const res: TenancyResponse = {};
    expect(res).toBeDefined();
  });

  it('should accept response objects with arbitrary methods', () => {
    const res: TenancyResponse = {
      status: (_code: number) => res,
      json: (_body: unknown) => res,
    };
    expect(res.status).toBeDefined();
  });
});
