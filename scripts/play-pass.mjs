#!/usr/bin/env node
// Multiplayer play passes for /play/multi/ (docs/play-pass.md). No dependencies (Node 20+).
//
// A pass is base64url(payload).base64url(HMAC-SHA256(payload, PASS_SECRET)), payload
// { v: 1, id (96 random bits), exp (Unix s), kind?, dev?, gh?, issue?, name? }. The room server
// (fizlet rooms/src/pass.js) checks it with the same secret and locks it to the first `dev` devices.
//
//   node scripts/play-pass.mjs event      the play-pass workflow: issue labeled `approved` (by someone
//                                         with write access) → a 1-hour pass as a comment; issue
//                                         closed → its passes revoked. Reads GITHUB_EVENT_PATH.
//   PASS_SECRET=… node scripts/play-pass.mjs mint [--family | --owner] [--name Mom] [--days 30 | --hours 1] [--devices 3]
//                                         one pass: prints only the pass and its id (deliver it privately)
//   PASS_SECRET=… node scripts/play-pass.mjs mint --batch 20 --days 7 --devices 1 --label beta-wave-1 --out passes.csv
//                                         N passes to a CSV (id,label,kind,exp,pass), never to stdout
//   ROOMS_ADMIN_KEY=… node scripts/play-pass.mjs list | revoke <id or pass>
//                                         the room server's pass store (ROOMS_URL overrides the server)
//
// Secrets come from the environment only and are never printed.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOMS_URL = "https://fizlet-rooms.fizlet.workers.dev";
export const PLAY_URL = "https://battlefieldblitz.domvirus.com/play/multi/";
export const MARK = "<!-- play-pass -->";
const LABEL = "play-pass", APPROVED = "approved", BOT = "github-actions[bot]";
const WRITERS = new Set(["admin", "maintain", "write"]);
const HOUR = 3600, DAY = 86400;
/** [days, devices] at most, per kind: the room server refuses anything over these (PASS_LIMITS). */
export const LIMITS = { play: [30, 3], family: [30, 3], owner: [365, 5] };

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (body, secret) => createHmac("sha256", secret).update(body).digest("base64url");

export const newId = () => b64u(randomBytes(12));

/** Sign a payload into a pass. */
export function mint(payload, secret) {
  if (!secret) throw new Error("PASS_SECRET is not set");
  const body = b64u(JSON.stringify(payload));
  return body + "." + sign(body, secret);
}

/** The payload of a pass this secret signed (null otherwise). `now` given: also refuses an expired one. */
export function verify(pass, secret, now) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(pass ?? ""));
  if (!m || !secret) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1], secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], "base64url").toString());
    return now != null && !(p.exp > now) ? null : p;
  } catch {
    return null;
  }
}

