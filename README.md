# EffectGate

[English](README.md) | [中文](README.zh-CN.md)

Project-defined tripwires for AI coding agents.

EffectGate lets Claude Code, Codex, and local scripts work normally until they are about to trigger a production-impacting effect that your project explicitly registered.

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

## 60-Second Start

```bash
# From this repo while developing:
npm install
npm link

# See the product moment immediately:
effectgate demo --dir /tmp
cd /tmp/effectgate-demo
effectgate bar --once
```

Then protect a real repo:

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

For a published package, the intended install path is:

```bash
npm install -g effectgate
```

`effectgate bar` is a lightweight terminal status bar. It prints a red-light style alert when a registered protected effect was attempted:

```text
EffectGate: 1 pending - billing.charge
```

Use `effectgate pending`, `effectgate approve <effect-id>`, or `effectgate deny <pending-id>` to resolve alerts.
Use `effectgate bar --once --recent 1h` when you also want the bar to show recently approved protected effects that actually executed.
Use `effectgate test-alert <effect-id>` after setup to create a safe local alert and confirm your CLI bar, daemon, or desktop menu bar is watching the same project state.
Use `effectgate verify-install <effect-id>` for the one-command version: it creates the safe alert, checks the CLI bar, and checks the local daemon path used by the desktop menu bar.
Use `--surface cli` or `--surface desktop` when you also want to prove the project-local helper script or LaunchAgents are installed. Desktop surface verification also runs the installed menu-bar binary in self-test mode and confirms it can read the pending effect from the daemon.

For tmux, sketchybar, waybar, custom prompts, or scripts:

```bash
effectgate bar --once --json
effectgate bar --once --recent 1h --json
effectgate install cli-bar
effectgate verify-install billing.charge --surface cli
./.effectgate/effectgate-bar.sh --json
```

The installed helper uses `--recent 24h` by default so a status bar can show both pending approvals and protected effects that already ran. Override the window with `EFFECTGATE_RECENT_WINDOW=1h ./.effectgate/effectgate-bar.sh --json` or pass a later `--recent` flag.

For a macOS menu-bar companion:

```bash
effectgate setup \
  --protect billing.charge \
  --keyword chargeCustomer \
  --risk money_movement \
  --desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

That registers the protected effect, builds `~/.effectgate/EffectGateMenuBar`, writes two project-scoped LaunchAgents, starts the local daemon for the current repo, and shows pending protected effects in the menu bar.
Each project gets a stable local daemon port by default; use `effectgate install desktop --port 9555` if you want to choose it. The installer passes the matching `EFFECTGATE_DAEMON_URL` to the menu bar so it watches the same project daemon.
Pending items in the menu bar include `Approve 10m` and `Deny` actions backed by the local daemon. When no approval is pending, the menu also shows recently executed protected effects from the local audit log.
If the daemon is offline, the menu bar shows an offline status and URL only; it does not display fake protected-effect approvals.

## Configure Tripwires

Most projects can start without editing YAML:

```bash
effectgate protect prod-db-delete \
  --keyword deleteTenant \
  --sql 'DELETE\s+FROM\s+users' \
  --env 'DATABASE_URL=*prod*' \
  --risk irreversible_data_delete \
  --max-ttl 30m \
  --max-calls 1
```

`effectgate protect` creates or updates `.effectgate.yaml` and keeps repeated registrations deduplicated. Use YAML directly when you want reviewable, hand-tuned rules:

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

Approvals are local, narrow, expiring tokens stored under `.effectgate/`. Pending alerts live in `.effectgate/pending.json`. Audit receipts are JSONL in `.effectgate/audit.jsonl`.

## Runtime Guards

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

That writes `.claude/settings.local.json` with a Bash `PreToolUse` hook that wraps commands as `effectgate run -- <original command>`.

The generated hook shape is:

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

Codex plugin assets live in `plugins/codex/effectgate`. Inspect the path and install instructions with:

```bash
effectgate install codex --dry-run
```

The shared hook wraps Bash commands as:

```bash
effectgate run -- <original command>
```

## Desktop Bar Path

The CLI includes a local daemon and a minimal macOS menu-bar companion:

```bash
effectgate daemon --port 8765
curl http://127.0.0.1:8765/pending
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate install desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

The daemon exposes local-only endpoints for approvals and audit receipts. No cloud service is required.

The macOS installer builds the source in `desktop/macos/`, writes LaunchAgents under `~/Library/LaunchAgents`, and scopes the daemon to the current repository. By default it derives a stable project-local port in the `8765-9764` range and writes the same URL into the menu bar LaunchAgent.
`effectgate verify-install <effect-id> --surface desktop` checks those LaunchAgents and runs the installed menu-bar binary with `EFFECTGATE_SELF_TEST=1` against a local daemon.

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

## What Makes This Different

Native agent auto modes know generic danger: force pushes, broad deletes, secret exfiltration, and production deploys. EffectGate protects project-specific effects that only your codebase understands:

- `chargeCustomer()`
- `deleteTenant()`
- `runBillingMigration()`
- `DROP TABLE` or unsafe `DELETE`
- Java methods or packages with production side effects

The goal is not to ask on every agent action. The normal path is silent. EffectGate interrupts only when a registered tripwire is hit, then leaves a local pending alert and audit receipt. After a protected effect is approved and runs, `bar --recent` and the desktop menu can still show that it happened without turning it into another approval prompt.

## Shareable Demo

```bash
effectgate demo --dir /tmp
```

This creates `/tmp/effectgate-demo`, registers `billing.charge`, simulates a protected function attempt, and leaves a pending alert:

```text
EffectGate: 1 pending - billing.charge
```

That is the README hero: AI agents can work freely until they cross a project-defined production-effect line.
