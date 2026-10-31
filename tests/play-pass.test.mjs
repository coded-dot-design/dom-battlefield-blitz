// scripts/play-pass.mjs: the pass format, the workflow on fake events and a mocked GitHub REST API,
// and the owner's mint CLI. No network: every fetch is a fake.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIMITS, MARK, allowList, cli, mint, onEvent, payload, verify } from "../scripts/play-pass.mjs";

const SECRET = "test-only-pass-secret-0123456789", ADMIN = "test-only-admin-key-0123456789", T0 = 1_800_000_000;
const ENV = { GITHUB_API_URL: "https://api.example", GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "test-token", PASS_SECRET: SECRET, ROOMS_ADMIN_KEY: ADMIN, ROOMS_URL: "https://rooms.example" };
const root = fileURLToPath(new URL("..", import.meta.url));

/** A fake GitHub + rooms server: records calls; `perms` maps login → role_name; `comments` per issue. */
function fake({ perms = { chris: "admin" }, comments = [] } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body, auth: init.headers?.authorization });
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    let m;
    if ((m = /\/collaborators\/([^/]+)\/permission$/.exec(url))) return perms[m[1]] ? ok({ permission: perms[m[1]] === "maintain" ? "write" : perms[m[1]], role_name: perms[m[1]] }) : ok({ message: "not a collaborator" }, 404);
    if (/\/issues\/\d+\/comments\?/.test(url)) return ok(comments);
    if (/\/issues\/\d+\/comments$/.test(url) && init.method === "POST") return ok({ id: 1 }, 201);
    if (url === "https://rooms.example/pass/revoke") return ok({ ok: true });
    return ok({}, 404);
  };
  return { f, calls, posted: () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/comments")).map((c) => JSON.parse(c.body).body) };
}
const issue = (o = {}) => ({ number: 12, state: "open", user: { login: "requester" }, labels: [{ name: "play-pass" }], ...o });
const labeled = (by, name = "approved", o = {}) => ({ action: "labeled", label: { name }, sender: { login: by }, issue: issue(o) });
const passIn = (body) => /```\n(\S+)\n```/.exec(body)?.[1];

