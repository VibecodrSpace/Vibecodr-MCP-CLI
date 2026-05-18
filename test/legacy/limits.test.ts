import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  DEFAULT_PLANS,
  OVERAGE_METERS,
  PUBLIC_OFFERING_CLASSIFICATIONS
} from "../../src/legacy/core/contracts.js";

type PlanName = "Free" | "Creator" | "Pro";

const EXPECTED_LIMITS: Record<PlanName, Record<string, unknown>> = {
  Free: {
    priceUsdMonthly: 0,
    monthlyCredits: 30,
    dailyCredits: 10,
    maxConcurrentRuns: 1,
    browser: {
      defaultLane: "quick-action",
      monthlyBrowserSeconds: 30 * 60,
      dailyBrowserSeconds: 10 * 60,
      maxBrowserSecondsPerRun: 30,
      allowBrowserSessions: false,
      maxBrowserSessionSeconds: 0,
      maxConcurrentBrowserSessionsPerUser: 0
    },
    crawl: {
      maxPagesPerRun: 10,
      maxPagesPerMonth: 25,
      maxDepth: 1
    },
    scheduledQa: {
      maxRunsPerMonth: 0,
      minIntervalMinutes: 0
    },
    sandbox: {
      containerInstanceType: "none",
      maxSandboxTaskSeconds: 0
    },
    browserRenderJobsMonthly: 30,
    browserMinutesMonthly: 30,
    sandboxJobsMonthly: 0,
    sandboxMinutesMonthly: 0,
    artifactStorageGb: 0,
    artifactRetentionDays: 0,
    maxArtifactUploadBytes: 0,
    concurrentBrowserSessions: 0,
    concurrentSandboxJobs: 0
  },
  Creator: {
    priceUsdMonthly: 19,
    monthlyCredits: 600,
    dailyCredits: 90,
    maxConcurrentRuns: 2,
    browser: {
      defaultLane: "quick-action",
      monthlyBrowserSeconds: 600 * 60,
      dailyBrowserSeconds: 90 * 60,
      maxBrowserSecondsPerRun: 60,
      allowBrowserSessions: true,
      maxBrowserSessionSeconds: 20 * 60,
      maxConcurrentBrowserSessionsPerUser: 1
    },
    crawl: {
      maxPagesPerRun: 50,
      maxPagesPerMonth: 500,
      maxDepth: 2
    },
    scheduledQa: {
      maxRunsPerMonth: 30,
      minIntervalMinutes: 720
    },
    sandbox: {
      containerInstanceType: "standard-1",
      maxSandboxTaskSeconds: 10 * 60
    },
    browserRenderJobsMonthly: 600,
    browserMinutesMonthly: 600,
    sandboxJobsMonthly: 600,
    sandboxMinutesMonthly: 600,
    artifactStorageGb: 1,
    artifactRetentionDays: 7,
    maxArtifactUploadBytes: 100 * 1024 * 1024,
    concurrentBrowserSessions: 1,
    concurrentSandboxJobs: 2
  },
  Pro: {
    priceUsdMonthly: 39,
    monthlyCredits: 3000,
    dailyCredits: 400,
    maxConcurrentRuns: 5,
    browser: {
      defaultLane: "quick-action",
      monthlyBrowserSeconds: 3000 * 60,
      dailyBrowserSeconds: 400 * 60,
      maxBrowserSecondsPerRun: 180,
      allowBrowserSessions: true,
      maxBrowserSessionSeconds: 3600,
      maxConcurrentBrowserSessionsPerUser: 1
    },
    crawl: {
      maxPagesPerRun: 250,
      maxPagesPerMonth: 5000,
      maxDepth: 4
    },
    scheduledQa: {
      maxRunsPerMonth: 300,
      minIntervalMinutes: 60
    },
    sandbox: {
      containerInstanceType: "standard-2",
      maxSandboxTaskSeconds: 30 * 60
    },
    browserRenderJobsMonthly: 3000,
    browserMinutesMonthly: 3000,
    sandboxJobsMonthly: 3000,
    sandboxMinutesMonthly: 3000,
    artifactStorageGb: 10,
    artifactRetentionDays: 30,
    maxArtifactUploadBytes: 500 * 1024 * 1024,
    concurrentBrowserSessions: 1,
    concurrentSandboxJobs: 2
  }
};

test("vc-tools publishes the exact Free, Creator, and Pro launch limit matrix", () => {
  const planNames = DEFAULT_PLANS.map((plan) => plan.name);
  assert.deepEqual(planNames, ["Free", "Creator", "Pro"]);
  assert.equal((planNames as readonly string[]).includes("Starter"), false);

  for (const planName of Object.keys(EXPECTED_LIMITS) as PlanName[]) {
    const plan = DEFAULT_PLANS.find((candidate) => candidate.name === planName);
    assert.ok(plan, `${planName} plan is present`);
    const expected = EXPECTED_LIMITS[planName];
    assert.deepEqual(
      {
        priceUsdMonthly: plan.priceUsdMonthly,
        monthlyCredits: plan.limits.monthlyCredits,
        dailyCredits: plan.limits.dailyCredits,
        maxConcurrentRuns: plan.limits.maxConcurrentRuns,
        browser: plan.limits.browser,
        crawl: plan.limits.crawl,
        scheduledQa: plan.limits.scheduledQa,
        sandbox: plan.limits.sandbox,
        browserRenderJobsMonthly: plan.limits.browserRenderJobsMonthly,
        browserMinutesMonthly: plan.limits.browserMinutesMonthly,
        sandboxJobsMonthly: plan.limits.sandboxJobsMonthly,
        sandboxMinutesMonthly: plan.limits.sandboxMinutesMonthly,
        artifactStorageGb: plan.limits.artifactStorageGb,
        artifactRetentionDays: plan.limits.artifactRetentionDays,
        maxArtifactUploadBytes: plan.limits.maxArtifactUploadBytes,
        concurrentBrowserSessions: plan.limits.concurrentBrowserSessions,
        concurrentSandboxJobs: plan.limits.concurrentSandboxJobs
      },
      expected
    );
  }
});

