# Project constraints

- Preserve original documents, prototypes and source assets. Create new implementation files separately unless the user explicitly requests changes to the originals.
- Keep development and verification commands accurate. Report unverified editor, device, browser or legacy-format checks; do not imply that deterministic tests cover them.
- This project uses native JavaScript modules. No package installation or application build is required for local development. Run `python3 serve.py` for local serving, `npm test` (equivalently `node --test tests/*.test.js`) for engine tests, and `python3 build_pages.py /tmp/nest-pages` for static-site staging. Check current scripts before relying on these commands. Run staging outside the original assets.

# Agent orchestration

GPT-6.1 Sol / medium is the default lead. It owns the objective, ambiguity, risk, architecture, decomposition, file ownership, conflict resolution, integration and final acceptance.

| Role | Model / reasoning | Responsibility |
| --- | --- | --- |
| `explorer` | `gpt-6-luna` / low | Cheap, bounded, read-only exploration, reference lookup and mechanical investigation. |
| `simple_worker` | `gpt-6-luna` / low | Mechanical edits and small, clearly specified fixes with explicit file ownership and straightforward verification. Sol 6.1 inspects edits and verification before accepting them. |
| `worker` | `gpt-6.1-sol` / medium | Normal implementation using supplied findings. |
| `reviewer` | `gpt-6.1-sol` / high | Consequential independent review or difficult isolated diagnosis. Reports findings without edits; fixes go to an assigned worker. |
| `expert` | `gpt-6-astra` / medium | Exceptionally demanding architecture or diagnosis: unresolved architectural choices, subtle cross-system problems, conflicting evidence or repeated failure of sensible Sol approaches. Read-only advice; Sol 6.1 retains integration and final acceptance. |

For difficult implementation needing Sol 6.1 / high, explicitly spawn `gpt-6.1-sol` / `high` without the fixed medium worker role. For Astra / high, explicitly spawn `gpt-6-astra` / `high` without the fixed medium expert role and retain read-only advice. Custom role files can override spawn settings; never rely on a conflicting override. When the runtime lacks named-role spawning, include the role instructions in the brief and specify its model and reasoning explicitly.

Choose the cheapest reliable model automatically; the user need not manage routing. The escalation ladder is Luna/low -> Sol 6.1/medium -> Sol 6.1/high -> Astra/medium -> Astra/high. Skip lower levels when difficulty is already clear. Use Astra/high only when Astra/medium remains insufficient. Retry failed cheap work once only with materially improved context or strategy; otherwise escalate the blocked portion. Task size alone does not justify Astra or higher reasoning. Return control to Sol 6.1 after resolving the difficult portion.

Delegate only when savings, bounded isolation, useful parallelism or independent verification outweigh coordination. Tiny actions may stay with the lead. Give each agent an objective, relevant context, constraints, owned files (or an explicitly read-only scope), expected output and verification criteria. Use narrow briefs and concise evidence; avoid full-history forks, duplicate investigations and repeated loading of large files. Parallelize independent work with stable interfaces and avoid overlapping edits.

The project caps concurrent subagents at two, excluding the lead. Subagents must not delegate further without explicit lead authorization; authorized nested agents still count toward the same project cap.

If Luna is unavailable, use Sol 6.1. If Astra is unavailable, report the limitation and continue with Sol 6.1 where feasible; surface any unresolved issue that prevents reliable completion. Respect runtime model availability and higher-priority instructions. Saved project model settings are defaults for subsequent sessions, not a claim that the current chat's model has changed. Project config loading and explicit session overrides may affect the effective defaults.

# Workflow and acceptance

Understand objective -> inspect relevant context -> identify ambiguity/risk -> decompose if useful -> route bounded work -> parallelize where beneficial -> implement -> run relevant deterministic checks -> independently review consequential changes -> integrate -> Sol 6.1 lead accepts.

Done means requested behavior and important edge cases are covered, relevant checks pass, no known regressions remain, and the lead has inspected the integrated result. Scale checks and review to risk; trivial changes need no review ceremony or irrelevant full suite. Surface product decisions, material risks and meaningful ambiguity; handle routine routing internally. Report verification limitations clearly. Astra review or acceptance is not mandatory.
