import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENTS,
  DEFAULT_AGENT_ID,
  PERSONA_FILES,
  PORTED_FILES,
  mergeAgentList,
  provisionWorkspace,
  workspacePath,
} from "../scripts/provision-neo-agent-parity.mjs";

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neo-parity-"));
  const source = path.join(root, "workspace");
  fs.mkdirSync(path.join(source, "skills", "digital-ambush"), { recursive: true });
  fs.writeFileSync(path.join(source, "AGENTS.md"), "OPERATOR RULES\n");
  fs.writeFileSync(path.join(source, "TOOLS.md"), "TOOLS\n");
  fs.writeFileSync(path.join(source, "HEARTBEAT.md"), "<!-- empty -->\n");
  fs.writeFileSync(path.join(source, "USER.md"), "Founder profile\n");
  fs.writeFileSync(path.join(source, "SOUL.md"), "TONE CONTRACT\n");
  fs.writeFileSync(path.join(source, "IDENTITY.md"), "SOURCE IDENTITY\n");
  fs.writeFileSync(path.join(source, "skills", "digital-ambush", "SKILL.md"), "skill\n");
  fs.writeFileSync(
    path.join(root, "openclaw.json"),
    JSON.stringify({ agents: { defaults: { model: { primary: "m" } } } }, null, 2),
  );
  return root;
}

describe("neo agent parity provisioner", () => {
  it("covers exactly the six required agents", () => {
    assert.deepEqual(
      AGENTS.map((a) => a.id),
      ["neo", "brian", "mark", "kerry", "sophie", "ads"],
    );
  });

  it("ports operational boot files and creates each agent's own workspace", () => {
    const root = makeRoot();
    for (const agent of AGENTS) {
      const srcDir = agent.inheritFrom ? path.join(root, agent.inheritFrom) : null;
      provisionWorkspace({
        root,
        id: agent.id,
        sourceId: agent.portFrom ?? null,
        sourceDir: srcDir,
      });
      const dir = workspacePath(root, agent.id);
      assert.ok(fs.existsSync(dir), `${agent.id} workspace missing`);
      for (const file of PORTED_FILES) {
        assert.ok(fs.existsSync(path.join(dir, file)), `${agent.id} missing ${file}`);
      }
    }
  });

  it("gives every agent a distinct identity rather than copying neo's", () => {
    const root = makeRoot();
    for (const agent of AGENTS) {
      const srcDir = agent.inheritFrom ? path.join(root, agent.inheritFrom) : null;
      provisionWorkspace({ root, id: agent.id, sourceId: agent.portFrom ?? null, sourceDir: srcDir });
    }
    const identities = AGENTS.map((a) =>
      fs.readFileSync(path.join(workspacePath(root, a.id), "IDENTITY.md"), "utf8"),
    );
    // No two agents share an identity file, and none is a byte copy of the source.
    assert.equal(new Set(identities).size, AGENTS.length);
    const sourceIdentity = fs.readFileSync(path.join(root, "workspace", "IDENTITY.md"), "utf8");
    assert.ok(!identities.includes(sourceIdentity));
  });

  it("never overwrites an existing persona on a re-run", () => {
    const root = makeRoot();
    provisionWorkspace({ root, id: "neo", sourceId: null, sourceDir: path.join(root, "workspace") });
    provisionWorkspace({ root, id: "brian", sourceId: "neo", sourceDir: null });
    const dir = workspacePath(root, "brian");
    fs.writeFileSync(path.join(dir, "SOUL.md"), "BRIAN'S OWN VOICE\n");
    fs.writeFileSync(path.join(dir, "IDENTITY.md"), "BRIAN'S OWN IDENTITY\n");

    const plan = provisionWorkspace({ root, id: "brian", sourceId: "neo", sourceDir: null });

    assert.equal(fs.readFileSync(path.join(dir, "SOUL.md"), "utf8"), "BRIAN'S OWN VOICE\n");
    assert.equal(fs.readFileSync(path.join(dir, "IDENTITY.md"), "utf8"), "BRIAN'S OWN IDENTITY\n");
    assert.ok(plan.actions.includes("SOUL.md: preserved"));
    assert.ok(plan.actions.includes("IDENTITY.md: preserved"));
  });

  it("is idempotent: a second run rewrites no ported file", () => {
    const root = makeRoot();
    // neo must exist first: it is the source the others inherit from.
    provisionWorkspace({ root, id: "neo", sourceId: null, sourceDir: path.join(root, "workspace") });
    provisionWorkspace({ root, id: "mark", sourceId: "neo", sourceDir: null });
    const second = provisionWorkspace({ root, id: "mark", sourceId: "neo", sourceDir: null });
    for (const file of PORTED_FILES) {
      assert.ok(second.actions.includes(`${file}: already current`), `${file} was rewritten`);
    }
  });

  it("keeps persona files out of the ported set", () => {
    for (const file of PERSONA_FILES) {
      assert.ok(!PORTED_FILES.includes(file), `${file} must never be ported`);
    }
  });

  it("links skills to a single source of truth instead of copying them", () => {
    const root = makeRoot();
    provisionWorkspace({ root, id: "neo", sourceId: null, sourceDir: path.join(root, "workspace") });
    provisionWorkspace({ root, id: "kerry", sourceId: "neo", sourceDir: null });
    const link = path.join(workspacePath(root, "kerry"), "skills");
    assert.ok(fs.lstatSync(link).isSymbolicLink(), "skills should be a symlink");
    assert.ok(fs.existsSync(path.join(link, "digital-ambush", "SKILL.md")));
  });

  it("merges all six agents and keeps main as the only default", () => {
    const merged = mergeAgentList([{ id: DEFAULT_AGENT_ID, default: true }]);
    const ids = new Set(merged.map((a) => a.id));
    for (const agent of AGENTS) {
      assert.ok(ids.has(agent.id), `${agent.id} dropped from agents.list`);
    }
    assert.equal(merged.filter((a) => a.default).length, 1);
    assert.equal(merged.find((a) => a.default).id, DEFAULT_AGENT_ID);
  });

  it("never discards an unrelated agent the founder added", () => {
    const merged = mergeAgentList([{ id: "main", default: true }, { id: "custom-agent" }]);
    assert.ok(merged.some((a) => a.id === "custom-agent"));
  });

  it("provides Brian full native tool access and a distinct stable workspace", () => {
    const root=makeRoot();
    const list=mergeAgentList([{id:"main",default:true}],root);
    const brian=list.find(x=>x.id==="brian");
    assert.equal(brian?.tools?.profile,"full");
    assert.equal(brian?.workspace,workspacePath(root,"brian"));
    assert.equal(list.find(x=>x.id==="main")?.default,true);
  });
  it("keeps user-provided Brian model routing rather than overwriting its model", () => {
    const brian=mergeAgentList([{id:"main",default:true},{id:"brian",model:"custom/code-model"}])
      .find(x=>x.id==="brian");
    assert.equal(brian?.model,"custom/code-model");
    assert.equal(brian?.tools?.profile,"full");
  });
  it("creates original main on an empty volume without making a specialist default", () => {
    const list=mergeAgentList([],makeRoot());
    assert.deepEqual(list.filter(x=>x.default).map(x=>x.id),["main"]);
  });
  it("preserves an existing model override on a ported agent", () => {
    const merged = mergeAgentList([
      { id: "main", default: true },
      { id: "brian", model: { primary: "special" } },
    ]);
    const brian = merged.find((a) => a.id === "brian");
    assert.deepEqual(brian.model, { primary: "special" });
  });
});
