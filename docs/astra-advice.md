# Astra advice: make FORGE's company decisions visible

Written October 24, 2026. Consolidates the founder's dashboard discussion for agents implementing it later.

**Status:** design advice, not an implemented feature or a replacement for [AGENTS.md](../AGENTS.md). The founder requested this document only. Read the current code and repository contract again before implementation. Observations below came from source and saved traces, not a live browser or deployed-state review.

## The story the dashboard must tell

FORGE is a one-person company whose AI employees sell, verify, and improve public-data APIs. Judges should understand what a customer bought, how the company proved the result, and why it invested in improving the product.

The strongest CREAO story is employee judgment with visible consequences. Four agent badges are insufficient. Show what each employee decided, the evidence behind that decision, and the work that followed.

A judge should be able to point at the screen and explain: “The CFO decided this investment was worthwhile, the engineer built it, and the Auditor held it accountable.”

Pitch opening:

> I'm the only human in this company. My employees decide which orders to accept, investigate sources, decide when engineering is worth paying for, and audit the work before delivery.

Follow that claim with one actual job and its evidence. Use a real rejection, counteroffer, deferred investment, or audit rejection when available. An explained refusal demonstrates judgment. Never manufacture one for the demo.

## Preserve the office and improve the surrounding information

The founder likes the improved left side. Preserve it as the company overview. Focus the redesign on the right panel, employee details, and connections between employees.

Use three levels of detail:

| Level | Content | Purpose |
|---|---|---|
| At a glance | Customer request, current owner, current outcome, founder action needed | Understand the business immediately |
| One click | Decision, rationale, evidence, next employee | Understand the autonomous work |
| Deeper inspection | CREAO run, source quotes, tool calls, diff, tests | Verify that the work is real |

Do not put every implementation detail on screen at once. Keep technical evidence accessible without requiring judges to interpret it to follow the story.

## Replace the event soup with a readable company feed

At review time, `web/src/Events.tsx` shows the latest 150 global events as raw event names and short `key=value` payload fragments. This mixes unrelated work and makes the reader reconstruct the narrative.

The replacement should:

- Default to the selected order, with an explicit company-wide view.
- Identify the employee or service, action, outcome, reason, and timestamp.
- Link each entry to the relevant decision or evidence.
- Group repeated fetch attempts and tool calls beneath the business action they support.
- Distinguish work in progress, waiting for another employee, waiting for the founder, failures, and completed work.
- Preserve raw events as expandable technical details.
- Keep failures visible and retain access to every underlying event.
- Label scripted test traffic and exclude it from the default judge view where its provenance is known.

Use deterministic summaries of recorded state. Do not invent agent reasoning, infer success from activity, or generate flattering narrative unsupported by the stored output.

Illustrative copy below is a layout proposal, not recorded project evidence:

> **COO accepted the order**  
> The existing GPU API covers this request. No new engineering needed.  
> View decision · CREAO run

> **Bright Data found a changed value**  
> The fresh page differs from the saved quote. Open the comparison.

> **CFO recommended a dedicated extractor**  
> Repeat demand justifies an engineering investment. View the measured costs and rationale.

Unknown event types still need a readable fallback and their raw details. They must not disappear silently.

## Put founder decisions above the feed

The right panel should answer these questions in order:

1. Does anything need my approval?
2. What is happening to this order?
3. What evidence supports the result?

Approval cards should show the concrete proposal, requester, reason, cost when relevant, and consequence. Prefer “Approve publishing gpu-listings v1” over a reducer name and JSON.

Approval actions must use the existing founder identity and authorized reducers. Explanations and chat messages never authorize spending or publishing. Display pending, approved, rejected, and failed action states accurately. Money remains labeled **TEST MODE**.

## Make employee decisions and handoffs inspectable

Each CREAO employee's detail view should lead with:

- The task and relevant order or API.
- Its recorded decision and written rationale.
- The evidence it used.
- The resulting next step and responsible employee.
- The actual CREAO run link when available.

Example card layout, with illustrative content:

> **COO · Accepted this order**  
> **Decision:** Use the existing GPU API.  
> **Reason:** Its sources and fields cover the customer's request.  
> **Next:** Run the extractor.  
> View CREAO run

The CFO detail should expose the actual investment argument: buyer count, measured cost per call, available budget, proposed investment, and rationale. Clearly distinguish projected savings from savings measured after publication.

Connections between employees should also reveal their handoffs. CFO → Droid should explain the approved budget, API specification, saved pages, and expected results. Droid → Auditor should reveal the submitted changes and checks. Show only artifacts actually associated with that job.

## Show two distinct journeys

### Fulfill this order

Request → commercial decision → extraction → independent verification → audit → delivery.

This explains how a customer gets data without needing a new engineering project for every purchase.

### Improve this product

Demand or quality trigger → CFO review → budget reservation → engineering → tests and audit → founder approval → published version.

This explains why engineering happens and how it benefits future buyers. Product-wide engineering must be linked by API and ticket, not assumed to belong to whichever order is selected.

