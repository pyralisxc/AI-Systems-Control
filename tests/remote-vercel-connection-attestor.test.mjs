import assert from "node:assert/strict";
import test from "node:test";

import {
  RemoteVercelConnectionAttestor
} from "../dist/adapters/index.js";

function response(
  status,
  payload
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("remote Vercel attestor discovers safe installation identities without credentials", async () => {
  const seen = [];
  const attestor =
    new RemoteVercelConnectionAttestor({
      baseUrl: "https://conductor.example",
      secret: "s".repeat(40),
      now: () =>
        new Date(
          "2026-09-29T03:00:00.000Z"
        ),
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          authorization:
            new Headers(init?.headers)
              .get("authorization")
        });
        return response(200, {
          installations: [
            {
              configurationId: "icfg_A",
              teamId: "team_A",
              connectedAt:
                "2026-09-29T01:00:00.000Z",
              token: "must-not-cross"
            },
            {
              configurationId: "icfg_B",
              teamId: null,
              connectedAt:
                "2026-09-29T02:00:00.000Z"
            }
          ]
        });
      }
    });

  const connections =
    await attestor.listConnections();

  assert.equal(
    seen[0].url,
    "https://conductor.example/internal/asc/vercel/installations"
  );
  assert.equal(
    seen[0].authorization,
    "Bearer " + "s".repeat(40)
  );
  assert.deepEqual(connections, [
    {
      connectionReference: "icfg_A",
      accountReference: "team_A",
      accountDisplayName: "team_A",
      accountType: "Team",
      connectedAt:
        "2026-09-29T01:00:00.000Z",
      observedAt:
        "2026-09-29T03:00:00.000Z"
    },
    {
      connectionReference: "icfg_B",
      accountReference: "personal",
      accountDisplayName:
        "Personal Vercel account",
      accountType: "Personal",
      connectedAt:
        "2026-09-29T02:00:00.000Z",
      observedAt:
        "2026-09-29T03:00:00.000Z"
    }
  ]);
  assert.equal(
    JSON.stringify(connections).includes(
      "must-not-cross"
    ),
    false
  );
});

test("remote Vercel attestor maps exact repository attestation to a provider resource", async () => {
  const attestor =
    new RemoteVercelConnectionAttestor({
      baseUrl: "https://conductor.example",
      secret: "s".repeat(40),
      fetch: async () =>
        response(200, {
          connectionId: "icfg_A",
          teamId: "team_A",
          repository:
            "pyralisxc/AI-Systems-Control",
          projectId: "prj_asc",
          projectName:
            "ai-systems-control",
          productionBranch: "main",
          capabilities: [
            "deployment.write",
            "deployment.read"
          ],
          verifiedAt:
            "2026-09-29T03:10:00.000Z",
          accessToken: "must-not-cross"
        })
    });

  const result =
    await attestor.attestRepository({
      connectionReference: "icfg_A",
      repository:
        "pyralisxc/AI-Systems-Control",
      principalId: "principal:owner",
      accountDomainId: "domain:personal"
    });

  assert.deepEqual(result, {
    connectionReference: "icfg_A",
    repository:
      "pyralisxc/AI-Systems-Control",
    accountReference: "team_A",
    accountDisplayName: "team_A",
    accountType: "Team",
    capabilities: [
      "deployment.read",
      "deployment.write"
    ],
    verifiedAt:
      "2026-09-29T03:10:00.000Z",
    resource: {
      kind: "vercel_project",
      value: "prj_asc"
    },
    resourceDisplayName:
      "ai-systems-control"
  });
  assert.equal(
    JSON.stringify(result).includes(
      "must-not-cross"
    ),
    false
  );
});

test("remote Vercel attestor fails closed on crossed installation identity", async () => {
  const attestor =
    new RemoteVercelConnectionAttestor({
      baseUrl: "https://conductor.example",
      secret: "s".repeat(40),
      fetch: async () =>
        response(200, {
          connectionId: "icfg_OTHER",
          teamId: "team_A",
          repository:
            "pyralisxc/AI-Systems-Control",
          projectId: "prj_asc",
          projectName:
            "ai-systems-control",
          capabilities: [
            "deployment.read"
          ],
          verifiedAt:
            "2026-09-29T03:10:00.000Z"
        })
    });

  await assert.rejects(
    () => attestor.attestRepository({
      connectionReference: "icfg_A",
      repository:
        "pyralisxc/AI-Systems-Control",
      principalId: "principal:owner",
      accountDomainId: "domain:personal"
    }),
    /different Vercel installation/i
  );
});
