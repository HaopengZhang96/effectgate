# EffectGate macOS Menu Bar

This is a minimal local menu-bar companion for the EffectGate daemon.

The easiest install path from a project is:

```bash
effectgate install desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

This builds the menu-bar binary, writes project-scoped LaunchAgents for the daemon and bar app, and leaves logs in `~/.effectgate/`.
The installer chooses a stable daemon port for the project and passes the matching `EFFECTGATE_DAEMON_URL` to the menu bar LaunchAgent. To choose the port yourself:

```bash
effectgate install desktop --port 9555
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

For manual development builds:

```bash
swiftc EffectGateMenuBar.swift -o EffectGateMenuBar -framework Cocoa -framework Foundation
./EffectGateMenuBar
```

The menu bar reads pending and recent protected-effect alerts from `EFFECTGATE_DAEMON_URL`, falling back to `http://127.0.0.1:8765` for manual development builds. Each pending item has `Approve 10m` and `Deny` actions that call the local daemon's `/approve` and `/deny` endpoints. When no approval is pending, recently executed protected effects appear as read-only status items.
If the daemon cannot be reached, the menu shows an offline status and the daemon URL. It does not create a fake pending effect or show approval actions.

For non-GUI verification, the binary supports:

```bash
EFFECTGATE_SELF_TEST=1 EFFECTGATE_DAEMON_URL=http://127.0.0.1:9555 ~/.effectgate/EffectGateMenuBar
```

`effectgate verify-install <effect-id> --surface desktop` runs this self-test automatically after checking the project LaunchAgents.

For the CLI path, use:

```bash
effectgate bar
effectgate bar --once --json
effectgate bar --once --recent 1h
```

That terminal bar watches `.effectgate/pending.json` and can also summarize recent protected-effect executions from `.effectgate/audit.jsonl`.
