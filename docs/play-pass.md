# Multiplayer passes

Online Blitz (`/play/multi/`) runs on a small room server. When passes are switched on, every player
joins with a **pass**: a signed token that is good for a set time and locks to the device that first
uses it.

## Ask for a pass (1 hour)

1. Open an issue with the **[Request a multiplayer pass](https://github.com/coded-dot-design/dom-battlefield-blitz/issues/new?template=play-pass.yml)**
   form (preferred time, mode, the house rules). It gets the `play-pass` label: the open `play-pass`
   issues are the queue.
2. A maintainer adds the `approved` label. Only a label added by someone with write access counts.
3. A bot comments with your pass. Open `/play/multi/`, paste it into **PASS**, pick the room you agreed
   on with your friends, and press **JOIN**. Everyone in the match needs their own pass.

What to know:

- **1 hour** from the comment. A match that's running when the hour is up plays to the end; after that
  the pass won't join a new one.
- **One device.** The comment is public, so the pass locks to the first device that joins with it.
  Rejoining from that device (a rematch, a reload in the same tab) works for the hour; any other
  device is refused. If someone got there first, close the issue and ask again.
- **Closing the issue revokes the pass.**
- The pass is kept in the tab's session storage only, never in a URL.

Some logins are approved without the label: `.github/play-pass-allow.json` (public GitHub logins only).

## Family and owner passes (private)

Longer passes for friends and family are minted by the owner and sent privately (a text message),
never posted in an issue:

```sh
PASS_SECRET=… node scripts/play-pass.mjs mint --family --name "Mom" --days 30 --devices 3   # prints the pass and its id
PASS_SECRET=… node scripts/play-pass.mjs mint --owner                                      # a year, 5 devices
PASS_SECRET=… node scripts/play-pass.mjs mint --batch 20 --days 7 --label beta-wave-1 --out beta-wave-1.passes.csv
ROOMS_ADMIN_KEY=… node scripts/play-pass.mjs list
ROOMS_ADMIN_KEY=… node scripts/play-pass.mjs revoke <id>
```

| Kind | Lasts at most | Devices at most | Minted by |
|---|---|---|---|
| play | 30 days (the workflow: 1 hour) | 3 (the workflow: 1) | the workflow, or `mint` |
| family | 30 days | 3 | `mint --family` |
| owner | 1 year | 5 | `mint --owner` only |

`--batch` writes `id,label,kind,exp,pass` to the `--out` file (owner-only permissions) and never to
the screen; `passes.csv` and `*.passes.csv` are gitignored. A `name` or `label` is a short label,
never an email.

## How it works

A pass is `base64url(payload).base64url(HMAC-SHA256(payload, PASS_SECRET))`, payload
`{v:1, id, exp, kind?, dev?, gh?, issue?, name?}`. `scripts/play-pass.mjs` mints it (no
dependencies); the room server ([fizlet `rooms/`](https://github.com/coded-dot-design/fizlet/tree/main/rooms))
checks the signature and expiry, keeps which devices hold each pass until it expires, and refuses
revoked ones. The page makes a random device key once per device and sends it with the pass.
The workflow is `.github/workflows/play-pass.yml` (no third-party actions).

## Switching it on (owner)

1. Create the labels `play-pass` and `approved` in this repo.
2. Add the repo Actions secrets `PASS_SECRET` and `ROOMS_ADMIN_KEY` (optional: the variable `ROOMS_URL`).
3. Add the same two values as Worker secrets on the room server (`wrangler secret put PASS_SECRET`,
   `wrangler secret put ROOMS_ADMIN_KEY`) and deploy it.
4. Set `REQUIRE_PASS = "true"` in the room server's `wrangler.toml` and deploy again.

Until step 4, invite codes work as before and the PASS field stays hidden. Until step 2, an approved
request gets a "passes aren't switched on yet" comment.
