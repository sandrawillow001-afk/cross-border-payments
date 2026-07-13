/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
      },
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    // Resolve the SDK alias to source so tests run without a compiled dist/
    '^@stellar-cross-border/sdk$': '<rootDir>/../sdk/src/index.ts',
    // Silence static-asset imports that jsdom cannot handle
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
