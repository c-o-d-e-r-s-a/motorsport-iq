import {
  clearAdminLoginRateLimit,
  isAdminLoginRateLimited,
  recordAdminLoginFailure,
  resetAdminLoginRateLimitsForTests,
} from './loginRateLimit';

describe('admin login rate limit', () => {
  beforeEach(() => {
    resetAdminLoginRateLimitsForTests();
  });

  it('allows attempts until the failure threshold is reached', () => {
    const ip = '203.0.113.10';

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(isAdminLoginRateLimited(ip).limited).toBe(false);
      recordAdminLoginFailure(ip);
    }

    expect(isAdminLoginRateLimited(ip).limited).toBe(true);
  });

  it('clears the bucket after a successful login', () => {
    const ip = '203.0.113.11';

    recordAdminLoginFailure(ip);
    recordAdminLoginFailure(ip);
    clearAdminLoginRateLimit(ip);

    expect(isAdminLoginRateLimited(ip).limited).toBe(false);
  });
});
