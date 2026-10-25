# FORGE: final-stretch audit and implementation prompt

Cal Hacks 13.0 · written Sun Oct 25 2026, 00:35 PDT, against HEAD `214932c` · Devpost hard deadline 09:00 PDT (target 08:15) · judging 10:30–12:30 · 2-minute pitch with live demo

Sponsor priority (founder's): CREAO One-Person Company (top), SpacetimeDB, Fetch.ai, Bright Data, Apify (Best Use, not Best Actor), Factory Droid. Coinbase is out of scope.

---

## 0. Read this first (instructions for the coding agent)

You are finishing FORGE in the last build window. This file says what to change, in what order, and how to prove each change works.

1. `AGENTS.md` is the build contract and wins on build rules: pnpm and uv, tests per §2 rules 15–16 (backend checked against the deployed services, frontend checked in a real browser with the `agent-browser` skill), labels, additive-only schema changes. Code is the source of truth for what exists. Several docs are stale; §15 lists them.
2. Never present replayed, recorded, seeded or simulated work as live. Labels: `LIVE`, `RECORDED`, `REPLAY`, `SIMULATED PAYMENT`, `TEST MODE`.
3. Only measured numbers. No latency, savings or win-rate claim without a source row or file.
4. **[FOUNDER]** items need the founder's accounts, UI or approval: publishing the module, pushing, changing repo visibility, deploying, creating CREAO share links, ASI:One registration, videos. Prepare the commands and verify afterwards; do not perform them yourself.
5. **[CODE]** items are yours. Commit only when the founder asks.
6. Publish the module only when no CREAO run is in flight (query in §13.1). Never pass `--delete-data`. Batch module changes into as few publishes as possible.
7. Line numbers below are from HEAD `214932c`. Re-read a file before editing it.
8. Code freeze at **04:30 PDT**. After that: docs, videos and rehearsal only.

---

## 1. Executive verdict

FORGE already does the hard part. Four real `open-roles` orders went from payment to Auditor acceptance in **54–64 seconds** (§2), passing through Fetch (Front Desk), CREAO (COO, then Auditor), Apify (the Tier 1 Actor that Droid compiled), Bright Data (an independent re-fetch of every value) and SpacetimeDB (every rule and every row). In the previous winners checked in §5, few show that much working depth in any of these tracks.

What can still lose prizes is mostly packaging plus a few sharp edges:

1. **The GitHub repo is private**, and local `main` is 4 commits ahead of `origin/main`. Fetch requires a public repo. CREAO says "we check the links in your README". Right now every proof link in the README returns 404 for a judge.
2. **Maincloud runs older code than the repo.** `refund_order` is not deployed, so the dashboard's Refund button fails and order #199 still holds the customer's $1.00 TEST MODE after an Auditor rejection.
3. **CREAO proof links are missing.** 0 of 39 `run` rows have a share URL. The README has one public run link (the CFO). Dashboard links for CREAO decisions open a thread that needs an account login.
4. **Fetch mandatory deliverables are open**: badges, the Agentverse README, registration through the ASI:One Submission Agent, the 3–5 minute video and the public repo. Replies are plain text, while ASI:One Interactive Cards are recommended and earn bonus points.
5. **A few README and Devpost claims are false**: "rework continues the same thread", "replay bar not built", the Apify Best Actor entry, and Browser API wording that implies it ran.
6. **Demo-safety edges**: "ok" or "yes" pays the stored quote, and the header says `LIVE` during a replay and while disconnected.

Competitive position, strongest first (details in §3):

1. **CREAO One-Person Company.** Best fit of any sponsor: one saved agent per role, an orchestrator that starts them through the API Trigger, decisions enforced by reducers, money gates. Ready on substance. Not ready on proof (links, public repo, a pitch that names what CREAO does).
2. **SpacetimeDB.** Deep, genuine use (the database is the backend and calls the outside world). The weakness is presentation, not engineering.
3. **Apify Best Use.** Five prize slots, and FORGE uses Apify as a versioned product shelf (Actor, Tasks, compiled Actor, datasets, saved pages), which past winners mostly did not. Needs presentation only.
4. **Fetch.ai.** A real ASI:One journey with Stripe test and testnet FET payments, plus an independent buyer agent. It cannot be judged until the mandatory items are done; cards close the UX gap.
5. **Bright Data.** Essential and honest, but a crowded track (19–24 entrants per slot at recent events) and the Browser API rung never ran.
6. **Factory Droid.** Real but thin: one compile, a harness bug that the founder fixed, no denied action in a real compile. Honest framing keeps it credible.

This ranking differs from the founder's priority on Apify versus Fetch. Time should still go to Fetch first, because the Fetch gap needs code (cards), while the Apify gap is a 20-minute README task.

**Best use of the remaining time:** P0 founder operations in parallel (≈1.5 h), Interactive Cards in the Front Desk (≈2–2.5 h), the honest header badge (≈20 min), a public read-only dashboard URL (≈30–45 min, founder deploy), and public CREAO run links (README now, dashboard reducer if time allows).

---

## 2. Live evidence snapshot (read-only, Oct 25 00:10–00:35 PDT)

| Fact | Value | How it was checked |
|---|---|---|
| Deployed module | `refund_order` missing on Maincloud ("no such reducer"); `coo_decide` and `audit_verdict` present | `spacetime describe -s maincloud forge reducer refund_order` |
| Code | `refund_order` at `module/src/index.ts:1178-1190` (commit `f8252d7`); that commit adds no tables | git |
| Order #199 | `audit_rejected`, paid $1.00 TEST MODE (Stripe test), `books` `customer:199` = −100, no refund row | SQL |
| Repo | `sudoanmol/Calhacks_Forge` is **PRIVATE**; local `main` is 4 ahead of `origin/main` (`9da0a92`) | `gh repo view`, `git rev-list --left-right --count` |
| Secrets | A pattern scan for common key prefixes (`capi_`, `sk_test_`, `sk-ant-`, `apify_api_`, `ghp_`, `AKIA`, private keys, long bearer tokens) found nothing at HEAD or in history. `.env` is not tracked. Not a substitute for a real scanner | `git grep -l` (paths only) |
| CREAO runs | 39 rows: 29 `completed`, 10 `start_failed`. 9 of the 10 are module tests with fake `test-app-*` app IDs (HTTP 400 `APP_FETCH_FAILED`). The other is run 72, an orphaned dispatch that `dispatch` recovered on its own (event 1735, `orphan_dispatch_recovered`) and retried as run 73, which completed | SQL on `run`, `event` |
| CREAO reliability | 0 `task_ended_without_decision` and 0 `creao_refresh_failed` events, ever | SQL on `event` |
| CREAO duration | completed runs: p50 26.5 s, p90 34.8 s, max 74.9 s (Research on #199) | SQL on `run` |
| Share links | 0 of 39 `run.share_url` set; README has one (CFO, `README.md:80`) | SQL |
| Catalog for sale | `open-roles` Tier 1 v1.0 (API version 20, 3 buyers); `yc-directory` Tier 0 (1 buyer); `gpu-listings` Tier 0 (0 buyers) | SQL on `api`, `api_version` |
| Compile jobs | ticket 6 `open-roles` shipped (500¢); tickets 2–5 are `cmp-test` simulated compile tests; ticket 1 `yc-directory` closed | SQL on `compile_job` |
| Budget and config | engineering cap 2000¢, reserved 0, spent 540; `creao_max_concurrency` 2; `refund_limit_cents` 500; `compile_min_buyers` 2; `page_cap` 25 | SQL |
| Header, real-order scope | revenue $5.00 TEST MODE, verified 100% (85/85) | `README.md:205` |

**Order timings** (from `event` rows; durations between consecutive events):

| Order | Path | Payment | paid → COO decision | COO → Apify ingest | ingest → verified | verified → Auditor | **paid → Auditor accepted** |
|---|---|---|---|---|---|---|---|
| #131 | `open-roles` Tier 0 | buyer agent, testnet FET | 20.3 s | 22.2 s | 3.0 s | 18.0 s | **63.5 s** |
| #196 | `open-roles` Tier 1 | buyer agent, testnet FET | 20.4 s | 23.2 s | 1.1 s | 18.7 s | **63.3 s** |
| #202 | `open-roles` Tier 1 | Stripe test checkout | 27.3 s | 10.6 s | 2.8 s | 22.8 s | **63.5 s** |
| #205 | `open-roles` Tier 1 | SIMULATED PAYMENT | 19.3 s | 10.7 s | 3.6 s | 20.6 s | **54.3 s** |
| #199 | new API through Research | Stripe test checkout | 3 min 55 s (includes the 3.5 min orphaned dispatch) | Research and gate ≈ 4 min | 1.7 s | 16.0 s | 8 min 45 s, Auditor **REJECT** |

Time before payment is human or agent time: #131 18.8 s and #196 16.7 s (buyer agent), #205 46.8 s (SIMULATED), #202 3 min 48 s (a person completing Stripe checkout). Rehearse the Stripe path, or use the labeled SIMULATED PAYMENT switch on stage.

---

## 3. Sponsor scorecard

Scores are 0–10 judgments from the evidence in this file. They are not win probabilities.

| Sponsor | Fit | Depth | Demonstrated | Demo clarity | Overall now | After P0 + P1 | Confidence |
|---|---|---|---|---|---|---|---|
| CREAO One-Person Company | 9 | 8 | 7 | 6 | 7.5 | 8.5 | Medium-high |
| SpacetimeDB | 9 | 8 | 7 | 5 | 7 | 8 | Medium |
| Apify Best Use | 8 | 8 | 7 | 5 | 7 | 7.5 | Medium |
| Fetch.ai | 8 | 6 | 7 | 5 | 6 (blocked until mandatory items are done) | 7.5 | Medium |
| Bright Data | 8 | 7 | 7 | 6 | 7 | 7.5 | Medium-low (crowded) |
| Factory Droid | 7 | 7 | 5 | 6 | 5.5 | 6 | Low-medium |

**Evidence per sponsor**

- **CREAO.** Four saved agents with IDs in the README (`README.md:71-76`). Only the `dispatch` procedure starts runs, through `POST /api/v1/runs` with an idempotency key and a one-time webhook token (`module/src/index.ts:2338-2411`). Each decision is a seat-gated reducer: `coo_decide` (`:963`), `audit_verdict` (`:995`), `research_report` (`:2202`), `cfo_propose` (`:2646`). 29 real runs completed. Gaps: one share link; canary orders skip CREAO by design (`:2361`); the pitch does not yet say what CREAO decides.
- **SpacetimeDB.** 40 tables, 34 reducers (`README.md:117` plus `refund_order`), 13 procedures (`README.md:118`), 3 routes, 8 schedules. Role checks in every reducer, atomic leased claims (`:715-727`), a sum-zero ledger (`postTx`, `:762`), outbound HTTP only from procedures, webhooks that never trust the body (`:1400-1412`, `:1360-1392`), and orphan recovery observed live (run 72). The budget-cap moment already worked live (`README.md:113`). Gaps: the deployed module lags the code; the header `LIVE` badge is static (`web/src/Header.tsx:56`); judges see a dashboard, not "the database is the backend".
- **Apify.** `forge-extract` Tier 0 Actor, one Task per Tier 0 API, a compiled Tier 1 Actor `RdQhIe6Jj6mE2qT4L` v1.0 (`README.md:156-163`), saved pages in the key-value store used by challenge rechecks, run cost re-fetched from `usageTotalUsd`. A second buyer reused the Tier 1 Actor with no new build (#196). Gaps: no public links to the Actor, Tasks or Store listing (`README.md:165`); docs still mention Best Actor (`README.md:166`, `docs/devpost.md:82`).
- **Fetch.ai.** Chat and Payment protocols (`fetch-agents/front_desk/agent.py:52-53`, `:393-394`), Stripe test plus FET (`:262-384`), an independent buyer agent that found FORGE through Agentverse search and paid twice (`README.md:137-143`). Gaps: text-only replies (`agent.py:60-64`), loose pay words (`:39`), delayed messages do not show in ASI:One so customers must send `status` (`README.md:255`), mandatory items open (`README.md:145-146`).
- **Bright Data.** Web Unlocker for extraction, gate checks, verification and rechecks; SERP for research (`README.md:172-176`). The `evidence` table holds 130 attempts (118 Unlocker, 12 SERP, 0 Browser API) with a recorded `us` → `gb` retry (`README.md:184`). Compliance blocks are handled honestly (`README.md:185`). The challenge recheck took 1000 ms (`README.md:49`). Gaps: the Browser API rung never ran; cost per call uses request count × list price.
- **Factory.** A reducer-triggered compile ticket, a locked session (`workers/droid-runner/src/lockdown.ts`), a command policy (`policy.ts`) and a control table (`README.md:97-103`), plus the RECORDED Engineering timeline. Gaps: one real compile; attempt 1 failed on a harness bug that the founder fixed in `c6ac400` (committed 2 seconds before attempt 2 started); attempt 2 resubmitted the same extractor; no denied action in a real compile (`README.md:105`); the runner claims only `ship` and `compile` (`workers/droid-runner/src/runner.ts:28`) and is started by hand.

---

## 4. Official criteria (with citations)

| Sponsor | What it requires and how it judges | Source |
|---|---|---|
| CREAO | At least one CREAO agent does core work; the README includes a run share link and the agent ID; show the agent running in the demo. One-Person Company ($1,500): "show an org chart of agents that hand work to each other… one saved agent per role, coordinated by scheduled /workflow or orchestrator via API Trigger." Judging: AI as foundation 30%, Depth on CREAO 25% ("we check the links in your README"), Originality 20%, Track fit 15%, Demo 10% ("live demo works, pitch names what CREAO is doing"). Tip: "Remove the agent, and this product dies." One CREAO track per project | https://community.creao.ai/CalHacks2026 and https://community.creao.ai/CalHacks2026/tech. These two pages are the whole brief: the Google Doc that the prizes page links for all three CREAO tracks does not exist (checked by the founder, Oct 25) |
| SpacetimeDB | $2,048 / $1,024 / $512. SpacetimeDB must be the core realtime backend, "meaningfully used, not added on the side". Named fits include AI agent coordination, live dashboards, marketplaces, shared ops dashboards and "AI systems coordinating in a persistent world state" | https://spacetimedb.com/blog/spacetime-at-calhacks |
| Fetch.ai | Mandatory: agents registered on Agentverse, Chat Protocol, discoverable and usable through ASI:One, meaningful tool use or multi-agent design, primary workflow entirely in ASI:One, public GitHub repo with run instructions. Recommended: ASI Interactive Cards. Bonus: multi-agent, Payment Protocol, cards, reliability and error recovery, real-time data, continued operation. Deliverables: README with agent name and address; badges `![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)` and `![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)` in the agent README; a 3–5 minute video; registration through the CalHacks ASI:One Submission Agent (asi1.ai festival `calhacks2026` dashboard). Judging: Functionality 25, Fetch technology 20, Innovation 20, Impact 20, UX 15. Prize amounts disagree: hackpack $1,250 / $750 / $500 plus 2 × $250; prizes page $1,500 / $1,000 / $500 | https://www.fetch.ai/events/hackathons/calhacks-13-0/hackpack, https://hive.hackberkeley.org/prizes |
| ASI:One Interactive Cards (docs v1.0.5) | A `ChatMessage` carries `TextContent` plus one `MetadataContent` whose metadata (all values strings) has `card_protocol_version: "1"`, `requires_card_interaction: "true"`, `card_kind` (`carousel`, `detail`, `form`, `review`, `custom`) and `card_payload` (JSON string, ≤ 64 KB); optional `is_terminal: "true"` and `preferred_drawer_width_px` (320–800). Invalid cards fall back to the text silently. A tapped option comes back as a JSON string (direct @mention chats) or as planner prose: parse JSON first, then prose | https://asi1.ai/developer/card-playground; reference agent in https://github.com/fetchai/innovation-lab-examples (`dynamic-ui-on-asi1`) |
| Bright Data | Live data must be essential; handle blocks and empty responses; clean output. Disqualified: login or paywall scraping, non-public personal data, mocked demo data, README-only use. Prizes: credits plus Amazon cards, 3 places | https://hive.hackberkeley.org/prizes, hacker guide |
| Apify Best Use | $2,000 / $1,000 / $800 / $400 / $400 (5 slots). Best Actor is a separate award the founder is not entering | https://hive.hackberkeley.org/prizes |
| Factory | $2,000, 1 winner. Droid must do real work inside the running product: a designed trigger, control and safety, visible plans, diffs and results. A chatbot wrapper scores poorly | https://hive.hackberkeley.org/prizes, hacker guide |
| Cal Hacks general | Application, Intentionality, Functionality, Creativity, Technical Complexity | https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE |

---

## 5. Previous winners (Devpost index)

D = documented in the write-up. I = inference.

| Project | Event (year) | Prize | Evidence | What it built | Depth | Standout feature | What FORGE can adapt | Effort |
|---|---|---|---|---|---|---|---|---|
| Headcount:1 | AI Hackathon 2026 by LA Hacks (Oct 2026) | CREAO One-Person Company (6 entrants per slot) | https://devpost.com/software/headcount-1 | A "town of AI agents": approve the plan, follow the handoffs, open the finished work. StepFun planner plus saved CREAO agents through API Trigger; event-sourced; review and revision loop; Phaser front end | Medium-high | D: visible handoffs in a game world, plan approval, public demo link and share link. I: judges rewarded watching the company work and links they could open | FORGE has the forge floor, org chart and approvals already. Add a public dashboard URL and a public share link on every decision | 1–1.5 h (P0-3, P1-3, P1-4) |
| Tapped In | Cal Hacks 12.0 (2025) | CREAO Best Real-World Productivity Tool, $1,750 (81 entrants, 1 slot) | https://devpost.com/software/tapped-in | Real-time map of community events. CREAO generated the front end and schema and an API workflow to Google Maps | Low on CREAO | D: CREAO as an app builder. I: last year's Cal Hacks CREAO bar was practicality, not agent depth | Open with what the buyer gets (verified data), then the agents | 0 |
| Research Compass | Cal Hacks 12.0 (2025) | CREAO Smartest AI agent (57 entrants, 1 slot) | https://devpost.com/software/research-compass | Finds research openings and drafts outreach; CREAO for UI generation | Low on CREAO | D: CREAO for UI | Say in the first 10 seconds that the agents make the decisions | 0 |
| scalpal. | MHacks 2026 | SpacetimeDB | https://devpost.com/software/scalpal | VR surgical training with a simulated patient; 25 tables and 52 reducers; scheduled physiology ticks | High | D: scheduled reducers drive a living simulation. I: SpacetimeDB judges reward "the world runs inside the database" | Point at FORGE's schedules acting in the feed (dispatch, lease sweep, orphan recovery) | 0.5 h (presentation) |
| Traycer | MHacks 2026 | SpacetimeDB | https://devpost.com/software/traycer-ai-food-waste-intelligence | Dining-hall food-waste intelligence; 2 modules and 25 tables; scheduled agent simulation every 200 ms | High | D: agents in a scheduled loop. I: multi-agent world state is a rewarded pattern | Pitch FORGE as "an AI company living in one persistent world state" | 0 |
| CoClip | MHacks 2026 | SpacetimeDB | https://devpost.com/software/coclip | Real-time collaborative video editing for people and AI assistants on shared state | Medium | D: humans and AI editing the same live state. I: multiplayer you can touch | Let the judge's own phone be the second device | 0.5 h (P1-3) |
| ResourcePilot | AI Hackathon 2026 by LA Hacks | Fetch.ai | https://devpost.com/software/resourcepilot-dzwx3o | One ASI:One chat; 8 uAgents on Agentverse find study rooms and halls, check them live and "never make anything up"; cards, live badges, payment | High | D: 8 agents, cards, live checks, an honesty promise | Cards with a verified badge per value; say "every value has a verbatim quote" on the card | 2 h (P1-1) |
| DoorStep | AI Hackathon 2026 by LA Hacks | Fetch.ai | https://devpost.com/software/doorstep-evacuation-help-for-people-who-can-t-leave-alone | A network of Fetch agents that check on residents who need evacuation help, match volunteers and track them to shelters, through ASI:One | Medium-high | D: impact story plus multi-agent ASI:One workflow. I: Impact (20%) carried it | State FORGE's impact plainly: people and agents get public data they can check | 0 |
| Voider | TreeHacks 2026 | Fetch.ai | https://devpost.com/software/voider | Voice-first shopping brain; cross-platform price comparison; agentic payments ($1 per order through the Payment Protocol) plus Bright Data | Medium-high | D: Payment Protocol per order plus live Bright Data | FORGE already has Stripe test and FET; show the payment card in the Fetch video | 0 |
| AgenticHire | DiamondHacks 2026 | Fetch.ai | https://devpost.com/software/agentichire-2xyk0z | One sentence in ASI:One starts 5 agents that recruit, rank and email candidates, gated by a live FET payment | Medium | D: multi-agent pipeline behind a FET gate | Show the buyer agent paying FET to the Front Desk | 0 |
| EDFlow AI | Cal Hacks 12.0 (2025) | Fetch.ai | https://devpost.com/software/edflowai | 7 specialist agents coordinate ER emergencies "in < 30 s" | Medium | D: parallel specialists plus a timing claim | Quote FORGE's measured 54–64 s from payment to acceptance | 0 |
| FairVal | Cal Hacks 12.0 (2025) | Best Use of Bright Data (57 entrants, 3 slots) | https://devpost.com/software/reclaim-ai | Post-purchase autopilot that tracks price drops and writes refund emails; Bright Data Scraping Browser through Puppeteer | Medium | D: browser-based anti-bot scraping | Do not claim the Browser API; lead with independent verification and the honest `unverifiable` path | 0 |
| Guardian | Cal Hacks 12.0 (2025) | Best Use of Bright Data | https://devpost.com/software/guardian-ai-powered-fraud-prevention-for-your-money | Scam and fraud prevention agent combining Bright Data, Anthropic, Fish Audio and Fetch.ai | Medium | D: Bright Data inside a multi-sponsor agent | Same multi-sponsor story, but FORGE can show each sponsor's job | 0 |
| ShotSpot | TreeHacks 2026 | Bright Data (23.7 entrants per slot) | https://devpost.com/software/shotspot-kfvp1n | Search video like text to build computer-vision training sets | Medium | I: data collection as the product | FORGE's product is also data; say it | 0 |
| HomeMatch | GenAI Zürich Hackathon 2026 | Apify | https://devpost.com/software/homematch-e35mgk | Conversational home profile that scores live Flatfox listings through a Chrome extension | Medium | D: live listings feed a product | FORGE goes further: Apify is the shelf of versioned APIs | 0 |
| CiteShift | GenAI Zürich Hackathon 2026 | Apify | https://devpost.com/software/citeshift-visibility-intelligence-for-the-ai-search-era | Measures how a business appears in AI-generated travel itineraries | Medium | D: scraping AI answers at scale | — | — |
| PatchEd | The Future of Agents Hackathon | Apify | https://devpost.com/software/patched | A syllabus that updates itself with cited "patch notes" | Medium | D: citations from scraped sources | FORGE's quote anchor is stricter; lead with "every value cites the saved page" | 0 |

No Factory track winners were found in the Devpost index; judge Factory work against the brief only.

**Patterns (inference).** CREAO winners at Cal Hacks 12.0 used CREAO as an app builder; FORGE's agent depth stands out only if the pitch makes it visible. SpacetimeDB winners showed schedules driving a world. Fetch winners combined several agents, cards, payments and a clear impact story. Bright Data winners made the scraping visible. Apify winners were mostly single scrapers, so FORGE's versioned shelf is distinctive.

---

## 6. Strengths (with evidence)

1. **End to end in about a minute after payment**, on four real orders (§2).
2. **Rules live in the database.** Founder-only approvals (`module/src/index.ts:1155`); refunds above `refund_limit_cents` become approvals (`:811-826`); atomic leased claims (`:715-727`) and lease checks on completion (`:735-740`); lowering the budget cap re-fits every pending compile in one transaction (`:2667-2690`); a sum-zero ledger (`:762`).
3. **The database calls the outside world.** Procedures are the only code that reaches CREAO, Apify and Bright Data (`creao_start` `:1309`, `dispatch` `:2338`); webhooks need a one-time token, never trust the body, and re-fetch the run with FORGE's key (`:1400-1412`, `:1360-1392`); idempotency keys on every CREAO start (`:2379`).
4. **Self-healing observed live.** Run 72's orphaned dispatch was recovered and retried by the schedule (`:2347-2355`, event 1735), and order #199 continued.
5. **Verified data with an honest failure path.** Quote anchor in both tiers; independent Bright Data re-fetch per value; `unverifiable` values are never delivered as facts; 1258 of 1274 value rows verified (`README.md:187`, includes test traffic); order #199 is an honest Auditor REJECT.
6. **Real agent-to-agent commerce.** The buyer agent found FORGE through Agentverse search and paid testnet FET twice: #131 (Tier 0) and #196 (Tier 1, no new build) (`README.md:137-143`).
7. **A real compile with real gates.** CFO invests 500¢ → budget reserved → locked Droid session → Auditor rejects → resumed session → Auditor accepts → founder ship approval #10 → Actor v1.0 (`README.md:95`). Cost per call fell 26.6% on one measured pair (`README.md:197`).
8. **A seconds-level customer challenge.** Saved page versus fresh fetch in 1000 ms (`README.md:49`).
9. **Honest documentation habits.** TODOs, a "Not built" list, and RECORDED and SIMULATED labels.

---

## 7. Weaknesses: confirmed versus unverified

### Confirmed (code or live data)

| # | Weakness | Evidence |
|---|---|---|
| W1 | Repo private; 4 commits unpushed | `gh repo view`; `git rev-list` (§2) |
| W2 | Maincloud lacks `refund_order`; #199 not refunded | §2 |
| W3 | No public CREAO run links: `dispatch` creates runs with an empty `shareUrl` (`module/src/index.ts:2366-2368`), nothing ever sets it, and the dashboard falls back to a login-only thread link (`web/src/feedText.ts:62-64`, used by `Drawer.tsx:186`, `Engineering.tsx:150`) | SQL; code |
| W4 | Front Desk replies are text only (`fetch-agents/front_desk/agent.py:60-64`), although the installed `uagents_core` 0.4.12 ships `MetadataContent` (`.venv/.../uagents_core/contrib/protocols/chat/__init__.py:67-74`) | code |
| W5 | Loose payment intent: `PAY_WORDS = {"pay", "buy", "yes", "accept", "ok"}` (`agent.py:39`) pays the stored quote (`:179-185`). The quote stays stored per sender until paid (`:244`) and has no expiry. With `FORGE_DEMO_PAY=true`, a stray "ok" records a SIMULATED payment and starts real vendor spend (`:264-269`) | code |
| W6 | The header `LIVE` badge is static (`web/src/Header.tsx:56`). During a replay, REPLAY shows in the bar and feed head (`web/src/styles.css:385-395`) while the header still says `LIVE`. When disconnected, only the dot changes (`:55`) | code |
| W7 | No automatic recovery for a lost CREAO webhook. `creao_poll` is a manual founder/canary procedure (`module/src/index.ts:1394-1398`). In-flight runs count against `creao_max_concurrency` = 2 (`:2356-2358`), so two stuck runs stop all CREAO work. A run that ends without a decision fails the task and leaves the order where it is, with no refund (`:1384-1389`). Neither has happened yet (0 events) | code; SQL |
| W8 | Customer-facing errors include Python exception class names (`agent.py:146, 162, 201, 233, 376`) | code |
| W9 | Canary orders never reach CREAO (`module/src/index.ts:2361`) and the canary runs by hand; `AGENTS.md` §10 describes it as a merge gate | code |
| W10 | Factory evidence needs careful framing: attempt 1 failed because the shared live test compared Discord's 46 rows with a Lattice fixture's 7 rows (`README.md:95`); the founder fixed the harness in `c6ac400` (`actors/template/test/live.test.js`, `workers/droid-runner/src/compiler.ts`); attempt 2 resubmitted the same extractor; no denied action in a real compile (`README.md:105`) | git; logs |
| W11 | Flat $1 quote (`agent.py:38`). `markup_pct` and `classify_min_confidence` are config keys (`module/src/index.ts:20, 25`) that the module never reads; `AGENTS.md` §8 forbids levers that only move a number | code |
| W12 | The Browser API rung never ran (`README.md:176, 184, 251`) | SQL |
| W13 | Bright Data cost per call is request count × list price, not billed usage | code (earlier audit) |
| W14 | False or stale claims in README, Devpost draft and demo doc | §15 |
| W15 | Screenshot links point at gitignored PNGs (`.gitignore:27-28`; `docs/compile-proof.md:26`; `docs/demo.md:31-32`), so they 404 on GitHub; `compile-shipped.png` does not exist locally either | files |
| W16 | The dashboard runs only on localhost or the tailnet (`docs/demo.md:26`), so judges cannot open it themselves | doc |

### Unverified risks

| # | Risk | What is known |
|---|---|---|
| U1 | FORGE may not appear for generic ASI:One discovery queries | The buyer agent's Agentverse search ranked it 6th for "FORGE public data APIs" (`README.md:135`) |
| U2 | Whether CREAO's API returns a share URL | The run type FORGE parses has no share field (`module/src/index.ts:1292`) |
| U3 | Credit balances (CREAO, Apify, Bright Data, Anthropic, ASI-1) on judging morning | not checked |
| U4 | Whether the running Front Desk includes `003eb2d` (refund lines in `status`) | process start time unknown |
| U5 | Office shows "Loading orders…" after returning to the tab | reported in the redesign review; not reproduced here (`web/src/Office.tsx:157`) |
| U6 | Whether a module publish can interrupt an in-flight procedure (a possible cause of run 72's orphan) | unknown; treat publishes as unsafe while runs are in flight |
| U7 | The envelope of a tapped card option in ASI:One (JSON or prose) | docs say both; verify in the playground |
| U8 | Venue Wi-Fi and Maincloud stability during judging | — |

---

## 8. Status of `docs/astra-advice.md`

| Advice | Status | Evidence | Action |
|---|---|---|---|
| Sentence feed instead of raw JSON | Implemented | `web/src/Feed.tsx`, `web/src/feedText.ts` | none |
| Needs-you approvals above the feed | Implemented | `web/src/NeedsYou.tsx`, `web/src/App.tsx:45, 61` | none |
| Decision card first in station drawers | Implemented | `web/src/Drawer.tsx:186` | none |
| Org chart with counted handoffs | Implemented | `web/src/OrgChart.tsx` | none |
| Clicking an org-chart edge filters the feed | Incomplete | not wired | P2-3 |
| Engineering workspace with RECORDED timeline | Implemented | `web/src/Engineering.tsx` | none; today it opens ticket #6, the newest visible job (`:45-46`) |
| Droid naming and "No engineering queued" | Implemented | `web/src/DroidStrip.tsx` | none |
| Verify drawer: saved page versus fresh fetch | Implemented | station drawers | none |
| Replay bar | Implemented | `web/src/ReplayBar.tsx`, rendered at `web/src/App.tsx:47` | fix the header badge (P1-2) and `README.md:252` |
| Test-traffic labeling | Implemented | `web/src/scope.ts` | none |
| Public CREAO run links | Incomplete | `web/src/feedText.ts:62-64`; 0 share URLs | P0-3, P1-4 |
| A denied Droid action in the story | Real only on simulated `cmp-test` tickets | `README.md:105` | keep it honest; P2-2 if a new compile runs |
| "Rework continues the same thread" | Doc only, and false | `README.md:65`, `AGENTS.md:400`; dispatch sends no `threadId` (`module/src/index.ts:2376-2381`) | fix the docs |
| Founder messaging | Missing, correctly deferred | — | none |

Do not rebuild anything marked Implemented.

---

## 9. Backlog

### P0: do first (≈00:40–02:15, mostly founder, low code risk)

#### P0-1. Publish the module, refund #199, restart the Front Desk [FOUNDER; agent prepares and verifies]

- **Finding.** Maincloud lacks `refund_order`. Order #199 still holds the customer's $1.00 TEST MODE after the Auditor rejected the deliverable.
- **Evidence.** "no such reducer" on Maincloud; reducer at `module/src/index.ts:1178-1190`; the dashboard's refund UI (commit `554742a`) calls it; `DEAD_PAID` includes `audit_rejected` (`:809`); 100¢ ≤ `refund_limit_cents` 500, so the refund issues immediately (`:818`); `books` `customer:199` = −100.
- **Why judges care.** "What happens to my money if you fail?" gets a live answer. It closes the loop the CREAO Auditor started, shows reducer-enforced money rules (SpacetimeDB), and the `status` reply reports the refund (Fetch, commit `003eb2d`).
- **Proposed change.** No code. Publish HEAD, refund #199 from the dashboard, restart the Front Desk.
- **Implementation scope.** Runbook §13.1.
- **Effort and risk.** 15 minutes. Low-medium: publishing while a procedure runs may orphan a dispatch, so check first. Never pass `--delete-data`.
- **Acceptance criteria.** `spacetime describe -s maincloud forge reducer refund_order` succeeds. `SELECT * FROM refund WHERE order_id = 199` returns one `issued` row for 100. `SELECT * FROM books WHERE account = 'customer:199'` returns 0. An `order_refund_requested` event exists. `status` in customer 105's ASI:One chat shows the refund line.
- **How to demonstrate.** Order #199 on the dashboard shows the refund badge; the feed reads "Auditor rejected" followed by the refund. Use it when a judge asks for a failure.
- **Sponsors strengthened.** SpacetimeDB, CREAO, Fetch.

#### P0-2. Push and make the repo public [FOUNDER]

- **Finding.** The repo is private and 4 commits behind local.
- **Evidence.** `gh repo view` → `PRIVATE`; `git rev-list --left-right --count origin/main...main` → `0 4`.
- **Why judges care.** Fetch requires a public repo. CREAO checks README links. Every proof link in the README (`docs/proof/*.json`, `docs/compile-proof.md`, Droid logs) is a 404 for a judge today.
- **Proposed change.** Run a real secret scanner over the full history, push `main`, make the repo public, then open the README logged out.
- **Implementation scope.** `gitleaks detect --source . --log-opts="--all"` (or `trufflehog git file://.`); `git push origin main`; `gh repo edit sudoanmol/Calhacks_Forge --visibility public --accept-visibility-change-consequences`. Also confirm the public `forge-cli` skill repo, if the README links one.
- **Effort and risk.** 15–20 minutes. The risk is a secret in history: the pattern scan in §2 found none, but Bright Data keys have no distinctive prefix, so the scanner is required.
- **Acceptance criteria.** A logged-out browser opens the README, `docs/proof/asi-challenge-202.json`, `docs/compile-proof.md` and a Droid log under `workers/droid-runner/logs/`. The scanner reports no findings, or each finding is triaged and the key rotated.
- **How to demonstrate.** README links in Devpost and on the pitch slide.
- **Sponsors strengthened.** All; mandatory for Fetch.

#### P0-3. Public CREAO run links for every seat in the README [FOUNDER creates links; agent edits README]

- **Finding.** 0 share URLs exist; the README has one (CFO) and two TODOs (`README.md:84-85`).
- **Evidence.** SQL on `run`; `README.md:80, 84-85`.
- **Why judges care.** Depth on CREAO is 25% and "we check the links in your README". The One-Person Company brief wants agents handing work to each other; each link proves a handoff happened inside CREAO.
- **Proposed change.** Create share links for the runs below and add a README table under "CREAO": seat · decision · reducer it called · order or ticket · link.
- **Implementation scope.** Runs matched by timestamps; confirm each `task_id` → order with SQL before sharing (`SELECT id, task_id, thread_id FROM run WHERE id = 81`, then `SELECT id, kind, role, order_id, ticket_id FROM task WHERE id = <task_id>`). Open the thread logged in (`https://agent.creao.ai/chat?threadId=<thread_id>`) and use Share, as was done for the CFO link.

  | Run | Seat | Decision | On |
  |---|---|---|---|
  | 81 | COO | ACCEPT, existing API | order #202 |
  | 83 | Auditor | ACCEPT, 21/21 verified | order #202 |
  | 73 | COO | REQUEST_RESEARCH | order #199 |
  | 77 | Research | gate report with cited robots.txt and terms | order #199 |
  | 78 | COO | ACCEPT, creates a new API (Apify Task) | order #199 |
  | 80 | Auditor | REJECT, missing field | order #199 |
  | 84 (likely) | Auditor | challenge #14 ruling | order #202 |
  | 65, 66 (likely) | Auditor | compile attempt 1 REJECT, attempt 2 ACCEPT | ticket #6 |
  | existing link | CFO | COMPILE, 500¢ | ticket #6 |

- **Effort and risk.** 30–40 minutes. Low.
- **Acceptance criteria.** Every link opens in a logged-out browser and shows the agent calling the `forge` CLI command for its reducer. The README has at least one link per seat (COO, Research, CFO, Auditor), including one REJECT.
- **How to demonstrate.** In the pitch, click the COO decision on the live order; at the CREAO table, open the README links.
- **Sponsors strengthened.** CREAO.

#### P0-4. Fetch mandatory deliverables [FOUNDER, plus a small CODE change]

- **Finding.** No badges, no agent README, no Submission Agent registration, no video, private repo.
- **Evidence.** TODOs at `README.md:145-146`; `Agent(...)` at `fetch-agents/front_desk/agent.py:43-49` has no `readme_path`, although uagents 0.26.1 supports it (`.venv/lib/python3.12/site-packages/uagents/agent.py:318, 456-459`); the string `innovationlab` appears nowhere in the repo.
- **Why judges care.** These are mandatory. Missing one can remove FORGE from the Fetch pool.
- **Proposed change.**
  - [CODE] Add `fetch-agents/front_desk/README.md`: both badges, a one-paragraph description, capabilities, three tested example prompts, payment methods (Stripe test card, testnet FET, labeled TEST MODE) and the agent address. Pass `readme_path="front_desk/README.md"` to `Agent(...)`; the path joins `os.getcwd()` (`uagents/agent.py:457`), and the agent runs from `fetch-agents/` (`README.md:237`). Add the same badges to the Fetch section of the repo README.
  - [FOUNDER] Restart the agent and confirm the Agentverse profile shows the README. In ASI:One, without an @mention, ask for "an agent that sells verified public web data" and record the honest result. Register through the CalHacks ASI:One Submission Agent. Save a shared ASI:One chat link of one complete order. Record the 3–5 minute video (§12.4).
- **Implementation scope.** One new Markdown file, one keyword argument, README edits.
- **Effort and risk.** 45 minutes plus the video. Low.
- **Acceptance criteria.** The Agentverse profile shows both badges. The repo README lists name, address and badges. A registration confirmation screenshot is saved. The discoverability result is written down, whatever it is.
- **How to demonstrate.** Agentverse profile and ASI:One in the Fetch video; the shared chat link in the README.
- **Sponsors strengthened.** Fetch.

#### P0-5. Fix false claims in README, Devpost draft and demo doc [CODE, docs only]

- **Finding.** Several published claims contradict the code (full list in §15).
- **Evidence.** For example `README.md:65` versus `module/src/index.ts:2376-2381`, and `README.md:252` versus `web/src/App.tsx:47`.
- **Why judges care.** Judges read the README, and CREAO says it checks it. One false claim costs trust in every true one.
- **Proposed change.** Apply §15.
- **Effort and risk.** 20–30 minutes. No risk.
- **Acceptance criteria.** Every §15 item is fixed; `rg -n "same thread|Best Actor" README.md docs/devpost.md` returns no claim that the code contradicts.
- **Sponsors strengthened.** All.

#### P0-6. Runbook for stuck CREAO runs and dead-end orders [CODE, docs only]

- **Finding.** W7. The mitigation already exists in code, but nobody wrote down how to use it.
- **Evidence.** `creao_poll` (`module/src/index.ts:1394-1398`); `refund_order` (`:1178`).
- **Why judges care.** A judge's paid order that silently stalls is the worst demo outcome.
- **Proposed change.** Add §13.3 to `docs/demo.md`.
- **Effort and risk.** 10 minutes. None.
- **Acceptance criteria.** The founder can find a stuck run and recover it within 60 seconds by following the doc.
- **Sponsors strengthened.** CREAO, SpacetimeDB, Fetch.

### P1: code and deploy (≈01:00–04:30)

#### P1-1. Interactive Cards in the Front Desk, plus strict payment intent [CODE] (≈2–2.5 h)

- **Finding.** Replies are plain text. Paying is a keyword, and "yes", "ok", "accept" or "buy" pay whatever quote is stored. Delivery is a Markdown table that appears only on `status`.
- **Evidence.** `agent.py:60-64` (TextContent only); `:39` and `:179-185` (pay words); `:242-244` (quote stored with no time); `:251` ("Reply **pay** to accept"); `MetadataContent` available in the installed `uagents_core` (`chat/__init__.py:67-74`).
- **Why judges care.** The Fetch hackpack recommends cards and lists them as a bonus. UX is 15% of the Fetch score. The strongest recent Fetch winner (ResourcePilot) used cards and live badges. A judge typing "ok" by reflex must never trigger a payment.
- **Proposed change.**
  1. New `fetch-agents/front_desk/cards.py` with pure functions:
     - `card_metadata(kind, payload, *, terminal=False, width=None) -> dict[str, str]`: builds the five metadata keys (§4); every value is a `str`; `card_payload = json.dumps(payload, separators=(",", ":"))`; raise if it exceeds 60,000 bytes.
     - `quote_card(quote, scope, simulated) -> dict[str, str]`: `card_kind` `review`. Payload: `title` "Order #N · <summary>"; `summary_rows` for Sources, Fields, Scope, Price ("$1.00 TEST MODE", plus "SIMULATED PAYMENT" when demo pay is on) and Proof ("Every value comes with a verbatim quote from the source page"); `approve_cta` `{label: "Pay $1.00 (TEST MODE)", selection: "forge:pay:<order_id>"}`; `reject_cta` `{label: "Cancel", selection: "forge:cancel:<order_id>"}`.
     - `order_card(order, values, api, refunds) -> dict[str, str]`: `card_kind` `detail`. Delivered orders: `title` "Order #N · <api> · Delivered"; `summary_rows` for Verified ("21/21 verified by an independent Bright Data re-fetch"), API ("open-roles v1.0 · Tier 1"), Price (TEST MODE), Dataset (URL as text), any refund line, and up to 6 sample values ("Row 3 · team" → "Engineering ✓ verified"); `ctas` "Challenge a value" (`forge:challenge:<order_id>`) and "Refresh status" (`forge:status`). Other orders: status in words plus "Refresh status".
     - `parse_selection(text) -> Selection | None`: first `json.loads` the text and look for a `forge:` token in any string value; otherwise search the prose for `forge:(pay|cancel|challenge):(\d+)` or `forge:status`; otherwise `None`.
  2. `agent.py`:
     - `_text(body, end=False, card=None)` (`:60-64`): when `card` is given, append `MetadataContent(metadata=card)` after the `TextContent`. The text always carries the full message, so an invalid card degrades to today's behavior.
     - `reply(ctx, to, body, card=None)` (`:76-77`) passes the card through.
     - `on_chat` (`:166-185`): right after `strip_mentions` (`:169`), `if sel := parse_selection(text): await handle_selection(ctx, sender, sel); return`.
     - `handle_selection`: `pay` runs `request_payment` (`:262`) only if the stored quote's `order_id` matches and the quote is less than 30 minutes old; otherwise reply that the quote is no longer open. `cancel` removes `quote:{sender}` and confirms nothing was charged. `status` runs `reply_status` (`:157`). `challenge` replies with the exact phrasing ("row 3 team is wrong because …") and the field names of that order.
     - Payment words (`:39`, `:180`): `PAY_WORDS = {"pay", "pay now"}`. Add `CONFIRM_WORDS = {"yes", "ok", "okay", "accept", "buy", "sure"}`: with a stored quote, reply "To pay for order #N ($1.00 TEST MODE), tap **Pay** on the card or reply **pay**."; without one, keep the existing reply (`:184`).
     - Store `quoted_at` (ISO UTC) in the quote dict (`:242-244`) and expire quotes after 30 minutes, so an old quote from an earlier session can't be paid by accident on stage.
     - Quote reply (`:245-254`): send the text plus `quote_card(...)`.
     - `reply_status` (`:157-163`): have `_status_text` (`:84-93`) also return the latest order, its values, API and refunds, then send the text plus `order_card(...)`.
     - Optional, 10 minutes: add "Paid → accepted: N s" to the delivered card, computed from the order's `order_paid` and `audit_accepted` events. It is measured per order, so it is honest.
  3. During testing, log the raw inbound text of tapped options in full; `_log` truncates to 80 characters (`:68`).
- **Implementation scope.** `fetch-agents/front_desk/cards.py` (new), `fetch-agents/front_desk/agent.py`, `fetch-agents/tests/test_cards.py` (new), additions to `fetch-agents/tests/test_payments.py`. Then the README Fetch section and `README.md:248` (remove "Interactive chat cards" from Not built).
- **Effort and risk.** 2–2.5 hours. Medium-low. Invalid cards fall back to text silently, which is safe but can hide a broken card, so verify rendering on a real phone.
- **Acceptance criteria.**
  - Validate both payloads in the card playground before wiring them.
  - A new request in ASI:One gets one message with the quote text and a rendered review card (screenshot).
  - Tapping Pay sends exactly one `RequestPayment` for that order; tapping Cancel clears the stored quote and says so.
  - "ok" or "yes" never triggers a payment.
  - `status` on a delivered order returns the text table plus a detail card with k/n verified and a Challenge option.
  - `cd fetch-agents && uv run pytest -q` passes, including new tests: every metadata value is a `str`; `card_payload` round-trips through `json.loads`; required keys per kind; a 500-row order stays under 60,000 bytes; `parse_selection` handles a JSON envelope, a bare token, a token inside prose and garbage; "ok" with a stored quote sends no `RequestPayment`; "pay" with a fresh quote sends one; "pay" with a 31-minute-old quote replies that it expired.
- **How to demonstrate.** The judge taps "Pay $1.00 (TEST MODE)" on the card, later taps "Refresh status", and sees the delivered card with verified badges.
- **Sponsors strengthened.** Fetch (cards, UX, reliability), CREAO (the demo works smoothly).

#### P1-2. Honest LIVE / REPLAY / OFFLINE header badge [CODE] (≈20 min)

- **Finding.** The header shows `LIVE` during a replay and while disconnected.
- **Evidence.** `web/src/Header.tsx:55-56`; replay state in `web/src/App.tsx:30-31`; Header rendered at `App.tsx:44`.
- **Why judges care.** `AGENTS.md` §2 rule 2: replays are labeled REPLAY. A judge who sees `LIVE` next to a replay can fairly say a replay was presented as live.
- **Proposed change.** Pass `replaying={cursor !== null}` to `Header` at `App.tsx:44`. In `Header.tsx`, render `OFFLINE` when `!conn.isActive`, `REPLAY` (existing `.badge.replay`, `web/src/styles.css:385`) when replaying, else `LIVE`. Add a muted `.badge.offline` style next to `.badge.live` (`styles.css:23`).
- **Implementation scope.** `web/src/App.tsx`, `web/src/Header.tsx`, `web/src/styles.css`.
- **Effort and risk.** 20 minutes. Low.
- **Acceptance criteria.** `pnpm -C web run typecheck` and `pnpm -C web run build` pass. With `agent-browser`: `LIVE` on load; `REPLAY` in the header while the replay cursor is set; `LIVE` again after leaving replay; screenshots saved. For `OFFLINE`, run a second dev server with `VITE_SPACETIME_HOST` pointed at an unreachable host and screenshot it, or report that it was skipped.
- **How to demonstrate.** Start a replay on stage and point at the header.
- **Sponsors strengthened.** SpacetimeDB, and every judge's trust.

#### P1-3. Public read-only dashboard URL with a QR code [FOUNDER deploys; CODE verifies] (≈30–45 min)

- **Finding.** Judges can't open the dashboard.
- **Evidence.** `docs/demo.md:26` (localhost and a tailnet IP). The build needs no env: host and database default to Maincloud and `forge` (`web/src/main.tsx:9-10`); each visitor gets its own identity token (`:16-18`) and sees the Viewer chip; founder actions require the founder identity (`App.tsx:35`).
- **Why judges care.** The judge's own phone becomes the second device, which is the most convincing SpacetimeDB moment (compare CoClip). Headcount:1 had a public demo link for the CREAO judges.
- **Proposed change.** `pnpm -C web run build`; before deploying, search `web/dist` for key patterns (`rg -n "capi_|sk_test_|sk-ant-|apify_api_" web/dist`); the founder deploys `web/dist` to any static host. Add the URL to the top of the README and print a QR code for the slide and the table card.
- **Implementation scope.** No code change expected.
- **Effort and risk.** 30–45 minutes. Low: the tables shown are already public on Maincloud, and viewers cannot call founder reducers.
- **Acceptance criteria.** In incognito: Viewer chip, approval buttons disabled with "Founder identity required", real-order scope by default. A phone on cellular data shows the same order headline as the laptop, and a change on one appears on the other without a reload.
- **How to demonstrate.** §10 script.
- **Sponsors strengthened.** SpacetimeDB, CREAO.

#### P1-4. Public CREAO links inside the dashboard: `set_run_share_url` [CODE; FOUNDER publishes and calls] (≈45 min)

- **Finding.** Even after P0-3, the dashboard still opens login-only threads, because `run.shareUrl` stays empty.
- **Evidence.** `web/src/feedText.ts:62` already prefers `shareUrl` ("Open run ↗") and is used by the feed, the drawers (`Drawer.tsx:186`) and the Engineering tab (`Engineering.tsx:150`).
- **Why judges care.** One click from any CREAO decision on the dashboard to the public run page, without leaving the demo.
- **Proposed change.** A founder-only reducer next to `refund_order` (`module/src/index.ts:1178`): `set_run_share_url({ runId: t.u64(), shareUrl: t.string() })`. It calls `requireRole(ctx, 'founder')`, requires `run.provider === 'creao'`, requires the URL to match `^https://agent\.creao\.ai/share/[0-9a-f]{16,64}$`, updates the run and calls `logEvent(ctx, 'founder', 'run_share_linked', 'run', runId, { shareUrl })`. Add a feed template (or plumbing fold) for `run_share_linked` in `web/src/feedText.ts`. Regenerate bindings with `pnpm -C web run generate`. Separately, check whether `GET /api/v1/runs/{id}` returns a share field; if it does, set it in `refreshCreaoRun` (`:1379-1382`) instead (verify first).
- **Implementation scope.** `module/src/index.ts`, `web/src/module_bindings/*` (generated), `web/src/feedText.ts`, a test in `module/test/creao.test.mjs` (or a new file) run against `publish:local`.
- **Effort and risk.** 45 minutes plus a publish. Low (an additive reducer, no schema change).
- **Acceptance criteria.** Locally: a non-founder call fails with a SenderError (HTTP 530); a bad URL fails; a founder call sets `share_url`. On Maincloud after the publish: the founder runs `spacetime call -s maincloud forge set_run_share_url 81 '"https://agent.creao.ai/share/…"'` (check argument syntax with `spacetime call --help`); `SELECT id, share_url FROM run WHERE share_url != ''` lists the linked runs; with `agent-browser`, the COO decision on #202 shows "Open run ↗", which opens the public page logged out.
- **How to demonstrate.** Click the COO station on #202 → decision card → "Open run ↗".
- **Sponsors strengthened.** CREAO.

#### P1-5. README "judge tour" and committed proof screenshots [CODE, docs] (≈45 min)

- **Finding.** Proof is scattered and the screenshots are not public.
- **Evidence.** `.gitignore:27-28`; `docs/compile-proof.md:26`; `docs/demo.md:31-32`; README TODOs.
- **Why judges care.** Sponsor judges spend about a minute on a README. They need links they can open.
- **Proposed change.** Add a "Judge tour (60 seconds)" section at the top of the README: public dashboard URL, ASI:One shared chat link, Agentverse profile, the CREAO decision table (P0-3), Apify Actor, Task and Store links, compile proof, both videos. Commit 6–10 curated PNGs under 500 KB each by adding `!docs/proof/<name>.png` exceptions after `.gitignore:28`. Capture the missing `compile-shipped.png`. Fix the links in `docs/compile-proof.md:26` and `docs/demo.md:31-32`.
- **Effort and risk.** 45 minutes. None.
- **Acceptance criteria.** Every link in the tour opens logged out; every image renders on GitHub.
- **Sponsors strengthened.** All, especially CREAO and Apify.

### P2: only if every P1 item passes before ~03:30

| # | Item | Effort and risk | Notes |
|---|---|---|---|
| P2-1 | **Scheduled CREAO watchdog and automatic refund for dead ends.** New private table `creao_watch_schedule`, seeded in `init` (`module/src/index.ts:649`) **and** in `ensure_defaults` (`:2868-2874`), because `init` does not run on a normal publish (call `ensure_defaults` once after publishing). A scheduled procedure every 60 s re-fetches up to 4 CREAO runs that have been `pending`, `running` or `queued` for more than 180 s, through `refreshCreaoRun` (`:1360`); it is idempotent, because terminal runs return early (`:1363`). In the dead-end branch (`:1384-1389`): if `task.attempt < 2`, requeue the task with event `task_requeued_no_decision`; otherwise fail it as today and, for a paid order without a deliverable, set the order to `failed` with a reason and call the existing refund helper used by `refund_order` (`:1186`), which applies `refund_limit_cents`. Tests: pure helpers `staleRuns(...)` and `deadEndAction(...)` in `module/test/unit.test.mjs`; one full live order after the publish to prove nothing regressed | 1–1.5 h, medium | Start only if P1-1 to P1-3 pass by 03:00. The risk is real but unobserved (0 events), and the runbook (§13.3) covers it manually |
| P2-2 | **Second real compile rehearsal on `yc-directory`.** The founder sets `compile_min_buyers` to 1; `set_config` re-runs the triggers (`:682`). Check whether a new ticket opens: ticket 1 for `yc-directory` is `closed`. The CFO decides for real and may DEFER. If it says COMPILE, either keep the droid-runner stopped so a queued job exists for the budget-cap moment (§10), or start the runner to record a second Droid compile. Restore the setting afterwards | founder time plus background; medium | Start by 02:30 or skip. Real spend (1460¢ left in the budget). A failed compile is an honest outcome |
| P2-3 | Clicking an org-chart edge filters the company feed (`web/src/OrgChart.tsx`, `web/src/Feed.tsx`) | 45 min, low | Listed in `AGENTS.md` §8 |
| P2-4 | Customer-facing errors without exception class names; keep the class in the log (`agent.py:146, 162, 201, 233, 376`) | 15 min, low | |
| P2-5 | Label `markup_pct` and `classify_min_confidence` in Controls → Advanced as "not used yet", or hide them | 15 min, low | `AGENTS.md` §8 forbids levers that only move a number |
| P2-6 | A catalog carousel card for "what can you sell me?" and a challenge form card | 1 h, medium | After P1-1 only |
| P2-7 | Reproduce the Office "Loading orders…" bug with `agent-browser` (`web/src/Office.tsx:157`); promote to P1 if it reproduces | 15 min to check | |
| P2-8 | `scripts/demo-deny.sh`: calls `set_budget_cap` with the Front Desk token from `.env` and prints only the HTTP status and body (a 530 SenderError), never the token | 10 min, low | Gives §10 a deterministic "rule in the database" moment |

### P3: after the hackathon (also the honest "What's next")

Browser API rung live (`BRIGHTDATA_BROWSER_WSS`, a live test, evidence rows); CREAO rework on the same `threadId`; Droid enhancement and warranty tickets with an `open_ticket` reducer; COO pricing using `markup_pct`; the Front Desk classification threshold; a canary that goes through CREAO and runs in CI; event actor identities; scoped subscriptions; the CFO's scheduled daily report; x402.

---

## 10. SpacetimeDB positioning and the 30–60 second demo

**Positioning (say this).** "FORGE has no backend server. The whole company is one SpacetimeDB module: 40 tables; 34 reducers that hold every rule; 13 procedures, which are the only code allowed to call CREAO, Apify and Bright Data; 3 webhook routes; and 8 schedules that keep the company moving. Every agent (Fetch, CREAO, Droid) has its own identity and changes state only through reducers. The dashboard is just a subscriber."

**Why this is beyond basic subscriptions.** The realtime sync exists and works; do not rebuild it. What distinguishes FORGE from multiplayer winners like CoClip or scalpal is that the database coordinates outside AI systems: it starts CREAO runs, receives their webhooks, re-fetches results with its own key, enforces money and approval rules, and recovers its own failures. FORGE's weakness here is presentation: judges see a polished dashboard and assume a normal backend.

**Strongest improvement.** P1-3 (the judge's own phone as the second device), plus P1-2 (an honest badge), plus a scripted rule refusal (P2-8 or the disabled founder button).

| Time | Do | Say | Mode |
|---|---|---|---|
| 0–10 s | Show the QR code; the judge opens the dashboard on their phone (Viewer chip) | "Your phone just subscribed to the same tables my agents write to. There's no backend server." | Live |
| 10–25 s | Pay a quote in ASI:One; the order appears on both screens; within about 5 s the COO station shows the CREAO run | "The Front Desk called a reducer. A schedule dispatched the COO. CREAO will call back into a database route, and the database re-checks the run with its own key." | Live |
| 25–40 s | On the founder phone: Controls → lower the engineering budget cap; both screens update. If a compile job is queued (P2-2), it turns `ineligible` | "Lowering the cap re-fits every pending compile in one transaction." | Live; the `ineligible` effect needs a queued job, otherwise cite the recorded run in `README.md:113` and call it RECORDED |
| 40–55 s | Run `scripts/demo-deny.sh` (P2-8), or have the judge tap a founder button | "Any identity that isn't the founder gets a SenderError from the database itself, not from the UI." | Live |
| 55–60 s | In the feed, show `orphan_dispatch_recovered` (run 72 → 73) | "Last night a dispatch died mid-flight. The schedule recovered it and the order still delivered." | RECORDED (say so) |

---

## 11. Fetch.ai and ASI:One plan

1. **Meet every mandatory item first:** P0-2 (public repo) and P0-4 (badges, agent README, discoverability check, Submission Agent registration, shared chat link, video).
2. **Win UX with cards:** P1-1 (review card for the quote, detail card for status and delivery, one-tap "Refresh status", strict payment intent).
3. **60-second ASI:One-only demo:** the judge opens the pre-opened chat → "Open roles at Discord by team and location" → review card → Pay → "Refresh status" → delivered card with 21/21 verified → "Challenge a value" → `row 3 team is wrong because …` → the recheck result arrives on the next status, about a second later.
4. **Agent-to-agent purchase:** run the buyer agent (`uv run --env-file ../.env python -m buyer.agent "…"`, `README.md:238`). It found FORGE on Agentverse and paid 1 testnet FET in about 100 s end to end before (#131, #196). Start it at the beginning of a sponsor-table conversation and show the log when it lands.
5. **Talking points.** Chat Protocol and Payment Protocol as seller, with Stripe test and testnet FET; an independent buyer agent with its own wallet; the layer-2 gate inside the agent (instant, cited rejections that cost nothing); the reason for the `status` step (ASI:One doesn't show agent-initiated messages, `README.md:255`), now one tap.
6. **Bonus coverage.** Multi-agent: Front Desk plus buyer, with the CREAO staff behind them. Payment Protocol: yes. Cards: after P1-1. Reliability: idempotent payment settlement (`agent.py:283-308`) and FET double-spend checks (`:327-384`). Real-time data: live Bright Data fetches. Continued operation: claim it only if the agent will keep running after judging.

---

## 12. Demo plan

### 12.1 Opening 30 seconds

> "I'm the only person at FORGE. These are my employees." *(Org chart.)* "A Front Desk on Fetch. Four CREAO agents: a COO, Research, a CFO and an Auditor. A Droid engineer. An Apify warehouse. They all work inside one SpacetimeDB database. Today they made N decisions for every M approvals I made." *(Read the pair off the header; do not memorize a number.)* "FORGE sells APIs over public web data. You ask for one in ASI:One. The company decides whether it's allowed, builds it, proves every value against the source page, and gets cheaper every time it sells. Ask it for something." *(Hand over the phone.)*

### 12.2 The 2-minute live path (one `open-roles` order)

| Time | Action | Mode | If it slips |
|---|---|---|---|
| 0:00–0:30 | Opening; the judge sends a printed prompt in the pre-opened ASI:One chat; the review card appears | Live | Read the card's fields aloud |
| 0:30–0:40 | The judge taps Pay (Stripe 4242 if rehearsed under 30 s, otherwise SIMULATED PAYMENT, labeled); the order appears on the laptop and on the judge's phone | Live | Keep talking over the org chart |
| 0:40–1:05 | COO station: "a saved CREAO agent reads the order through our CLI and calls `coo_decide`"; the decision lands (19–27 s measured); open the decision card and its run link | Live | At 1:10 with no decision, switch to #202 (RECORDED, say so) and return later |
| 1:05–1:20 | Apify runs the Tier 1 Actor Droid compiled (≈10 s); Bright Data verifies every value (≈3 s): "21/21 verified by an independent re-fetch" | Live | — |
| 1:20–1:40 | The Auditor accepts (18–23 s): "bonuses accrue only on accepted work"; the judge taps "Refresh status" and sees the delivered card | Live | Use the gap for 12.2's next row |
| 1:40–1:55 | Engineering tab, RECORDED: "This API got cheaper last night. Droid wrote the extractor. The Auditor rejected attempt 1 because our test harness was wrong; I fixed the test, Droid kept its code, the Auditor accepted, I approved the ship. Cost per call fell 26.6% on one measured pair." | RECORDED | — |
| 1:55–2:00 | Close: "One human approved the consequential actions. The company decided, proved every value, and got cheaper with every sale." | — | — |

Save the customer challenge (about 1 second to recheck) for Q&A or the sponsor tables.

### 12.3 One order, every sponsor

The `open-roles` order is the spine because every sponsor touches it: Fetch takes the request and the payment; SpacetimeDB records the order and every rule; CREAO's COO accepts it and CREAO's Auditor signs off; Apify runs the Tier 1 Actor; Factory's Droid built that Actor; Bright Data re-fetches every value; and SpacetimeDB books the money. Before the demo, test three companies on the Tier 1 Actor tonight and print exactly those (Lattice and Discord already passed the Tier 1 canary, `README.md:54`).

### 12.4 Videos

**Devpost video (2–3 minutes):** 0:00–0:15 hook and org chart; 0:15–1:15 one real order end to end, recorded live with timestamps visible; 1:15–1:40 a challenge with saved versus fresh quotes; 1:40–2:15 the compile story on the RECORDED Engineering tab, ending with the buyer agent buying the Tier 1 API with no new build; 2:15–2:40 the budget-cap lever on two devices; 2:40–3:00 sponsor map and close.

**Fetch video (3–5 minutes):** ASI:One only. Discovery or the Agentverse profile → request → review card → Stripe test payment → status card → delivered card → challenge → the buyer agent's autonomous FET purchase and its log → a short slide of the Fetch architecture (Chat Protocol, Payment Protocol, gate, buyer).

### 12.5 Sponsor-table slices

| Sponsor | 30–60 seconds |
|---|---|
| CREAO | Org chart → click the COO node → last three decisions → open the public share link. "Remove CREAO and orders stop at `paid`." Point at the agent IDs and the decision table in the README |
| SpacetimeDB | §10 |
| Fetch | §11 item 3; start the buyer agent at the beginning |
| Apify | Apify Console: `forge-extract`, the Tasks per API, the `forge-open-roles` Actor v1.0; a dataset and the saved page in the key-value store that a challenge reads |
| Bright Data | Verify drawer: attempts with status, milliseconds and country; challenge recheck of 1000 ms; the honest `unverifiable` from a compliance block. Say plainly that the Browser API rung is coded but has not run |
| Factory | RECORDED Engineering tab for ticket #6; the control table (`README.md:97-103`); the honest attempt story; optionally P2-2 live |

### 12.6 Live versus RECORDED versus REPLAY versus SIMULATED

| Mode | What | Label on screen |
|---|---|---|
| Live | The judge's order, CREAO decisions, Apify run, verification, Auditor, challenge recheck, founder levers, approvals | `LIVE` (after P1-2, only when connected and not replaying) |
| RECORDED | The ticket #6 compile, buyer-agent purchases (logs), the CFO decision, run 72's recovery | `RECORDED` with original timestamps |
| REPLAY | Re-rendering a past order with the replay bar | `REPLAY` in the header (P1-2), the bar and the feed head |
| SIMULATED | Payments when `FORGE_DEMO_PAY=true` | `SIMULATED PAYMENT` in chat, on the dashboard and in the ledger |

### 12.7 On-screen metrics to point at

The header: revenue (TEST MODE), verified %, cost per call, APIs for sale, `agent decisions N : founder approvals M`. The order headline: k/n verified, elapsed time, price with TEST MODE. The delivered card: k/n verified and, if built, "Paid → accepted: N s" computed for that order. Never quote a timing that the screen or a stored row doesn't show.

### 12.8 Backup paths

| Failure | Backup |
|---|---|
| ASI:One or the Front Desk is down | Run the buyer agent (no typing needed); the live order still appears on the dashboard |
| CREAO slow (> 60 s) or failed | Narrate the org chart; open #202's decision as RECORDED; after 2 minutes use §13.3 (`creao_poll`); refund a dead end with `refund_order` |
| Stripe checkout fails | testnet FET, or SIMULATED PAYMENT with the label |
| Venue Wi-Fi | Phone hotspot (Maincloud needs internet either way) |
| Dashboard crash | The public URL (P1-3) on any device, or `pnpm -C web preview` |
| Maincloud down | The Devpost video, labeled RECORDED |

### 12.9 Pre-demo checklist (10:00)

- Laptop on power with `caffeinate -dims`.
- Front Desk running; a `status` from the founder's ASI:One gets a reply.
- Public dashboard loads on a phone over cellular; the laptop header says `LIVE`.
- No stuck runs (§13.3 query returns nothing).
- Credits checked: CREAO, Apify, Bright Data, Anthropic, ASI-1; Stripe in test mode.
- `FORGE_DEMO_PAY` set as intended, with the label visible.
- droid-runner stopped unless a live compile is planned.
- Printed card with three tested prompts; ASI:One chat pre-opened.
- Backup video on the desktop, playable offline.

---

## 13. Implementation order and runbooks

### 13.1 Publish and refund runbook [FOUNDER]

```sh
# 1. Nothing in flight (both must return no rows)
spacetime sql -s maincloud forge "SELECT id, status FROM run WHERE status = 'starting' OR status = 'pending' OR status = 'running' OR status = 'queued'"
spacetime sql -s maincloud forge "SELECT id, kind, status FROM task WHERE status = 'dispatched' OR status = 'claimed'"
# 2. Build, then publish HEAD (same command as docs/paid-failure-spec.md:175; never --delete-data)
pnpm -C module run build
spacetime publish -s maincloud -p module forge
# 3. Verify
spacetime describe -s maincloud forge reducer refund_order
# 4. Refund #199 from the dashboard (founder identity), or:
spacetime call -s maincloud forge refund_order 199 '"Auditor rejected the deliverable: a requested field was missing"'
# 5. Check
spacetime sql -s maincloud forge "SELECT id, order_id, amount_cents, status FROM refund WHERE order_id = 199"
spacetime sql -s maincloud forge "SELECT * FROM books WHERE account = 'customer:199'"
# 6. Restart the Front Desk so it runs 003eb2d (from fetch-agents/)
uv run --env-file ../.env python -m front_desk.agent
```

### 13.2 Timeline (two tracks in parallel)

| Time (PDT) | Founder | Coding agent |
|---|---|---|
| 00:40–01:00 | P0-1 publish, refund, restart | P0-5 doc fixes, P0-6 runbook |
| 01:00–01:20 | P0-2 secret scan, push, make public | P1-1 cards: `cards.py` and tests first |
| 01:20–02:00 | P0-3 CREAO share links | P1-1 continued: `agent.py` wiring; playground validation |
| 02:00–02:30 | P0-4 Agentverse README and badges, discoverability, registration | P1-1 live test with the founder's phone |
| 02:30–03:00 | P1-3 deploy the dashboard, QR code | P1-2 header badge; P1-5 judge tour |
| 03:00–03:45 | Dry run of the 2-minute pitch | P1-4 `set_run_share_url` (go/no-go at 03:00; then P2 by priority) |
| 03:45–04:30 | Final publish (batched), set share URLs, full live order | Freeze checks (§14) |
| 04:30–06:30 | Record both videos | Captions, README and Devpost text |
| 06:30–07:30 | Check every link logged out | Final doc pass |
| 07:30–08:15 | Submit on Devpost; confirm Fetch registration | — |
| 08:15–10:30 | Sleep, then rehearse three times; checklist at 10:00 | — |

### 13.3 Stuck run and dead-end runbook (for `docs/demo.md`)

```sh
# A CREAO run in flight for more than about 2 minutes:
spacetime sql -s maincloud forge "SELECT id, task_id, status, started_at FROM run WHERE provider = 'creao' AND (status = 'pending' OR status = 'running' OR status = 'queued')"
# Re-fetch it with FORGE's key (founder identity):
spacetime call -s maincloud forge creao_poll <runId>
# A paid order that ended without a deliverable: refund it from the dashboard (Refund button), or
spacetime call -s maincloud forge refund_order <orderId> '"<reason>"'
```

---

## 14. Regression tests and the 04:30 freeze checklist

| Area | Command or check |
|---|---|
| Whole repo | `pnpm run build && pnpm run typecheck && pnpm test` |
| Module | `pnpm -C module run build`; targeted files `node --test module/test/unit.test.mjs module/test/refunds.test.mjs`; integration against `pnpm -C module run publish:local` (the `test:api` glob mixes local and Maincloud tests, so run files deliberately) |
| Fetch agents | `cd fetch-agents && uv run pytest -q` (existing suites: payments, challenge, status, demo pay, params, gate, buyer, FET, intent, stdb; new: cards) |
| Web | `pnpm -C web run typecheck && pnpm -C web run build`; `agent-browser` checks with screenshots for P1-2, P1-3 and P1-4 |
| Live, after the last publish | One real order end to end from ASI:One: card → pay → status → delivered card; both devices update; record the order id and timings from `event` |
| Money | `books` for the test order and `customer:199` match expectations; `refund` rows as expected |

Freeze go/no-go at 04:30: all of the above pass, no stuck runs, no pending approvals the founder doesn't intend, `LIVE` badge honest, public URL loads, repo public and pushed.

---

## 15. Doc corrections

| File and line | Now says | Fix |
|---|---|---|
| `README.md:65` | "and rework continues the same thread" | Remove. Each run starts a new CREAO thread: `dispatch` inserts runs with an empty `threadId` and never sends one (`module/src/index.ts:2366-2381`) |
| `README.md:95` | "the shared test was corrected…" (passive) | Say who: "the founder corrected the shared test (commit `c6ac400`); attempt 2 resubmitted the same extractor, and the Auditor accepted it" |
| `README.md:117` | Reducer list without `refund_order` | Add `refund_order` (and `set_run_share_url` if P1-4 ships) |
| `README.md:166` | TODO to confirm the Best Actor entry | Remove; the Apify track is Best Use |
| `README.md:248` | "Interactive chat cards" under Not built | Remove once P1-1 ships |
| `README.md:252` | "Time Machine scrubbing and the replay bar" under Not built | The per-order replay bar is built (`web/src/ReplayBar.tsx`, `web/src/App.tsx:47`). Keep only "company-wide Time Machine" if that is what remains |
| `docs/devpost.md:38` | Ladder described with the Browser API | Add "(the Browser API rung is coded; no live fetch has used it yet)" |
| `docs/devpost.md:67` | "What's next" TODO | Fill from §9 P3 and mirror it in `docs/after-hackathon.md` (`AGENTS.md` §2 rule 12) |
| `docs/devpost.md:82` | Apify Best Actor row | Replace with Apify Best Use |
| `docs/devpost.md:90-100` | Unchecked checklist | Update as the P0 items land |
| `docs/demo.md:26` | Dashboard at port 5180 and a tailnet IP | Vite serves 5173 (`web/vite.config.ts:4`); add the public URL from P1-3 |
| `docs/demo.md:31-32`, `docs/compile-proof.md:26` | Links to gitignored PNGs | Commit curated PNGs (P1-5) or link the Devpost gallery |
| `AGENTS.md` §4, §5, §7, §8, §9, §10 | droid-runner claims enhancement and warranty; rework passes the existing `threadId`; replay bar out of scope; demo replays a `gpu-listings` compile; canary gates merges | Founder decides. These are build-contract text, not judge-facing; do not change code to match stale text. Code facts: `runner.ts:28` claims `ship` and `compile`; dispatch sends no `threadId`; the replay bar exists; the real compile is `open-roles` ticket #6; the canary is manual |

---

## 16. Adversarial judge questions (honest answers)

| Question | Answer | Evidence |
|---|---|---|
| "Is this live or a recording?" | The order's rows are timestamped as they arrive; the header badge says `LIVE` only when connected and not replaying; recorded work carries `RECORDED` | P1-2; `event` rows |
| "Remove CREAO. What breaks?" | Nothing gets admitted, priced, invested in or audited; orders stop at `paid`. Only `dispatch` starts runs, and every decision is a seat-gated reducer | `module/src/index.ts:2338`, `:963`, `:995` |
| "Show me a CREAO run." | The README decision table (P0-3), plus the live COO run on stage (19–27 s) | §2 |
| "Did Droid fix its own bug?" | No. Our harness was wrong; I fixed it (`c6ac400`). Droid's resumed session kept its code, the Auditor accepted it, and I approved the ship | `README.md:95`, git |
| "Has Droid ever been denied in a real compile?" | Not yet. Denials happened on simulated `cmp-test` tickets (approvals #4 and #8); ticket #6 recorded none | `README.md:105` |
| "What if a webhook never arrives?" | Today the founder re-fetches with `creao_poll`. In 30 real dispatches, 29 webhooks landed and 1 orphaned dispatch recovered itself | §2; `:1394-1398`, `:2347-2355` |
| "What if an agent ends without deciding?" | The task fails and the founder refunds the order with `refund_order`; it has never happened | §2; `:1384-1389` |
| "Show me a failure." | Order #199: Research cited robots.txt and the terms, the COO created a new API, the Auditor rejected the result for a missing field, and the customer was refunded (after P0-1) | `README.md:50` |
| "Are your accuracy numbers real?" | 296 of 302 values verified on an independent re-fetch at Gate 0 (Oct 24), and 21/21 on live orders; Gate 0 truncated open-roles pages at 60K characters | `README.md:195-196` |
| "How do you measure cost per call?" | Apify run cost re-fetched after the run; Bright Data as request count × list price, not billed usage; one measured pair showed 26.6% lower cost at Tier 1 | `README.md:197` |
| "Why SpacetimeDB and not Postgres plus a server?" | There is no server. Rules, schedules, outbound calls, webhooks and subscriptions live in one module, and every agent has its own identity | §10 |
| "What stops an agent from approving its own spend?" | `decide_approval` is founder-only; spend over the cap becomes an approval | `:1155`, `:2667-2690` |
| "Why does everything cost $1?" | A flat TEST MODE quote; COO pricing isn't built, and `markup_pct` isn't wired yet | `agent.py:38`; W11 |
| "Can I break it by typing 'ok'?" | After P1-1, no: payment needs the Pay button or the word "pay" on a fresh quote | P1-1 |
| "Do you use the Browser API?" | It's coded but has never run live; the ladder used Web Unlocker plus a country retry | `README.md:176, 184` |
| "Who are your customers?" | 9 real orders from ASI:One users and an independent buyer agent that paid FET twice; the rest is labeled test traffic, hidden by default | `README.md:204` |
| "What does the founder actually do?" | Approvals only: read the `agent decisions : founder approvals` pair off the header | header |

---

## 17. Not worth the time tonight

- Rebuilding realtime sync, presence or cursors (sync works; presence is out of scope in `AGENTS.md` §2).
- A company-wide Time Machine.
- Coinbase x402.
- The CFO's scheduled daily report.
- A Books tab.
- New forge-floor art or animations.
- Wiring the Browser API rung at 3 AM.
- Schema changes such as an actor-identity column on `event`.
- Refactoring to scoped subscriptions.
- New catalog APIs.
- COO pricing and markup.
- Enhancement, coverage and format ticket labels.
- Making the canary run in CI or go through CREAO.
- Retrofitting CREAO rework onto the same thread.

---

## 18. What could not be verified

- Whether CREAO judges want a share link per agent or one per project (this plan provides one per seat).
- Fetch prize amounts (hackpack and prizes page disagree).
- Entrant counts per track at Cal Hacks 13.0.
- Whether sponsor judges visit tables or only see the 2-minute pitch.
- Whether CREAO's API returns share URLs (U2).
- Whether FORGE appears in ASI:One discovery for generic queries (U1).
- The exact envelope of a tapped card option in ASI:One (U7).
- Credit balances on judging morning (U3).
