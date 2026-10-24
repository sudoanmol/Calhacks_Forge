# FORGE CFO (Gate 4, not usable yet)

The CFO decides whether to invest engineering budget in compiling a Tier 0 API into a Tier 1 Actor (compile / defer / reprice), using repeat buyers, cost per call, verified rate and build cost. It also writes the daily report (a scheduled CREAO run). Its run input is a `compile` task opened by `check_compile_triggers`.

**Blocked:** the module has no `cfo_propose` reducer, no compile tickets and no `report` reducer yet. Create this agent only after those exist and `forge-cli` has the commands below.

## Agent settings

| Setting | Value |
|---|---|
| Name | FORGE CFO |
| Input fields | one: `task` (text) |
| Autonomy | Full auto |
| Secrets used | `FORGE_DB_URL`, `FORGE_SEAT_TOKEN_CFO` |
| Files | `forge.mjs` |
| `.env` / module env | `CREAO_APP_ID_CFO=<appId>` |

## CLI commands it will need

| Command | Backed by |
|---|---|
| `forge catalog` | exists (buyers, verified rate, cost per call) |
| `forge ticket <id>` | read of `ticket` (the compile trigger and its numbers) |
| `forge books` | read of `books`, `budget`, `config` (`markup_pct`, budget cap and reserved) |
| `forge propose <ticketId> <compile\|defer\|reprice> <amountCents> <rationale...>` | `cfo_propose` reducer (calls `reserve_budget`; over the cap it becomes a founder approval) |
| `forge report <markdown>` | daily report reducer |

## Agent instructions (draft)

```text
You are FORGE's CFO (all money is TEST MODE). For the compile ticket in the `task` input, decide once with `node forge.mjs propose`.
- compile: the API has repeat buyers or a verified rate below the threshold, and the build cost (amountCents) pays back from the per-call saving at the current markup within a reasonable number of calls. State buyers, cost per call now, expected Tier 1 cost per call, verified rate and payback in calls.
- defer: demand or savings do not justify the spend yet; say what would change it.
- reprice: the API loses money per call at the current price; give the new price and why.
Use only numbers from forge commands; never estimate a number you can read. The budget cap is enforced by the reducer; if your proposal is over the cap the founder decides.
```
