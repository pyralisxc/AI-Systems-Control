import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveControlDatabaseUrl
} from "../dist/application/index.js";

test("explicit ASC database URL wins over standard DATABASE_URL", () => {
  const result = resolveControlDatabaseUrl({
    explicitAscDatabaseUrl: "postgres://asc-explicit.example/asc",
    standardDatabaseUrl: "postgres://provider.example/default"
  });

  assert.deepEqual(result, {
    value: "postgres://asc-explicit.example/asc",
    source: "asc_explicit"
  });
});

test("standard DATABASE_URL is accepted when ASC override is absent", () => {
  const result = resolveControlDatabaseUrl({
    standardDatabaseUrl: "postgres://provider.example/asc"
  });

  assert.deepEqual(result, {
    value: "postgres://provider.example/asc",
    source: "standard_database_url"
  });
});

test("blank database URL inputs are treated as not configured", () => {
  const result = resolveControlDatabaseUrl({
    explicitAscDatabaseUrl: " ",
    standardDatabaseUrl: ""
  });

  assert.equal(result, undefined);
});
