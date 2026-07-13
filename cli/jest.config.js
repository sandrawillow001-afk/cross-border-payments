module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  globals: {
    'ts-jest': {
      diagnostics: false,
      isolatedModules: true,
    },
  },
};
