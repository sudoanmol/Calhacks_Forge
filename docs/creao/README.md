# Setting up FORGE's CREAO agents

FORGE has four CREAO seats: COO, Auditor (Gate 1), Research (Gate 2) and CFO (Gate 4). Each one is a saved agent on agent.creao.ai that receives one input, `task`, from the module's `dispatch` procedure and acts only through `skills/forge-cli/forge.mjs`.

Use agent.creao.ai only. developer.creao.ai is a separate platform; its agents are not reachable with our account key.

## 1. Secrets (once per account)

CREAO secrets are account-wide: every agent on the account sees all of them. That is why each seat token has its own name. Open **Secrets** → **Add secret** and add:

| Name | Value |
|---|---|
| `FORGE_DB_URL` | `https://maincloud.spacetimedb.com/v1/database/forge` (`$SPACETIME_HOST/v1/database/$SPACETIME_DB`) |
| `FORGE_SEAT_TOKEN_COO` | `SPACETIME_TOKEN_COO` from `.env` |
| `FORGE_SEAT_TOKEN_AUDITOR` | `SPACETIME_TOKEN_AUDITOR` from `.env` |
| `FORGE_SEAT_TOKEN_RESEARCH` | `SPACETIME_TOKEN_RESEARCH` from `.env` (Gate 2) |
| `FORGE_SEAT_TOKEN_CFO` | `SPACETIME_TOKEN_CFO` from `.env` (Gate 4) |

Do not add a secret named `FORGE_SEAT_TOKEN`: it overrides the per-seat choice for every agent.

## 2. Create each agent (COO and Auditor first)

For each seat, follow its file: [coo.md](coo.md), [auditor.md](auditor.md), then later [research.md](research.md), [cfo.md](cfo.md).

1. Start a new chat on agent.creao.ai.
2. Attach `skills/forge-cli/forge.mjs` to the message (or paste its contents and ask the agent to save it as `forge.mjs` in the workspace).
3. Paste the "Creation prompt" from the seat's file and send it. The agent saves `forge.mjs`, runs the read-only checks and shows the output. Do not let it run `decide` or `verdict` on a real order during setup.
4. Click **Create Agent**. Check the agent has exactly one input field, `task` (text), and that the instructions match the "Agent instructions" section of the seat's file; edit them if not.
5. On the agent page: set autonomy to **Full auto**, and on the **Files** tab upload `forge.mjs` (so every run has it even if the saved environment is lost).
6. Copy the agent's `appId` into `.env` as `CREAO_APP_ID_<ROLE>`. The module reads `CREAO_APP_ID_COO`, `CREAO_APP_ID_AUDITOR`, ... at publish time, so republish the module with them in the environment. Until a role's appId is set, its tasks stay `queued`.

Alternative to steps 2 and 5: zip `skills/forge-cli/` (it contains `SKILL.md`) and upload it on the **Skills** page, or, once the repo is public, install it with the GitHub URL `https://github.com/<owner>/<repo>/tree/main/skills/forge-cli`.

## 3. Check one run end to end

Place a test order through the Front Desk (or the canary). Watch the dashboard: the `coo_triage` task goes `queued` → `dispatched` → `done`, a `run` row appears with `provider = creao`, and the order leaves `paid`. A run that ends without a reducer call marks the task `failed` (event `task_ended_without_decision`); open its run in CREAO to see why.

After editing `forge.mjs`, re-upload it to every agent's Files tab.
