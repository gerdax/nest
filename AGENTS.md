# Project constraints

- Preserve original documents, prototypes and source assets. Create new implementation files separately unless the user explicitly requests changes to the originals.
- Keep development and verification commands accurate. Report unverified editor, device, browser or legacy-format checks; do not imply that deterministic tests cover them.
- This project uses native JavaScript modules. No package installation or application build is required for local development. Run `python3 serve.py` for local serving, `npm test` (equivalently `node --test tests/*.test.js`) for engine tests, and `python3 build_pages.py /tmp/nest-pages` for static-site staging. Check current scripts before relying on these commands. Run staging outside the original assets.

# Agent orchestration

GPT-6.2 Sol / high is the default lead. It owns the objective, ambiguity, risk, architecture, decomposition, file ownership, conflict resolution, integration and final acceptance.

| Role | Model / reasoning | Responsibility |
| --- | --- | --- |
| `explorer` | `gpt-6-luna` / low | Cheap, bounded, read-only exploration, reference lookup and mechanical investigation. |
| `simple_worker` | `gpt-6-luna` / low | Mechanical edits and small, clearly specified fixes with explicit file ownership and straightforward verification. Sol 6.2 inspects edits and verification before accepting them. |
| `worker` | `gpt-6.2-sol` / high | Normal implementation using supplied findings. |
| `reviewer` | `gpt-6.2-sol` / high | Consequential independent review or difficult isolated diagnosis. Reports findings without edits; fixes go to an assigned worker. |
| `expert` | `gpt-6-astra` / medium | Proactive advice for architecture, difficult diagnosis, cross-system problems, conflicting evidence, significant tradeoffs and consequential technical risks. Consult Astra early when its judgment can improve the outcome; prior Sol failures are not required. Read-only advice; Sol 6.2 retains integration and final acceptance. |

Use the worker role for implementation with Sol 6.2 / high. For Astra / high, explicitly spawn `gpt-6-astra` / `high` with the expert's read-only brief. If the runtime's named `expert` role is pinned to a different model, explicitly spawn `gpt-6-astra` / `medium` with that same brief. When the runtime lacks named-role spawning, include the role instructions in the brief and specify its model and reasoning explicitly.

Choose the model for the task automatically; the user need not manage routing. Use Luna/low for mechanical work and bounded exploration, Sol 6.2/high for normal implementation and integration, and Astra/medium readily for architectural choices, difficult diagnosis, cross-system reasoning, conflicting evidence and consequential design or review questions. Consult Astra proactively whenever its judgment is likely to improve correctness or reduce rework; do not require a Luna or Sol attempt, repeated failures or exceptional difficulty first. Prefer a focused Astra consultation over repeated uncertain Sol attempts. Use Astra/high when the question clearly needs deeper analysis or Astra/medium leaves material uncertainty. Routine, unambiguous edits can stay with Sol or Luna. Return control to Sol 6.2 for implementation, integration and acceptance after the consultation.

Delegate only when savings, bounded isolation, useful parallelism or independent verification outweigh coordination. Tiny actions may stay with the lead. Give each agent an objective, relevant context, constraints, owned files (or an explicitly read-only scope), expected output and verification criteria. Use narrow briefs and concise evidence; avoid full-history forks, duplicate investigations and repeated loading of large files. Parallelize independent work with stable interfaces and avoid overlapping edits.

The project caps concurrent subagents at two, excluding the lead. Subagents must not delegate further without explicit lead authorization; authorized nested agents still count toward the same project cap.

If Luna is unavailable, use Sol 6.2. If Astra is unavailable, report the limitation and continue with Sol 6.2 where feasible; surface any unresolved issue that prevents reliable completion. Respect runtime model availability and higher-priority instructions. Saved project model settings are defaults for subsequent sessions, not a claim that the current chat's model has changed. Project config loading and explicit session overrides may affect the effective defaults.

# Workflow and acceptance

Understand objective -> inspect relevant context -> identify ambiguity/risk -> decompose if useful -> route bounded work -> parallelize where beneficial -> implement -> run relevant deterministic checks -> independently review consequential changes -> integrate -> Sol 6.2 lead accepts.

Done means requested behavior and important edge cases are covered, relevant checks pass, no known regressions remain, and the lead has inspected the integrated result. Scale checks and review to risk; trivial changes need no review ceremony or irrelevant full suite. Surface product decisions, material risks and meaningful ambiguity; handle routine routing internally. Report verification limitations clearly. Use Astra review proactively for consequential architectural or cross-system changes when an independent assessment is useful. Sol 6.2 retains final acceptance; routine changes need no Astra review.
