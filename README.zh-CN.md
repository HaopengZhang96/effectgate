# EffectGate

[English](README.md) | [中文](README.zh-CN.md)

面向 AI coding agent 的项目级副作用保险丝。

EffectGate 让 Claude Code、Codex 和本地脚本照常运行，只有当它们要触发你在项目里显式注册的线上副作用时，才把它拦下来，留下一条本地的待审批提醒和审计记录。

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

## 快速开始

开发本仓库时：

```bash
npm install
npm link

effectgate demo --dir /tmp
cd /tmp/effectgate-demo
effectgate bar --once
```

在真实项目里保护一个函数：

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

包发布之后，全局安装：

```bash
npm install -g effectgate
```

`effectgate bar` 是一个终端状态栏。当注册过的 protected effect 被尝试执行时，会显示：

```text
EffectGate: 1 pending - billing.charge
```

审批后真实执行过的 protected effect 也可以显示出来：

```bash
effectgate bar --once --recent 1h
```

安装的 CLI helper 默认带 `--recent 24h`，适合接入 tmux、sketchybar、waybar、shell prompt 或任意自定义状态栏：

```bash
effectgate install cli-bar
./.effectgate/effectgate-bar.sh --json
```

## macOS 菜单栏

一条命令注册 protected effect 并安装桌面菜单栏：

```bash
effectgate setup \
  --protect billing.charge \
  --keyword chargeCustomer \
  --risk money_movement \
  --desktop
effectgate verify-install billing.charge --surface desktop
~/.effectgate/start-effectgate-desktop.sh
```

这会构建 `~/.effectgate/EffectGateMenuBar`，写入当前项目专属的 LaunchAgents，并把菜单栏指向同一个本地 daemon。菜单栏会显示：

- 待审批的 protected effect
- `Approve 10m` 和 `Deny`
- 最近已经执行过的 protected effect
- daemon 离线状态和本地 URL

EffectGate 默认没有云依赖；approval token、pending alert 和 audit log 都保存在项目本地 `.effectgate/` 下。

## 配置 Tripwire

多数项目可以直接用 CLI 注册，不必手写 YAML：

```bash
effectgate protect prod-db-delete \
  --keyword deleteTenant \
  --sql 'DELETE\s+FROM\s+users' \
  --env 'DATABASE_URL=*prod*' \
  --risk irreversible_data_delete \
  --max-ttl 30m \
  --max-calls 1
```

也可以在 `.effectgate.yaml` 里精细配置：

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

## 常用命令

```bash
effectgate run -- npm run backfill-prod
effectgate setup --protect billing.charge --keyword chargeCustomer --cli-bar
effectgate protect billing.charge --keyword chargeCustomer --risk money_movement
effectgate list
effectgate test-alert billing.charge
effectgate verify-install billing.charge
effectgate verify-install billing.charge --surface cli
effectgate verify-install billing.charge --surface desktop
effectgate approve billing.charge --ttl 10m --max-calls 1 --scope session
effectgate pending
effectgate deny <pending-id>
effectgate bar --once
effectgate bar --once --json
effectgate bar --once --recent 1h
effectgate status
effectgate audit
effectgate scan-sql 'DROP TABLE users;'
effectgate scan-java src/main/java/AdminOps.java
effectgate doctor
```

## Runtime Guard

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

## Claude Code 和 Codex

Claude Code:

```bash
effectgate install claude
```

这会写入项目本地 `.claude/settings.local.json`，通过 `PreToolUse` hook 把 Bash 命令包装成：

```bash
effectgate run -- <original command>
```

Codex 插件资产位于 `plugins/codex/effectgate`：

```bash
effectgate install codex --dry-run
```

Claude Code 和 Codex 共用同一个 core、approval token store、pending store 和 audit log。

## 为什么不是 agent 自带 auto mode

官方 auto mode 通常能识别通用风险：删文件、强推、泄露 secret、部署等。EffectGate 保护的是项目语义里的危险 effect，例如：

- `chargeCustomer()`
- `deleteTenant()`
- `runBillingMigration()`
- `DROP TABLE` 或没有 `WHERE` 的 `DELETE`
- Java 里带线上副作用的方法/包名

它不是要在每一步都来问你。普通动作静默通过，只有命中项目注册的 tripwire 才会打断。审批放行、protected effect 真的执行之后，CLI bar 和桌面菜单栏还会留下一条本地可见的痕迹，但不会再弹一次审批。

## 怎么衡量它有没有用

不用「减少焦虑」这种说法，看几个能测的指标：

- `unsafe pass-through`：注册过的 protected effect 是否能绕过审批执行。
- `silent pass rate`：普通 agent 动作静默通过比例。
- `recent execution visibility`：已审批执行的 protected effect 多快出现在 CLI/桌面 bar。
- `approval scope safety`：TTL、max-calls、cwd、command hash、args hash 是否限制正确。
- `surface verification`：`verify-install --surface cli|desktop` 是否能证明安装后的 bar 确实看同一个项目状态。
