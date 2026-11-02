module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', 'src', 'test'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@prisma/types$': '<rootDir>/prisma/client',
  },
  testMatch: ['**/*.active.spec.ts'],
  // A fixed number of test processes. Jest's default is one per CPU core minus one: 15 on a
  // 16 core machine, which peaked at 12.1 GB and was slower (15 s) than 4 workers (8 s, 4.5 GB),
  // because each worker compiles the TypeScript itself. Measured 2026-11-02; the uncapped default
  // was the largest share of the host running out of memory. `--maxWorkers=N` still overrides it.
  maxWorkers: 4,
  // testMatch: ['**/*.active.spec.ts', '**/*.integration.spec.ts'],
}