test("vc-tools credit meters are separate from compatibility projections", () => {
  const creator = DEFAULT_PLANS.find((plan) => plan.name === "Creator");
  const pro = DEFAULT_PLANS.find((plan) => plan.name === "Pro");

  assert.ok(creator);
  assert.ok(pro);
  assert.equal(creator.limits.monthlyCredits, 600);
  assert.equal(creator.limits.browserRenderJobsMonthly, creator.limits.monthlyCredits);
  assert.equal(creator.limits.sandboxJobsMonthly, creator.limits.monthlyCredits);
  assert.equal(creator.limits.browser.monthlyBrowserSeconds, creator.limits.monthlyCredits * 60);
  assert.equal(creator.limits.browser.allowBrowserSessions, true);
  assert.equal(creator.limits.browser.maxBrowserSessionSeconds, 20 * 60);

  assert.equal(pro.limits.monthlyCredits, 3000);
  assert.equal(pro.limits.browser.maxConcurrentBrowserSessionsPerUser, 1);
  assert.equal(pro.limits.browser.maxBrowserSessionSeconds, 3600);
  assert.equal(pro.limits.sandbox.containerInstanceType, "standard-2");
  assert.equal(pro.limits.sandbox.maxSandboxTaskSeconds, 30 * 60);
  assert.equal(pro.limits.concurrentSandboxJobs, 2);
  assert.equal(OVERAGE_METERS.some((meter) => meter.id === "browser-minute"), true);
  assert.equal(OVERAGE_METERS.some((meter) => meter.id === "sandbox-compute-minute"), true);
});

test("public offering classifications distinguish launch lanes from reserved work", () => {
  const statuses = new Map(PUBLIC_OFFERING_CLASSIFICATIONS.map((item) => [item.id, item.status]));

  assert.equal(statuses.get("browser.quick_actions"), "shipped");
  assert.equal(statuses.get("browser.render"), "shipped");
  assert.equal(statuses.get("browser.screenshot"), "shipped");
  assert.equal(statuses.get("browser.markdown"), "shipped");
  assert.equal(statuses.get("browser.pdf"), "shipped");
  assert.equal(statuses.get("browser.sessions"), "gated beta");
  assert.equal(statuses.get("browser.recording_replay"), "future");
  assert.equal(statuses.get("browser.interactive_debugging"), "future");
  assert.equal(statuses.get("crawl.public"), "gated beta");
  assert.equal(statuses.get("crawl.deep"), "future");
  assert.equal(statuses.get("scheduled_qa"), "gated beta");
  assert.equal(statuses.get("sandbox.command"), "gated beta");
  assert.equal(statuses.get("sandbox.tests"), "gated beta");
  assert.equal(statuses.get("sandbox.network"), "gated beta");
  assert.equal(statuses.get("artifacts"), "gated beta");
  assert.equal(statuses.get("jobs"), "shipped");
  assert.equal(statuses.get("dashboard"), "gated beta");
  assert.equal(statuses.get("grants"), "shipped");
  assert.equal(statuses.get("retention"), "shipped");
  assert.equal(statuses.get("overage_meters"), "internal-only");
  assert.equal(statuses.get("stripe_metered_billing"), "future");
});

test("wrangler config splits Creator and Pro sandbox container lanes", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")) as {
    containers: Array<{ class_name: string; instance_type: string; max_instances: number }>;
    durable_objects: { bindings: Array<{ class_name: string; name: string }> };
    queues: {
      producers: Array<{
        binding: string;
        queue: string;
      }>;
      consumers: Array<{
        queue: string;
        max_batch_size: number;
        max_batch_timeout: number;
        max_concurrency: number;
        max_retries: number;
        dead_letter_queue: string;
      }>;
    };
  };

  assert.deepEqual(
    config.containers.map((container) => ({
      className: container.class_name,
      instanceType: container.instance_type,
      maxInstances: container.max_instances
    })),
    [
      { className: "Sandbox", instanceType: "standard-1", maxInstances: 30 },
      { className: "ProSandbox", instanceType: "standard-2", maxInstances: 30 }
    ]
  );
  assert.equal(config.durable_objects.bindings.some((binding) => binding.name === "Sandbox"), true);
  assert.equal(config.durable_objects.bindings.some((binding) => binding.name === "ProSandbox"), true);
  assert.deepEqual(config.queues.producers, [
    { binding: "JOB_QUEUE", queue: "vc-tools-jobs" },
    { binding: "JOB_DLQ", queue: "vc-tools-jobs-dlq" }
  ]);
  assert.deepEqual(config.queues.consumers, [
    {
      queue: "vc-tools-jobs",
      max_batch_size: 1,
      max_batch_timeout: 5,
      max_concurrency: 30,
      max_retries: 3,
      dead_letter_queue: "vc-tools-jobs-dlq"
    }
  ]);
});
