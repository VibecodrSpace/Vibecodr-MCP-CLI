import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { writeResult } from "../../src/legacy/cli/output.js";

const fakeSecret = (...parts: string[]) => parts.join("_");

test("JSON output redacts warnings without hiding safe operator counters", () => {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  const authToken = fakeSecret("vc", "secret", "token", "1234567890");
  const warningToken = fakeSecret("vc", "warning", "token", "1234567890");

  writeResult({
    data: {
      tokenCount: 42,
      tokenKind: "cli_grant",
      artifactId: "vc_artifact_1234567890",
      authToken
    },
    warnings: [`provider echoed ${warningToken}`]
  }, {
    json: true,
    quiet: false,
    stdout,
    stderr
  });

  const body = JSON.parse(stdout.text);
  assert.equal(body.data.tokenCount, 42);
  assert.equal(body.data.tokenKind, "cli_grant");
  assert.equal(body.data.artifactId, "vc_artifact_1234567890");
  assert.equal(body.data.authToken, "[redacted]");
  assert.equal(body.warnings[0].includes(warningToken), false);
  assert.equal(stderr.text, "");
});

test("human output includes redacted data when a command returns data", () => {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  const authToken = fakeSecret("vc", "secret", "token", "1234567890");

  writeResult({
    message: "Fetched hosted plan packaging.",
    data: {
      plans: ["Free", "Creator", "Pro"],
      authToken
    }
  }, {
    json: false,
    quiet: false,
    stdout,
    stderr
  });

  assert.match(stdout.text, /Fetched hosted plan packaging\./);
  assert.match(stdout.text, /"plans"/);
  assert.match(stdout.text, /"Creator"/);
  assert.match(stdout.text, /"authToken": "\[redacted\]"/);
  assert.equal(stderr.text, "");
});

test("human output can hide metadata-only data for help and version responses", () => {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();

  writeResult({
    message: "vc-tools help text",
    data: { commands: ["status"] },
    humanData: "hide"
  }, {
    json: false,
    quiet: false,
    stdout,
    stderr
  });

  assert.equal(stdout.text, "vc-tools help text\n");
  assert.equal(stderr.text, "");
});

class MemoryWritable extends Writable {
  text = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += String(chunk);
    callback();
  }
}
