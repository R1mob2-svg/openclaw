import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  inspectSnapshot,
  payloadRevision,
  resolveBootstrap,
  shouldRefreshCache,
  staleNotice
} from "../bin/neo-brain-bootstrap.mjs";

const REV_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REV_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function backendPayload(revision, marker = "FRESH_CONTEXT") {
  return {
    ok: true,
    data: {
      schema_version: "neo.brain-bootstrap.v2",
      generated_at: "2026-11-13T15:06:55.970Z",
      status: "attached",
      brain_context_status: "attached",
      brain_sources: ["Agents/NEO/ACTIVE_STATE.md"],
      brain_revision: revision,
      context: `CURRENT ${marker}`,
      execution_truth: { canonical_head_sha: revision, truth_status: "CURRENT", warnings: [] }
    }
  };
}

function snapshotEnvelope({ revision, marker, includeRevision = true }) {
  const data = {
    schema_version: "neo.brain-bootstrap.v3",
    generated_at: "2026-11-13T12:03:02.505Z",
    status: "attached",
    brain_context_status: "attached",
    brain_sources: ["Agents/NEO/ACTIVE_STATE.md"],
    context: `CACHED ${marker}`
  };
  if (includeRevision) data.brain_revision = revision;
  return { ok: true, data };
}

function backendFetcher(payload, { fail = false } = {}) {
  return async () => {
    if (fail) throw new Error("ECONNREFUSED");
    return { status: 200, json: async () => payload };
  };
}

async function readSnapshot(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("NEO brain bootstrap revision-keyed cache", () => {
  let dir;
  let snapshotPath;

  beforeEach(async () => {
    dir = await mkdtemp(resolve(tmpdir(), "neo-brain-rev-"));
    snapshotPath = resolve(dir, "brain-live.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("(a) rejects a legacy snapshot that has no brain_revision", async () => {
    await writeFile(
      snapshotPath,
      JSON.stringify(snapshotEnvelope({ revision: null, marker: "STALE_CONTEXT_MARKER_OLD", includeRevision: false })),
      "utf8"
    );

    // Pure decision
    const parsed = await readSnapshot(snapshotPath);
    const inspected = inspectSnapshot(parsed);
    assert.equal(inspected.usable, false);
    assert.equal(inspected.reason, "SNAPSHOT_REVISION_MISSING");

    // End-to-end: backend + GitHub both down, only a legacy snapshot on disk -> refuse to serve
    const { result } = await resolveBootstrap({
      fetcher: backendFetcher(null, { fail: true }),
      snapshotPath,
      snapshotDir: dir,
      backend: "https://example.invalid/api",
      bridgeToken: "token",
      disableGithub: true
    });
    assert.equal(result, null, "revision-less snapshot must never be served");
  });

  it("(b) refreshes cleanly when cached brain_revision differs from the live backend", async () => {
    await writeFile(
      snapshotPath,
      JSON.stringify(snapshotEnvelope({ revision: REV_A, marker: "OLD" })),
      "utf8"
    );

    assert.deepEqual(shouldRefreshCache({ liveRevision: REV_B, cachedRevision: REV_A }), {
      refresh: true,
      reason: "REVISION_MISMATCH"
    });

    const { result, cache } = await resolveBootstrap({
      fetcher: backendFetcher(backendPayload(REV_B, "FRESH_CONTEXT")),
      snapshotPath,
      snapshotDir: dir,
      backend: "https://example.invalid/api",
      bridgeToken: "token",
      disableGithub: true
    });

    assert.equal(result.origin, "backend");
    assert.equal(result.revision, REV_B);
    assert.equal(cache.cache_written, true);
    assert.equal(cache.cache_refresh_reason, "REVISION_MISMATCH");
    assert.equal(cache.previous_cached_brain_revision, REV_A);

    // The stale snapshot was overwritten by the fresh payload, keyed on the new revision.
    const written = await readSnapshot(snapshotPath);
    assert.equal(written.brain_revision, REV_B);
    assert.equal(written.data.brain_revision, REV_B);
    assert.match(written.data.context, /FRESH_CONTEXT/);
    assert.doesNotMatch(written.data.context, /CACHED OLD/);
  });

  it("(c) serves cleanly when cached brain_revision matches the live backend", async () => {
    await writeFile(
      snapshotPath,
      JSON.stringify(snapshotEnvelope({ revision: REV_A, marker: "MATCH" })),
      "utf8"
    );

    assert.deepEqual(shouldRefreshCache({ liveRevision: REV_A, cachedRevision: REV_A }), {
      refresh: false,
      reason: "REVISION_MATCH"
    });

    const { result, cache } = await resolveBootstrap({
      fetcher: backendFetcher(backendPayload(REV_A, "SAME")),
      snapshotPath,
      snapshotDir: dir,
      backend: "https://example.invalid/api",
      bridgeToken: "token",
      disableGithub: true
    });

    assert.equal(result.origin, "backend");
    assert.equal(result.revision, REV_A);
    assert.equal(cache.cache_refresh_reason, "REVISION_MATCH");
    assert.equal(cache.staleness_warning, undefined, "no staleness warning on a confirmed match");

    const written = await readSnapshot(snapshotPath);
    assert.equal(written.brain_revision, REV_A);
  });

  it("serves a revision-keyed cache during an outage with an explicit staleness warning", async () => {
    await writeFile(
      snapshotPath,
      JSON.stringify(snapshotEnvelope({ revision: REV_A, marker: "KEYED" })),
      "utf8"
    );

    const { result, cache } = await resolveBootstrap({
      fetcher: backendFetcher(null, { fail: true }),
      snapshotPath,
      snapshotDir: dir,
      backend: "https://example.invalid/api",
      bridgeToken: "token",
      disableGithub: true
    });

    assert.ok(result, "revision-keyed cache is still usable during an outage");
    assert.equal(result.origin, "snapshot");
    assert.equal(cache.cached_brain_revision, REV_A);
    assert.equal(cache.live_brain_revision, null);
    assert.equal(cache.revision_freshness, "UNCONFIRMED");
    assert.equal(cache.staleness_warning, true);
    assert.match(cache.warning, /SERVING_CACHED_BRAIN_CONTEXT/);
  });

  it("flags MISMATCH freshness when a stale cached revision is compared to a known live one", () => {
    const notice = staleNotice({ cachedRevision: REV_A, liveRevision: REV_B });
    assert.equal(notice.revision_freshness, "MISMATCH");
    assert.equal(notice.cache_stale, true);
    assert.equal(notice.staleness_warning, true);
  });

  it("derives a revision from execution_truth when brain_revision is absent on a live payload", () => {
    assert.equal(payloadRevision({ execution_truth: { canonical_head_sha: REV_B } }), REV_B);
    assert.equal(payloadRevision({ brain_revision: "  " }), null);
    assert.equal(payloadRevision(null), null);
  });
});