/** A payload for one pass, checked against the kind's ceilings. */
export function payload({ kind = "play", seconds, dev, name, gh, issue, now = Math.floor(Date.now() / 1000) }) {
  const [days, devices] = LIMITS[kind] ?? [];
  if (!days) throw new Error(`kind: play, family or owner`);
  if (!(seconds > 0 && seconds <= days * DAY)) throw new Error(`${kind}: 1 second to ${days} days`);
  if (!(Number.isInteger(dev) && dev >= 1 && dev <= devices)) throw new Error(`${kind}: 1 to ${devices} devices`);
  if (name != null && !/^[\p{L}\p{N} _.'-]{1,32}$/u.test(name)) throw new Error("name: a short label (letters, numbers, - _ . '), never an email");
  const p = { v: 1, id: newId(), exp: now + Math.round(seconds) };
  if (kind !== "play") p.kind = kind;
  if (dev !== 1) p.dev = dev;
  if (gh) p.gh = gh;
  if (issue) p.issue = issue;
  if (name) p.name = name;
  return p;
}

// --- the workflow -------------------------------------------------------------------------------

/** The GitHub REST API with the job's token (`fetch` injectable for tests). */
function api(env, fetchFn) {
  const base = (env.GITHUB_API_URL || "https://api.github.com") + "/repos/" + env.GITHUB_REPOSITORY;
  return async (path, init = {}) => {
    const r = await fetchFn(base + path, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}) } });
    if (!r.ok) throw new Error(`GitHub API ${init.method ?? "GET"} ${path}: ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
}

/** Logins whose requests are approved without a label (.github/play-pass-allow.json: public GitHub logins). */
export function allowList(file) {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return new Set((Array.isArray(list) ? list : list.logins ?? []).map((l) => String(l).toLowerCase()));
  } catch {
    return new Set();
  }
}

export function passComment({ pass, login, exp }) {
  const at = new Date(exp * 1000).toISOString().replace("T", " ").slice(0, 16);
  return [
    MARK,
    `**Your multiplayer pass**, @${login}. It's good for **1 hour**: until **${at} UTC**.`,
    "",
    "```",
    pass,
    "```",
    "",
    `1. Open [Battlefield Blitz · multiplayer](${PLAY_URL}).`,
    "2. Paste the pass into **PASS**, enter the room you agreed on, and press **JOIN**. Everyone in the match needs their own pass.",
    "",
    "- **It locks to the first device that uses it.** This comment is public, so use it soon: on another device it won't work. If someone got there first, close this issue and ask again.",
    "- A match that's running when the hour is up plays to the end; after that the pass won't join a new one.",
    "- Closing this issue revokes the pass.",
  ].join("\n");
}

export const OFF_COMMENT = `${MARK}\nThanks! Passes aren't switched on yet, so there's nothing to send. A maintainer will be in touch here when they are.`;

/**
 * Handle one `issues` event. Returns what it did (a short word for the log; never the pass).
 * ctx: { event, env, fetch, now, allow }.
 */
export async function onEvent({ event, env, fetch: fetchFn = fetch, now = Math.floor(Date.now() / 1000), allow = new Set() }) {
  const issue = event.issue, gh = api(env, fetchFn);
  if (!issue || issue.pull_request) return "skip: not an issue";
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  if (!labels.includes(LABEL)) return "skip: not a play-pass issue";
  const author = issue.user?.login;

  if (event.action === "closed") {
    if (!env.PASS_SECRET || !env.ROOMS_ADMIN_KEY) return "skip: revoking isn't switched on";
    let revoked = 0;
    for (let page = 1; page <= 10; page++) {
      const comments = await gh(`/issues/${issue.number}/comments?per_page=100&page=${page}`);
      for (const c of comments) {
        if (c.user?.login !== BOT || !c.body?.startsWith(MARK)) continue;
        const pass = /```\n([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\n```/.exec(c.body)?.[1];
        // Only passes this secret signed that could still be used.
        if (!pass || !verify(pass, env.PASS_SECRET, now)) continue;
        const r = await fetchFn((env.ROOMS_URL || ROOMS_URL) + "/pass/revoke", { method: "POST", headers: { authorization: `Bearer ${env.ROOMS_ADMIN_KEY}`, "content-type": "text/plain" }, body: pass });
        if (!r.ok) throw new Error(`revoke: ${r.status}`);
        revoked++;
      }
      if (comments.length < 100) break;
    }
    return `revoked ${revoked}`;
  }

  if (issue.state !== "open") return "skip: issue not open";
  if (event.action === "labeled") {
    if (event.label?.name !== APPROVED) return "skip: not the approved label";
    // Only a label added by someone with write access counts.
    const who = event.sender?.login;
    if (!who) return "skip: no sender";
    const perm = await gh(`/collaborators/${encodeURIComponent(who)}/permission`).catch(() => null);
    if (!perm || !(WRITERS.has(perm.role_name) || WRITERS.has(perm.permission))) return "skip: labeled by someone without write access";
  } else if (event.action === "opened") {
    // Auto-approve: the requester is on the allowlist (a label isn't needed).
    if (!author || !allow.has(author.toLowerCase())) return "skip: not on the allowlist";
  } else return `skip: ${event.action}`;

  if (!env.PASS_SECRET) {
    await gh(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: OFF_COMMENT }) });
    return "off: passes aren't switched on";
  }
  const p = payload({ seconds: HOUR, dev: 1, gh: author, issue: issue.number, now });
  await gh(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: passComment({ pass: mint(p, env.PASS_SECRET), login: author, exp: p.exp }) }) });
  return "issued";
}

