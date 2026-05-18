import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const channel = process.env.VC_TOOLS_RELEASE_CHANNEL ?? "cli-contract";
const moduleUrl = pathToFileURL(path.join(root, "dist", "core", "goal-coverage.js"));
const { GOAL_INSPECTIONS, goalCoverageSummary } = await import(moduleUrl.href);

const summary = goalCoverageSummary();
const hosted = GOAL_INSPECTIONS.filter((item) => item.status === "hosted-required");
const local = GOAL_INSPECTIONS.filter((item) => item.status === "local-verified");

if (summary.total !== GOAL_INSPECTIONS.length) {
  fail(`Goal summary total ${summary.total} does not match inspection count ${GOAL_INSPECTIONS.length}.`);
}

if (summary.localVerified !== local.length || summary.hostedRequired !== hosted.length) {
  fail("Goal summary counts do not match inspection statuses.");
}

if (channel === "cli-contract") {
  const pendingIds = hosted.map((item) => item.id);
  if (pendingIds.length > 1 || (pendingIds.length === 1 && pendingIds[0] !== "live-hosted-production")) {
    fail(`CLI contract releases may only leave live-hosted-production pending, or no hosted-required inspections after production smoke. Pending: ${pendingIds.join(", ") || "none"}.`);
  }
  console.log(
    pendingIds.length === 0
      ? "Release readiness verified for cli-contract channel: all hosted production inspections are verified."
      : "Release readiness verified for cli-contract channel: live hosted production remains explicitly gated."
  );
} else if (channel === "live") {
  if (hosted.length > 0) {
    fail(`Live releases require zero hosted-required inspections. Pending: ${hosted.map((item) => item.id).join(", ")}.`);
  }
  console.log("Release readiness verified for live channel.");
} else {
  fail(`Unknown VC_TOOLS_RELEASE_CHANNEL "${channel}". Use cli-contract or live.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
