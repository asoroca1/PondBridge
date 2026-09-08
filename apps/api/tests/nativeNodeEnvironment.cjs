const { TestEnvironment } = require("jest-environment-node");
const sanitizeHtml = require("sanitize-html");

// Load with Node's real require(ESM) support outside Jest 29's VM loader.
// This is the production sanitizer implementation, never a sanitizer stub.
module.exports = class NativeNodeEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.__pondbridgeNativeSanitizeHtml = sanitizeHtml;
  }
};