// --- the owner's CLI ----------------------------------------------------------------------------

function flags(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) o._.push(a);
    else if (["--family", "--owner"].includes(a)) o[a.slice(2)] = true;
    else o[a.slice(2)] = argv[++i];
  }
  return o;
}
const num = (v, what) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${what}: a positive number`);
  return n;
};
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The CLI. io: { out(line), env, fetch, write(file, text), now }. Returns an exit code. */
export async function cli(argv, { out = console.log, env = process.env, fetch: fetchFn = fetch, write = writeFileSync, now = Math.floor(Date.now() / 1000) } = {}) {
  const [cmd, ...rest] = argv, f = flags(rest);
  if (cmd === "mint") {
    const kind = f.owner ? "owner" : f.family ? "family" : "play";
    const days = num(f.days, "--days"), hours = num(f.hours, "--hours");
    const seconds = days ? days * DAY : hours ? hours * HOUR : { play: HOUR, family: 30 * DAY, owner: 365 * DAY }[kind];
    const dev = num(f.devices, "--devices") ?? { play: 1, family: 3, owner: 5 }[kind];
    if (f.batch != null) {
      const n = num(f.batch, "--batch");
      if (!Number.isInteger(n) || n > 1000) throw new Error("--batch: 1 to 1000");
      if (!f.out) throw new Error("--batch needs --out <file.csv> (passes never go to stdout)");
      const label = f.label ?? f.name;
      const rows = ["id,label,kind,exp,pass"];
      for (let i = 0; i < n; i++) {
        const p = payload({ kind, seconds, dev, name: label, now });
        rows.push([p.id, label ?? "", kind, new Date(p.exp * 1000).toISOString(), mint(p, env.PASS_SECRET)].map(csvCell).join(","));
      }
      write(f.out, rows.join("\n") + "\n", { mode: 0o600 });
      out(`wrote ${n} ${kind} passes to ${f.out}`);
      return 0;
    }
    const p = payload({ kind, seconds, dev, name: f.name, now });
    out(mint(p, env.PASS_SECRET));
    out(p.id);
    return 0;
  }
  if (cmd === "list" || cmd === "revoke") {
    if (!env.ROOMS_ADMIN_KEY) throw new Error("ROOMS_ADMIN_KEY is not set");
    const what = cmd === "revoke" ? f._[0] : "";
    if (cmd === "revoke" && !what) throw new Error("revoke <id or pass>");
    const r = await fetchFn((env.ROOMS_URL || ROOMS_URL) + "/pass/" + cmd, { method: "POST", headers: { authorization: `Bearer ${env.ROOMS_ADMIN_KEY}`, "content-type": "text/plain" }, body: what });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${cmd}: ${r.status} ${body.error ?? ""}`.trim());
    out(cmd === "revoke" ? `revoked ${body.id}` : JSON.stringify(body, null, 2));
    return 0;
  }
  if (cmd === "event") {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const allow = allowList(new URL("../.github/play-pass-allow.json", import.meta.url));
    out(await onEvent({ event, env, fetch: fetchFn, now, allow }));
    return 0;
  }
  out("usage: play-pass.mjs event | mint [--family|--owner] [--name N] [--days D|--hours H] [--devices N] [--batch N --label L --out F] | list | revoke <id>");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(String(e.message ?? e));
      process.exitCode = 1;
    },
  );
}
