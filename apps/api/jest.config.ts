import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setupEnv.ts'],
  moduleNameMapper: {
    '^@caifu/(.*)$': '<rootDir>/../../packages/$1/src',
  },
  forceExit: true,
}

export default config
