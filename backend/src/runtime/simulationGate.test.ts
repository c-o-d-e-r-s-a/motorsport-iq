describe('SIMULATION_ENABLED feature flag', () => {
  const originalValue = process.env.SIMULATION_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.SIMULATION_ENABLED;
    } else {
      process.env.SIMULATION_ENABLED = originalValue;
    }
    jest.resetModules();
  });

  it('defaults to false when unset', async () => {
    delete process.env.SIMULATION_ENABLED;
    jest.resetModules();
    const { SIMULATION_ENABLED } = await import('./featureFlags');
    expect(SIMULATION_ENABLED).toBe(false);
  });

  it('parses true when enabled', async () => {
    process.env.SIMULATION_ENABLED = 'true';
    jest.resetModules();
    const { SIMULATION_ENABLED } = await import('./featureFlags');
    expect(SIMULATION_ENABLED).toBe(true);
  });
});
