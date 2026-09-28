import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectWorkItemProjectionService,
  projectWorkItemProjection
} from "../dist/application/index.js";
import {
  GitHubWorkItemSource
} from "../dist/adapters/index.js";

test("work-item projection keeps status severity priority and production gate separate", () => {
  const view = projectWorkItemProjection(
    "owner/repo",
    [
      {
        number: 1,
        title: "Provider migration",
        url: "https://github.com/owner/repo/issues/1",
        labels: [
          "status:in-progress",
          "severity:critical",
          "priority:p0",
          "production-blocking"
        ]
      },
      {
        number: 2,
        title: "Owner view polish",
        url: "https://github.com/owner/repo/issues/2",
        labels: ["status:ready", "severity:high", "priority:p1"]
      },
      {
        number: 3,
        title: "Routine cleanup",
        url: "https://github.com/owner/repo/issues/3",
        labels: ["status:backlog"]
      }
    ],
    "2026-09-28T19:00:00.000Z"
  );

  assert.equal(view.available, true);
  assert.deepEqual(view.counts, {
    active: 3,
    productionBlockers: 1,
    critical: 1,
    high: 1,
    normal: 1
  });
  assert.equal(view.items[0]?.productionBlocking, true);
  assert.equal(view.items[0]?.severity, "critical");
  assert.equal(view.items[0]?.priority, "p0");
  assert.equal(view.items[0]?.status, "in-progress");
  assert.deepEqual(
    view.items.map((item) => item.number),
    [1, 2, 3],
    "projection preserves provider order instead of secretly ranking by severity"
  );
});

test("projection service exposes provider failure instead of inventing empty work state", async () => {
  const service = new ProjectWorkItemProjectionService({
    async listOpen() {
      throw new Error("provider unavailable");
    }
  });

  const view = await service.load(
    "owner/repo",
    "2026-09-28T19:00:00.000Z"
  );

  assert.equal(view.available, false);
  assert.equal(view.counts.active, 0);
  assert.match(view.reason ?? "", /provider unavailable/);
});

test("GitHub work-item source asks only for open issues and excludes pull requests", async () => {
  const requests = [];
  const source = new GitHubWorkItemSource({
    fetchImpl: async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify([
          {
            number: 4,
            title: "Open blocker",
            html_url: "https://github.com/owner/repo/issues/4",
            labels: [
              { name: "production-blocking" },
              { name: "severity:critical" }
            ]
          },
          {
            number: 5,
            title: "A pull request",
            html_url: "https://github.com/owner/repo/pull/5",
            labels: [],
            pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" }
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const items = await source.listOpen("owner/repo");

  assert.equal(items.length, 1);
  assert.equal(items[0]?.number, 4);
  assert.deepEqual(items[0]?.labels, [
    "production-blocking",
    "severity:critical"
  ]);
  assert.match(requests[0] ?? "", /state=open/);
  assert.match(requests[0] ?? "", /per_page=100/);
});
