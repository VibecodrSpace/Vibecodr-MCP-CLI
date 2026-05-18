import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCapabilityName, validateBrowserUrl, validateSandboxCommand } from "../../src/legacy/core/validators.js";

test("normalizes documented capability aliases", () => {
  assert.equal(normalizeCapabilityName("browser.render"), "browser.render_url");
  assert.equal(normalizeCapabilityName("browser.markdown"), "browser.extract_markdown");
  assert.equal(normalizeCapabilityName("sandbox.run"), "sandbox.run_command");
});

test("rejects unsafe browser URL shapes before remote tool calls", () => {
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.2",
    "https://169.254.169.254",
    "https://[::]/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[64:ff9b::c000:201]/",
    "https://[2002:c000:0201::]/",
    "https://service.internal",
    "https://app.local"
  ]) {
    assert.throws(() => validateBrowserUrl(url));
  }
});

test("accepts public HTTPS browser URLs", () => {
  assert.equal(validateBrowserUrl("https://example.com/path?q=1"), "https://example.com/path?q=1");
});

test("rejects empty and oversized sandbox commands", () => {
  assert.throws(() => validateSandboxCommand(" "));
  assert.throws(() => validateSandboxCommand("x".repeat(4001)));
  assert.equal(validateSandboxCommand("npm test"), "npm test");
});
