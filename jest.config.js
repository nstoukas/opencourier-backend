module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', 'src', 'test'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@prisma/types$': '<rootDir>/prisma/client',
  },
  testMatch: ['**/*.active.spec.ts'],
  // testMatch: ['**/*.active.spec.ts', '**/*.integration.spec.ts'],
}