## Give Droid Engineer a real workspace

Rename **Droid anvil** to **Droid Engineer**. Replace vague idle text such as “Droid is sleeping” with “No engineering work queued” or the actual blocking reason.

At review time:

- `web/src/App.tsx` exposes Office and APIs tabs, with no dedicated Engineering tab.
- `web/src/Drawer.tsx` renders engineering tasks and tickets in the Droid drawer.
- The drawer does not present the plan, code changes, tool activity, or test results.
- `workers/droid-runner/src/runner.ts` and `compiler.ts` already record richer engineering events.

A dedicated engineering view should show:

| Item | What it answers |
|---|---|
| API and job | What is Droid improving? |
| Trigger | Why did this work become necessary? |
| CFO decision and budget | Why is the investment justified, and what is authorized? |
| Current step and latest recorded progress | What is happening now? |
| Tool activity with outcomes and reasons | What did Droid attempt, and what was allowed? |
| Code diff | What changed? |
| Fixture, contract, and live tests | What was checked, and what passed, failed, or was skipped? |
| Auditor verdict and rework | Was the work accepted, and why? |
| Publish approval and resulting version | What did the founder approve, and what actually shipped? |

Preserve session and attempt relationships. Do not present separate sessions as one continuous repair conversation. A passed test is not an Auditor acceptance, and an approved publication is not proof that deployment succeeded.

### Explain “compile” in plain language

Tier 0 uses a generic Actor and an LLM to extract values from each page. Droid builds a dedicated extractor that reads the site's structure directly. Future runs use that code, removing the extraction LLM work. Bright Data fetching and verification remain necessary.

Use **Build a dedicated extractor** as the primary UI phrase. Keep **Tier 0 → Tier 1** and **compile** available as technical details. Keep the same API schema and show the actual published version.

Do not claim that every sale automatically lowers cost. Demand can justify an investment; measured cost changes follow an actual upgrade and subsequent runs.

### Explain what triggers engineering

The inspected code defaults were:

| Trigger | Default and meaning |
|---|---|
| Repeat demand | Two distinct buyers trigger CFO review |
| Verification problems | Below 80% verified across a full five-run window |
| Upheld Tier 0 extraction challenge | The extractor misread the saved evidence |

Read live stored configuration when displaying thresholds. Defaults in source are not proof of deployed settings.

The sequence is trigger → ticket → CFO investment decision → budget reservation → queued task → running worker claims task → Droid works. A trigger does not mean Droid has started. The CFO may defer, the budget may block work, or no worker may be running.

The verification-rate trigger describes a sustained proportion of verified values. It does not start engineering after every failed value. Inspect current deduplication and retry rules before describing when a deferred or failed job can be reopened.

### Use the existing repair evidence honestly

A saved GPU compile trace reviewed during this discussion contains failed fixture checks, extractor edits, and a final record with passing fixture, contract, and live checks. That is useful evidence of engineering repair.

It does not alone prove an Auditor rejected and then accepted the build, a founder approved publication, or buyers received the version. Verify those separately. Show saved traces as **REPLAY**, with their recorded timestamps.

### Fix needless permission friction without weakening boundaries

The inspected general command policy allows shell `ls`. The compile policy automatically allows specific test commands, so plain shell `ls` falls into **needs approval**. Some command forms are denied outright. A dedicated `LS` tool was also available in saved compile sessions.

Investigate the exact command and recorded reason behind the founder's observed denial before changing policy. **Needs approval**, **denied**, **execution failed**, and **approved** are distinct states.

Safe directory inspection inside the permitted workspace should not require a founder interruption merely to create a demo moment. Any policy change must preserve path, secret, network, and write boundaries and have appropriate tests. Do not broadly allow arbitrary shell expressions.

Never manufacture a denied action for Factory judging. Explain real enforcement when it occurs, such as protected tests, out-of-scope writes, or publishing without authorization.

## Make value verification visible

Clicking a delivered value should reveal the saved quote, source URL, observation timestamp, independent verification result, and associated evidence.

For challenges, show the saved evidence and fresh observation together. Explain the difference between an extractor misreading the saved page and a source changing later. A changed page alone is not proof the extractor was wrong.

Show the actual Bright Data attempts, including method, country, timing, status, and reason for fallback when recorded. Do not imply every request traversed every fallback step.

Separate the fast recheck from the later Auditor ruling. Never claim the full challenge is resolved in seconds when only the recheck has completed.

## Keep founder messaging secondary

No founder messaging interface was found in the inspected dashboard. The recommended eventual design is task-specific feedback attached to a proposal or job, with a real agent response and run link.

Example: “Explain the expected payback using the measured costs,” attached to a CFO proposal.

This is lower priority than decisions, evidence, and engineering visibility. It requires a real dispatch and response path. Do not ship a cosmetic chat box or imply a message reached an agent when it did not. Messages cannot substitute for explicit approvals.

