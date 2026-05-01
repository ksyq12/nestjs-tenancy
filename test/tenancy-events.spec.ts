import { summarizeTenancyRequest } from '../src/events/tenancy-events';

describe('tenancy event request summary', () => {
  it('should extract safe request fields only', () => {
    const request = {
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        host: 'api.example.com',
        'user-agent': ['jest-agent'],
      },
      method: 'POST',
      url: '/users?include=secrets',
      ip: '127.0.0.1',
      body: { email: 'user@example.com' },
    };

    expect(summarizeTenancyRequest(request)).toEqual({
      method: 'POST',
      path: '/users',
      ip: '127.0.0.1',
      userAgent: 'jest-agent',
      host: 'api.example.com',
    });
  });
});
