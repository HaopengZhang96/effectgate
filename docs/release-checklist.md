# EffectGate Release Checklist

Use this before tagging an npm or GitHub release.

```bash
rm -rf python/effectgate/__pycache__
npm test
python3 -m py_compile python/effectgate/__init__.py
python3 /Users/espen/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex/effectgate
swiftc desktop/macos/EffectGateMenuBar.swift -o /tmp/EffectGateMenuBar -framework Cocoa -framework Foundation
npm pack --dry-run
```

Optional when a JDK is available:

```bash
javac -d /tmp/effectgate-java-check java/src/main/java/dev/effectgate/*.java
```

Smoke the shareable demo:

```bash
demo_parent=$(mktemp -d)
effectgate demo --dir "$demo_parent"
cd "$demo_parent/effectgate-demo"
effectgate bar --once
effectgate bar --once --json
```

`effectgate bar --once` returns exit code `2` when pending protected effects exist. That is expected and useful for shell/status-bar integrations.

Smoke first-run onboarding:

```bash
scratch=$(mktemp -d)
cd "$scratch"
effectgate setup --protect billing.charge --keyword chargeCustomer --risk money_movement --cli-bar
effectgate list
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate verify-install billing.charge --surface cli
./.effectgate/effectgate-bar.sh --json
effectgate bar --once --recent 1h
effectgate check billing.charge --args-json '["cus_123"]'
effectgate pending --json
desktop_home=$(mktemp -d)
desktop_scratch=$(mktemp -d)
cd "$desktop_scratch"
effectgate setup --protect billing.charge --keyword chargeCustomer --risk money_movement --desktop --home "$desktop_home" --port 9555
effectgate verify-install billing.charge --surface desktop --home "$desktop_home"
```