Treat this as a future scope proposal under the repository's rules for new ideas. This advice document does not itself authorize building a new messaging subsystem.

## Give each sponsor a concrete proof moment

The founder's priority is CREAO's one-person company challenge, followed by strong demonstrations for Bright Data, Apify, SpacetimeDB, Fetch.ai, and Factory. These are presentation recommendations, not verified judging criteria or predictions of winning.

| Sponsor | Proof moment |
|---|---|
| CREAO | Inspect a consequential employee decision, its rationale, real run, and handoff. Show coordination and escalation to one founder. |
| Bright Data | Inspect a delivered value's saved quote and independent fetch, then show an actual challenge comparison. |
| Apify | Show a named API's Task or Actor, dataset, versions, and a real repeat purchase or rerun. |
| SpacetimeDB | Change a budget on one device and show affected queued work becoming ineligible on both devices. Explain the authoritative rules and guarded task claims. |
| Fetch.ai | Keep ASI:One visible beside the dashboard so the customer request visibly becomes company work. Show an independent buyer only if the real purchase path is available. |
| Factory | Follow the business reason for engineering through actual code changes, failed checks, repair, audit, and controlled publication. |

SpacetimeDB's story is shared company rules enforced while multiple agents act concurrently. Synchronized screens make that visible; budget enforcement and exclusive claims provide the substance. Do not add unrelated multiplayer features to compete on animation alone.

## Build in this order

1. Human-readable activity and employee decision cards, scoped to the selected job.
2. Founder approval presentation and clear waiting states.
3. Inspectable handoffs and saved-versus-fresh evidence comparisons.
4. Droid Engineer workspace with trigger, progress, diff, tests, audit, and publication state.
5. Task-specific founder feedback only after the core story works and its scope is approved.

Prioritize exposing existing records over adding new infrastructure. Avoid unrelated animations, a general chat system, invented metrics, or duplicate state stores.

## Implementation starting points

Recheck these files because concurrent work was present during the review:

| Area | Files |
|---|---|
| Dashboard layout and statistics | `web/src/App.tsx`, `web/src/styles.css` |
| Global event rendering | `web/src/Events.tsx`, `web/src/format.ts` |
| Order selection and data association | `web/src/Office.tsx` |
| Office states, labels, and connections | `web/src/scene.ts`, `web/src/Floor.tsx`, `web/src/Pipeline.tsx` |
| Employee drawers and evidence tables | `web/src/Drawer.tsx`, `web/src/Detail.tsx` |
| Compile triggers and state transitions | `module/src/compile.ts`, `module/src/index.ts` |
| Engineering execution and evidence | `workers/droid-runner/src/runner.ts`, `compiler.ts`, `events.ts`, `results.ts` |
| Command boundaries | `workers/droid-runner/src/policy.ts`, `runTool.ts`, `lockdown.ts` |

Before editing, map the existing IDs that connect orders, APIs, tickets, tasks, runs, approvals, and events. Current order-scoped queries must not hide API-wide engineering or attach unrelated company work to an order.

## Open questions to resolve before claiming completeness

- **“pytest request”:** The exact phrase was not found in the inspected dashboard code or traces. `pytest` is a Python test runner, but the observed item might be test traffic. Identify its actual record and origin before labeling or filtering it.
- **“Things you should know,” first point:** The referenced text was not located. The prior explanation of the verification-rate trigger was conditional, not a confirmed identification of that text.
- **Observed `ls` denial:** Find the actual tool call and policy outcome. Do not assume it was staged or that all directory listings are blocked.
- **Runtime status:** Recheck deployed thresholds, available run links, worker availability, and completed compile/publication paths. Source support is not evidence of live completion.
- **Cost savings:** Distinguish removed LLM work, projected savings, and comparable measured before-and-after costs.

## Acceptance checks for later implementation

- A new viewer can identify the customer request, current owner, outcome, and required founder action without reading JSON.
- Each rendered decision is traceable to its stored rationale and supporting run or evidence.
- Switching orders updates the feed and details without mixing unrelated records.
- Product-wide engineering remains accessible and correctly linked to its API.
- Unknown, missing, pending, rejected, failed, and skipped states remain honest and understandable.
- Droid's trigger, CFO review, queued state, active work, tests, audit, approval, and publication remain distinct.
- Approval controls use the founder-authorized reducer path and handle errors visibly.
- Raw evidence remains accessible. Repeated events can be expanded without losing information.
- Test traffic, **TEST MODE**, **REPLAY**, and **SIMULATED** labels follow the repository contract.
- Controls work with keyboard navigation, and meaning does not depend on color alone.
- Verify frontend changes in a real browser with the `agent-browser` skill, including interactions and screenshots. Follow the repository's backend live-API checks for any backend changes.
- Check the layout on laptop and phone. Demonstrate synchronization using real subscribed state.

The intended result is a dashboard that lets judges follow one company decision into its evidence and consequences, while retaining the technical depth needed to prove it happened.
