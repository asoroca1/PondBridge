module.exports = {
  testEnvironment: "<rootDir>/tests/nativeNodeEnvironment.cjs",
  setupFilesAfterEnv: ["<rootDir>/tests/nativeDependencies.setup.js"],
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],
  clearMocks: true,
  verbose: true
};