test("format: mint and verify round trip; tampered, expired and wrong-secret passes are refused", () => {
  const p = payload({ seconds: 3600, dev: 1, gh: "requester", issue: 12, now: T0 });
  assert.match(p.id, /^[A-Za-z0-9_-]{16}$/, "96 random bits, base64url");
  assert.deepEqual(Object.keys(p), ["v", "id", "exp", "gh", "issue"]);
  const pass = mint(p, SECRET);
  assert.deepEqual(verify(pass, SECRET, T0), p);
  const [body, sig] = pass.split(".");
  const forged = Buffer.from(JSON.stringify({ ...p, exp: p.exp + 86400 })).toString("base64url") + "." + sig;
  assert.equal(verify(forged, SECRET, T0), null, "tampered payload");
  assert.equal(verify(body + "." + sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A"), SECRET, T0), null, "tampered signature");
  assert.equal(verify(pass, "another-secret-entirely-000000", T0), null, "wrong secret");
  assert.equal(verify(pass, SECRET, T0 + 3600), null, "expired");
  assert.equal(verify("junk", SECRET), null);
  assert.throws(() => mint(p, ""), /PASS_SECRET/);
  // The ceilings the room server enforces.
  assert.throws(() => payload({ seconds: 31 * 86400, dev: 1, now: T0 }), /30 days/);
  assert.throws(() => payload({ kind: "family", seconds: 86400, dev: 4, now: T0 }), /1 to 3 devices/);
  assert.throws(() => payload({ kind: "family", seconds: 86400, dev: 3, name: "mom@example.com", now: T0 }), /never an email/);
  assert.deepEqual(LIMITS.owner, [365, 5]);
});

test("workflow: `approved` added by a maintainer posts a 1-hour, one-device pass as a comment", async () => {
  const gh = fake();
  assert.equal(await onEvent({ event: labeled("chris"), env: ENV, fetch: gh.f, now: T0 }), "issued");
  const [body] = gh.posted();
  assert.ok(body.startsWith(MARK));
  assert.match(body, /1 hour/);
  assert.match(body, /first device/);
  const p = verify(passIn(body), SECRET, T0);
  assert.deepEqual([p.gh, p.issue, p.exp, p.dev, p.kind], ["requester", 12, T0 + 3600, undefined, undefined]);
  assert.ok(gh.calls.every((c) => !c.url.includes(SECRET) && !String(c.body).includes(ADMIN)), "no secret in a URL or body");
});

test("workflow: a label from someone without write access, another label, or a closed issue does nothing", async () => {
  for (const [event, why] of [
    [labeled("stranger"), /without write access/],
    [labeled("reader-user"), /without write access/],
    [labeled("chris", "bug"), /not the approved label/],
    [labeled("chris", "approved", { labels: [{ name: "question" }] }), /not a play-pass issue/],
    [labeled("chris", "approved", { state: "closed" }), /not open/],
    [{ action: "opened", sender: { login: "requester" }, issue: issue() }, /not on the allowlist/],
  ]) {
    const gh = fake({ perms: { chris: "admin", "reader-user": "triage" } });
    assert.match(await onEvent({ event, env: ENV, fetch: gh.f, now: T0 }), why);
    assert.equal(gh.posted().length, 0);
  }
  for (const role of ["maintain", "write"]) {
    const gh = fake({ perms: { m: role } });
    assert.equal(await onEvent({ event: labeled("m"), env: ENV, fetch: gh.f, now: T0 }), "issued", role);
  }
});

test("workflow: no PASS_SECRET → it says passes aren't switched on yet, and exits cleanly", async () => {
  const gh = fake();
  assert.match(await onEvent({ event: labeled("chris"), env: { ...ENV, PASS_SECRET: "" }, fetch: gh.f, now: T0 }), /^off/);
  assert.match(gh.posted()[0], /Passes aren't switched on yet/);
  assert.equal(passIn(gh.posted()[0]), undefined);
});

test("workflow: an allowlisted login's new request gets a pass without a label", async () => {
  const gh = fake(), allow = new Set(["requester"]);
  assert.equal(await onEvent({ event: { action: "opened", sender: { login: "requester" }, issue: issue({ user: { login: "Requester" } }) }, env: ENV, fetch: gh.f, now: T0, allow }), "issued");
  assert.ok(verify(passIn(gh.posted()[0]), SECRET, T0));
  const list = JSON.parse(readFileSync(new URL("../.github/play-pass-allow.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(list.logins) && list.logins.every((l) => /^[A-Za-z0-9-]{1,39}$/.test(l)), "public GitHub logins only");
  assert.equal(allowList(new URL("../.github/play-pass-allow.json", import.meta.url)).size, list.logins.length);
});

test("workflow: closing the issue revokes its live passes (the bot's comments only); no admin key → skipped", async () => {
  const live = mint(payload({ seconds: 3600, dev: 1, now: T0 }), SECRET), old = mint(payload({ seconds: 3600, dev: 1, now: T0 - 7200 }), SECRET);
  const fakeOne = mint(payload({ seconds: 3600, dev: 1, now: T0 }), "someone-elses-secret-000000000");
  const block = (p) => `${MARK}\n\n\`\`\`\n${p}\n\`\`\`\n`;
  const comments = [
    { user: { login: "github-actions[bot]" }, body: block(live) },
    { user: { login: "github-actions[bot]" }, body: block(old) },
    { user: { login: "github-actions[bot]" }, body: block(fakeOne) },
    { user: { login: "requester" }, body: block(live) },
  ];
  const gh = fake({ comments });
  assert.equal(await onEvent({ event: { action: "closed", sender: { login: "requester" }, issue: issue({ state: "closed" }) }, env: ENV, fetch: gh.f, now: T0 }), "revoked 1");
  const r = gh.calls.filter((c) => c.url === "https://rooms.example/pass/revoke");
  assert.equal(r.length, 1);
  assert.equal(r[0].body, live);
  assert.equal(r[0].auth, `Bearer ${ADMIN}`);
  const off = fake({ comments });
  assert.match(await onEvent({ event: { action: "closed", issue: issue({ state: "closed" }) }, env: { ...ENV, ROOMS_ADMIN_KEY: "" }, fetch: off.f, now: T0 }), /skip/);
  assert.equal(off.calls.length, 0);
});

test("cli: a family pass (30 days, 3 devices) prints only the pass and its id", async () => {
  const out = [];
  await cli(["mint", "--family", "--name", "Mom", "--days", "30", "--devices", "3"], { out: (l) => out.push(l), env: { PASS_SECRET: SECRET }, now: T0 });
  assert.equal(out.length, 2);
  const p = verify(out[0], SECRET, T0);
  assert.deepEqual([p.kind, p.name, p.dev, p.exp, p.id], ["family", "Mom", 3, T0 + 30 * 86400, out[1]]);
  await assert.rejects(cli(["mint", "--family", "--days", "31"], { out() {}, env: { PASS_SECRET: SECRET }, now: T0 }), /30 days/);
  await assert.rejects(cli(["mint", "--family"], { out() {}, env: {}, now: T0 }), /PASS_SECRET/);
});

test("cli: an owner pass holds 5 devices for a year", async () => {
  const out = [];
  await cli(["mint", "--owner", "--name", "Chris"], { out: (l) => out.push(l), env: { PASS_SECRET: SECRET }, now: T0 });
  const p = verify(out[0], SECRET, T0);
  assert.deepEqual([p.kind, p.dev, p.exp], ["owner", 5, T0 + 365 * 86400]);
  await assert.rejects(cli(["mint", "--owner", "--devices", "6"], { out() {}, env: { PASS_SECRET: SECRET }, now: T0 }), /1 to 5 devices/);
});

test("cli: --batch writes N unique, valid passes to the --out CSV and nothing secret to stdout", async () => {
  const out = [], files = {};
  await cli(["mint", "--batch", "20", "--days", "7", "--devices", "1", "--label", "beta-wave-1", "--out", "passes.csv"], { out: (l) => out.push(l), env: { PASS_SECRET: SECRET }, now: T0, write: (f, t, o) => (files[f] = [t, o]) });
  assert.deepEqual(out, ["wrote 20 play passes to passes.csv"]);
  assert.equal(files["passes.csv"][1].mode, 0o600, "owner-only file");
  const [head, ...rows] = files["passes.csv"][0].trim().split("\n");
  assert.equal(head, "id,label,kind,exp,pass");
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((r) => r.split(",")[0])).size, 20, "unique ids");
  for (const r of rows) {
    const [id, label, kind, exp, pass] = r.split(",");
    const p = verify(pass, SECRET, T0);
    assert.deepEqual([p.id, p.name, kind, exp, p.exp], [id, "beta-wave-1", "play", new Date((T0 + 7 * 86400) * 1000).toISOString(), T0 + 7 * 86400]);
  }
  await assert.rejects(cli(["mint", "--batch", "3"], { out() {}, env: { PASS_SECRET: SECRET }, now: T0 }), /--out/);
});

test("cli: list and revoke <id> call the room server with the admin key", async () => {
  const calls = [], out = [];
  const f = async (url, init) => (calls.push({ url, body: init.body, auth: init.headers.authorization }), { ok: true, status: 200, json: async () => (url.endsWith("/list") ? { passes: [], revoked: [] } : { ok: true, id: init.body }) });
  await cli(["revoke", "FaMiLyPaSs000001"], { out: (l) => out.push(l), env: { ROOMS_ADMIN_KEY: ADMIN, ROOMS_URL: "https://rooms.example" }, fetch: f });
  await cli(["list"], { out: (l) => out.push(l), env: { ROOMS_ADMIN_KEY: ADMIN, ROOMS_URL: "https://rooms.example" }, fetch: f });
  assert.deepEqual(calls.map((c) => [c.url, c.body, c.auth]), [["https://rooms.example/pass/revoke", "FaMiLyPaSs000001", `Bearer ${ADMIN}`], ["https://rooms.example/pass/list", "", `Bearer ${ADMIN}`]]);
  assert.equal(out[0], "revoked FaMiLyPaSs000001");
  await assert.rejects(cli(["list"], { out() {}, env: {}, fetch: f }), /ROOMS_ADMIN_KEY/);
});

test("repo: minted pass files are gitignored", () => {
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "passes.csv", "beta-wave-1.passes.csv", "scripts/x.passes.csv"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.equal(ignored.length, 3);
});

test("repo: the issue form and workflow are wired to the script, pinned, and free of third-party actions", () => {
  const wf = readFileSync(new URL("../.github/workflows/play-pass.yml", import.meta.url), "utf8");
  assert.match(wf, /runs-on: ubuntu-24\.04/);
  assert.match(wf, /types: \[opened, labeled, closed\]/);
  assert.match(wf, /node scripts\/play-pass\.mjs event/);
  const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.every((u) => /^actions\/checkout@[0-9a-f]{40}$/.test(u)), uses.join());
  assert.ok(!/\$\{\{\s*github\.event\.issue\.(title|body)/.test(wf), "no issue text in the workflow");
  const form = readFileSync(new URL("../.github/ISSUE_TEMPLATE/play-pass.yml", import.meta.url), "utf8");
  assert.match(form, /name: Request a multiplayer pass/);
  assert.match(form, /labels: \["play-pass"\]/);
});
