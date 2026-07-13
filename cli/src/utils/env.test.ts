import { envDefault } from './env';

describe('envDefault — env-driven configuration loading', () => {
  const KEY = 'TEST_ENV_DEFAULT_VAR';

  afterEach(() => {
    delete process.env[KEY];
  });

  test('returns the environment value when the variable is set', () => {
    process.env[KEY] = 'from-env';
    expect(envDefault(KEY, 'fallback')).toBe('from-env');
  });

  test('returns the fallback when the variable is unset', () => {
    delete process.env[KEY];
    expect(envDefault(KEY, 'fallback')).toBe('fallback');
  });

  test('treats an empty-string variable as unset and returns the fallback', () => {
    process.env[KEY] = '';
    expect(envDefault(KEY, 'fallback')).toBe('fallback');
  });

  test('environment value takes precedence over the built-in default', () => {
    process.env.HORIZON_URL = 'https://custom-horizon.example.org';
    expect(envDefault('HORIZON_URL', 'https://horizon-testnet.stellar.org')).toBe(
      'https://custom-horizon.example.org'
    );
    delete process.env.HORIZON_URL;
  });

  test('resolves each supported batch/retry variable from the environment', () => {
    const cases: Record<string, string> = {
      HORIZON_URL: 'https://h.example.org',
      NETWORK_PASSPHRASE: 'Custom Passphrase',
      STELLAR_NETWORK: 'mainnet',
      MAX_FEE: '20000',
      DB_PATH: '/tmp/custom.db',
    };
    for (const [key, value] of Object.entries(cases)) {
      process.env[key] = value;
      expect(envDefault(key, 'DEFAULT')).toBe(value);
      delete process.env[key];
    }
  });
});
