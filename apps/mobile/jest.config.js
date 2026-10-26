/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
        },
      },
    ],
  },
  collectCoverageFrom: ['src/engine/**/*.ts', '!src/engine/__tests__/**'],
};
