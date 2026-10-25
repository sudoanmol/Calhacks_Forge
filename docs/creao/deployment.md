# CREAO deployment record

Verified October 24, 2026 through Brave and the Maincloud HTTP API. All money below is **TEST MODE**.

| Seat | Agent ID | Version |
|---|---|---|
| [COO](https://agent.creao.ai/apps/81c6c2cc-98d6-4ea5-8fcf-942f8772bf20) | `81c6c2cc-98d6-4ea5-8fcf-942f8772bf20` | 1.1.0 |
| [Research](https://agent.creao.ai/apps/bad9531d-a359-4af3-9913-fc9310fe4218) | `bad9531d-a359-4af3-9913-fc9310fe4218` | 1.0.0 |
| [CFO](https://agent.creao.ai/apps/63d131de-1b0c-4801-a58f-1698c894a672) | `63d131de-1b0c-4801-a58f-1698c894a672` | 1.0.0 |
| [Auditor](https://agent.creao.ai/apps/6865c094-e20c-48c7-a969-d5e75c67dd06) | `6865c094-e20c-48c7-a969-d5e75c67dd06` | 1.1.0 |

Each agent has one required `task` input, Auto autonomy, and the current `forge.mjs` reference file, displayed as 28.2 KB. Research, CFO, and Auditor saved instructions match their repository instruction blocks exactly. The COO's saved document contains its exact instruction block plus sections for its goal, input, output, and bundled file.

The Research and CFO seat tokens are stored in CREAO's account-wide secret manager under their seat-specific names. Their app IDs are saved in the ignored `.env` and enabled on Maincloud `forge` through an environment-only publish. No module code or data was replaced.

## CFO integration check

[Public CFO run](https://agent.creao.ai/share/2361cbf6417714be089c498e9e96c580), approved for sharing by the founder. The link expires November 23, 2026.

- Task `4156`, compile ticket `6`, API `open-roles`.
- CREAO run `57cb47f7-b02e-4d58-8fe1-29943d0937dc`, conversation `ee4d58d0-a81e-47a1-b3f4-765bf284dfa7`.
- The scheduled dispatcher started the real CFO run after its app ID was enabled.
- The CFO called `cfo_propose(COMPILE, 500, rationale)`. The task is `done`, the run is `completed`, and the compile job is `queued` with 500 cents reserved, all **TEST MODE**.
- No Droid session or Apify deployment was started during this setup.

The CFO memo compares costs against two leftover `cmp-test` catalog fixtures. Those are simulated compile-test outputs, not deployed production Actors. Their costs do not demonstrate Tier 1 savings for `open-roles`.

## Remaining validation

- Research has passed its setup checks but has not completed a real dispatched `research_gate` run.
- The approved follow-up that runs mechanical admission checks before starting Research is not implemented in this deployment.
- The real Droid compile, compile audit, founder ship approval, and deployed Tier 1 cost measurement remain pending.
- The stuck YC compile ticket and two `cmp-test` catalog fixtures remain to be cleaned up.
- Agentverse listing text and the ASI:One purchase, challenge, and two-device checks remain pending.
