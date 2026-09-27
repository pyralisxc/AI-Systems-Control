import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMcpResourceUrl
} from "../dist/application/index.js";

test("explicit MCP resource URL wins over Vercel branch alias", () => {
  const result = deriveMcpResourceUrl({
    explicitResourceUrl: "https://asc-preview.example.com/mcp",
    vercelBranchUrl:
      "ai-systems-control-git-preview-pyralis-projects.vercel.app"
  });

  assert.deepEqual(result, {
    resourceUrl: "https://asc-preview.example.com/mcp",
    source: "explicit"
  });
});

test("Vercel branch alias derives stable /mcp resource", () => {
  const result = deriveMcpResourceUrl({
    vercelBranchUrl:
      "ai-systems-control-git-preview-pyralis-projects.vercel.app"
  });

  assert.deepEqual(result, {
    resourceUrl:
      "https://ai-systems-control-git-preview-pyralis-projects.vercel.app/mcp",
    source: "vercel_branch"
  });
});

test("Vercel branch alias may already include https scheme", () => {
  const result = deriveMcpResourceUrl({
    vercelBranchUrl:
      "https://ai-systems-control-git-preview-pyralis-projects.vercel.app"
  });

  assert.equal(
    result?.resourceUrl,
    "https://ai-systems-control-git-preview-pyralis-projects.vercel.app/mcp"
  );
});

test("deployment-specific VERCEL_URL is not an accepted derivation input", () => {
  const result = deriveMcpResourceUrl({});
  assert.equal(result, undefined);
});

test("branch alias with path is rejected", () => {
  assert.throws(
    () => deriveMcpResourceUrl({
      vercelBranchUrl:
        "https://preview.example.com/some-deployment-path"
    }),
    /without a path/i
  );
});
