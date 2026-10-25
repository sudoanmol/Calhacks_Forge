# Proposed docs cleanup

This is a proposal only. No existing docs have been deleted or moved.

The README now explains the product, agent rules, stack, integrations, setup, and recovery. Keep operational instructions and current contracts easy to find; remove duplicate planning and review history after preserving any unresolved work.

## Remove superseded planning and review files

| File | Proposed action | What to preserve first |
| --- | --- | --- |
| [astra-advice.md](astra-advice.md) | Delete the earlier dashboard advice | Check remaining suggestions against the binding dashboard spec; move future ideas to `after-hackathon.md` |
| [redesign-review.md](redesign-review.md) | Delete per-commit review notes | Preserve unresolved review items, if any, in the dashboard spec or future-work list |
| [final-hackathon-winning-audit.md](final-hackathon-winning-audit.md) | Delete the deadline-driven audit and implementation prompt | Reconcile outstanding work with the release handoff; retain useful operational steps in the runbook |
| [final-adversarial-audit.md](final-adversarial-audit.md) | Delete the historical release audit | Keep unresolved risks and regression requirements in `paid-failure-spec.md` or `after-hackathon.md` |
| [progress.md](progress.md) | Delete the completed batch and branch diary | Preserve unique deployment facts and unresolved constraints in the runbook or CREAO deployment notes |

These files contain links to one another and to historical records. Update incoming links in retained docs as part of the cleanup. An old audit's open item is not evidence that the issue still exists or that it has been fixed.

## Consolidate submission and operations material

| File | Proposed action | Reason |
| --- | --- | --- |
| [unified-final-audit-tasks.md](unified-final-audit-tasks.md) | Fold current release checks into the operations runbook, then delete | Avoid another copy of founder TODOs and release status |
| [demo.md](demo.md) | Rename to `operations.md`; retain setup, payment-mode behavior, deployment, recovery, and release checks | Remove the judge walkthrough and duplicate lists of historical runs while keeping useful operating instructions |
| [devpost.md](devpost.md) | Move to `archive/calhacks-2026/` | Preserve the submission text without presenting its checklist as current project work |
| [compile-proof.md](compile-proof.md) | Move to `archive/calhacks-2026/` | Preserve the first compile's provenance and caveats without keeping it among active guides |
| `proof/` | Keep JSON records at their current paths; remove redundant redesign and local-QA screenshots after reviewing retained links | Actor measurement scripts write here, and retained docs cite the records. Do not delete the directory wholesale |

Moving `devpost.md` or `compile-proof.md` also requires updating their relative links and all retained incoming links. Moving or removing screenshots requires checking references in Markdown, not just Git tracking; some images exist only locally.

## Keep current contracts and reusable instructions

- [dashboard-redesign-spec.md](dashboard-redesign-spec.md) remains binding through `AGENTS.md`.
- [paid-failure-spec.md](paid-failure-spec.md) documents money and recovery behavior and is referenced by the refund tests.
- [creao/](creao/) contains the saved-agent prompts, setup instructions, and deployment notes.
- [after-hackathon.md](after-hackathon.md) is the required home for future ideas.
- `reference/` contains the original product PDFs. It is currently ignored by Git; leave local copies intact.
- [images/dashboard.png](images/dashboard.png) is the new README screenshot.

## Apply the cleanup as one documentation change

After approval, reconcile unresolved items, consolidate the runbook, move the submission history, remove the superseded files, and repair retained links. Check that the README image and all local links resolve, that the actor scripts still have their output directory, and that the maintenance guide still points to the current dashboard spec.
