# EffectGate

[English](README.md) | [中文](README.zh-CN.md)

Project-defined tripwires for AI coding agents.

Claude Code, Codex, and local scripts run as usual. EffectGate only steps in when one of them is about to trigger a production-impacting effect that you registered in the project — then it blocks, leaves a local pending alert, and writes an audit receipt.

```text
EffectGate blocked a protected effect

Decision: ASK
Tripwire: billing.charge
Risk: money_movement
Command: npm run backfill-prod

Matched evidence:
- billing.charge: keyword chargeCustomer
- billing.charge: file scripts/backfill/payments.ts

Approve narrowly:
- effectgate approve billing.charge --ttl 10m --max-calls 1 --scope session
```

## Quick start

Working from this repo while developing:

```bash
npm install
npm link

# Try the demo:
effectgate demo --dir /tmp
cd /tmp/effectgate-demo
effectgate bar --once
```

Protect a real repo:

```bash
effectgate setup \
  --protect billing.charge \
  --keyword chargeCustomer \
  --file 'src/billing/**' \
  --risk money_movement \
  --cli-bar
effectgate list
effectgate verify-install billing.charge --surface cli
./.effectgate/effectgate-bar.sh --json
```

Once the package is published, install it globally:

```bash
npm install -g effectgate
```

## The status bar

`effectgate bar` is a terminal status bar. When a registered effect is attempted, it shows a red-light alert:

```text
EffectGate: 1 pending - billing.charge
```

Clear alerts with `effectgate pending`, `effectgate approve <effect-id>`, or `effectgate deny <pending-id>`. Add `--recent 1h` to also surface recently approved effects that actually ran:

```bash
effectgate bar --once --recent 1h
```

After setup, `effectgate test-alert <effect-id>` creates a safe local alert so you can confirm your CLI bar, daemon, or desktop menu bar is watching the same project state. `effectgate verify-install <effect-id>` does it in one shot: it creates the alert, checks the CLI bar, and checks the daemon path the desktop menu bar reads from. Add `--surface cli` or `--surface desktop` to also prove the project-local helper script or LaunchAgents are installed — the desktop check runs the menu-bar binary in self-test mode and confirms it can read the pending effect from the daemon.

To feed the bar into tmux, sketchybar, waybar, a shell prompt, or any script:

```bash
effectgate bar --once --json
effectgate install cli-bar
effectgate verify-install billing.charge --surface cli
./.effectgate/effectgate-bar.sh --json
```

The installed helper defaults to `--recent 24h`, so a status bar shows both pending approvals and effects that already ran. Change the window with `EFFECTGATE_RECENT_WINDOW=1h ./.effectgate/effectgate-bar.sh --json`, or pass a `--recent` flag.

## macOS menu bar

```bash
effectgate setup \
  --protect billing.charge \
  --keyword chargeCustomer \
  --risk money_movement \
  --desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

This registers the effect, builds `~/.effectgate/EffectGateMenuBar`, writes two project-scoped LaunchAgents, starts the local daemon for the current repo, and shows pending effects in the menu bar. Each project gets a stable local daemon port; run `effectgate install desktop --port 9555` to pick your own. The installer points the menu bar at the matching `EFFECTGATE_DAEMON_URL` so both watch the same daemon.

Pending items in the menu carry `Approve 10m` and `Deny` actions backed by the local daemon. When nothing is pending, the menu lists recently executed effects from the local audit log. If the daemon is offline, the menu shows an offline status and the URL — never a fake approval.

## Configure tripwires

Most projects can start without touching YAML:

```bash
effectgate protect prod-db-delete \
  --keyword deleteTenant \
  --sql 'DELETE\s+FROM\s+users' \
  --env 'DATABASE_URL=*prod*' \
  --risk irreversible_data_delete \
  --max-ttl 30m \
  --max-calls 1
```

`effectgate protect` creates or updates `.effectgate.yaml` and deduplicates repeated registrations. Edit the YAML directly when you want reviewable, hand-tuned rules:

```yaml
tripwires:
  - id: prod-db-delete
    risk: irreversible_data_delete
    match:
      keywords: ["deleteTenant", "dropUserData"]
      files: ["src/**", "migrations/**"]
      sql: ["DELETE\\\\s+FROM\\\\s+users", "DROP\\\\s+TABLE"]
    when:
      env:
        DATABASE_URL: "*prod*"
    action: ask
    approvals:
      max_ttl: "30m"
      max_calls: 1
