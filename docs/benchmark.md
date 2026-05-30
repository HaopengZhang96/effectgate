# Benchmark Claims

EffectGate should avoid fuzzy claims like "reduces anxiety." Use measurable product claims:

- `unsafe pass-through`: registered protected effects that executed without approval.
- `silent pass rate`: normal commands that did not interrupt the user.
- `pending alert latency`: time from protected effect attempt to `.effectgate/pending.json` and bar visibility.
- `recent execution visibility`: time from approved protected effect execution to `bar --recent`, daemon `/summary`, and desktop menu visibility.
- `approval scope safety`: expired, max-call, command-hash, args-hash, and cwd mismatches blocked.
- `adapter coverage`: Claude Code and Codex Bash hooks wrap commands with `effectgate run --`.
- `bar visibility`: pending alerts visible through `effectgate bar --once`, `bar --json`, daemon `/pending`, daemon `/summary`, and macOS menu bar.
- `install verification`: `effectgate test-alert <effect-id>` and `effectgate verify-install <effect-id>` safely prove the configured bar/daemon path without touching production code.
- `surface verification`: `effectgate verify-install <effect-id> --surface cli|desktop` proves installed helper scripts or LaunchAgents are bound to the current project.
- `desktop binary read path`: desktop surface verification runs the installed menu-bar binary in self-test mode and confirms it reads the pending effect from the daemon.
- `desktop isolation`: desktop install wires each project daemon and menu bar to the same project-local URL, with optional explicit `--port`.

Current local gates:

```bash
npm test
effectgate demo --dir /tmp
effectgate bar --once
effectgate protect billing.charge --keyword chargeCustomer --risk money_movement
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate verify-install billing.charge --surface cli
effectgate check billing.charge --args-json '["cus_123"]'
effectgate bar --once --recent 1h
```

Suggested public README claim once benchmarked against fixtures:

```text
EffectGate silently passes ordinary agent actions, interrupts only when a project-defined protected effect is attempted, and leaves a visible local trace when an approved protected effect runs.
```

Do not claim production incident prevention until tested against real project fixtures or published benchmark corpora.