```

## CLI

```bash
effectgate run -- npm run backfill-prod
effectgate setup
effectgate protect billing.charge --keyword chargeCustomer --risk money_movement
effectgate list
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate install cli-bar
effectgate verify-install billing.charge --surface cli
effectgate approve prod-db-delete --ttl 10m --max-calls 1 --scope session
effectgate pending
effectgate deny <pending-id>
effectgate bar --once
effectgate bar --once --json
effectgate bar --once --recent 1h
effectgate status
effectgate audit
effectgate demo --dir /tmp
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate verify-install billing.charge --surface desktop
effectgate scan-sql 'DROP TABLE users;'
effectgate scan-java src/main/java/AdminOps.java
effectgate doctor
```

Approvals are local, narrow, expiring tokens stored under `.effectgate/`. Pending alerts live in `.effectgate/pending.json`; audit receipts are JSONL in `.effectgate/audit.jsonl`.

## Runtime guards

Node:

```js
import { effect } from './src/sdk/node.js';

export const chargeCustomer = effect('billing.charge', (customerId) => {
  return stripe.charges.create({ customer: customerId });
});
```

Python:

```python
from effectgate import effect

@effect("billing.charge")
def charge_customer(customer_id):
    return stripe.Charge.create(customer=customer_id)
```

Java:

```java
EffectGate.check("prod-db-delete", "[\\"tenant-123\\"]");
```

## Claude Code and Codex

Install the Claude Code hook into the current project:

```bash
effectgate install claude
```

That writes `.claude/settings.local.json` with a Bash `PreToolUse` hook that wraps commands as `effectgate run -- <original command>`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/EffectGate/adapters/claude/pre-tool-use.js"
          }
        ]
      }
    ]
  }
}
```

Codex plugin assets live in `plugins/codex/effectgate`. Check the path and install steps with:

```bash
effectgate install codex --dry-run
```

Both adapters wrap Bash commands the same way:

```bash
effectgate run -- <original command>
```

## Desktop daemon

The CLI ships a local daemon and a small macOS menu-bar companion:

```bash
effectgate daemon --port 8765
curl http://127.0.0.1:8765/pending
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate install desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

Approvals and audit receipts run over local-only endpoints; there is no cloud service.

The macOS installer builds the source in `desktop/macos/`, writes LaunchAgents under `~/Library/LaunchAgents`, and scopes the daemon to the current repo. By default it picks a stable project-local port in the `8765-9764` range and writes the same URL into the menu-bar LaunchAgent. `effectgate verify-install <effect-id> --surface desktop` checks those LaunchAgents and runs the menu-bar binary with `EFFECTGATE_SELF_TEST=1` against a local daemon.

Dry-run without writing files:

```bash
effectgate install desktop --dry-run
effectgate install desktop --port 9555 --dry-run
```

The daemon API is local-only:

- `GET /pending`
- `GET /summary?recent=1h`
- `GET /approvals`
- `GET /audit`
- `POST /approve`
- `POST /deny`

## Why not just use the agent's auto mode?

An agent's built-in auto mode catches generic danger — force pushes, broad deletes, secret exfiltration, production deploys. EffectGate covers the effects that only your codebase knows are dangerous:

- `chargeCustomer()`
- `deleteTenant()`
- `runBillingMigration()`
- `DROP TABLE`, or a `DELETE` with no `WHERE`
- Java methods or packages with production side effects

It is not meant to ask about every action. Ordinary commands pass silently, and EffectGate only interrupts when a registered tripwire fires — then it leaves a pending alert and an audit receipt. Once an effect is approved and runs, `bar --recent` and the desktop menu can show that it happened without turning it into another prompt.

## Demo

```bash
effectgate demo --dir /tmp
```

This creates `/tmp/effectgate-demo`, registers `billing.charge`, simulates a protected call, and leaves a pending alert:

```text
EffectGate: 1 pending - billing.charge
```

That is the whole idea: an agent works freely until it crosses a line your project drew.
