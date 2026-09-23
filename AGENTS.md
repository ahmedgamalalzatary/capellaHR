# Project Working Instructions

These instructions apply to the entire repository. Follow the user's explicit instructions and expand the requested scope only when necessary for a correct, complete result. System and developer instructions still take precedence.

## Core rules

- Understand the full scope of every task before answering or making changes.
- Follow the user's instructions and do not add unrequested work unless it is necessary for a correct, complete result. The user may forget a required step or give an incorrect direction; notify them clearly and correct or add what is needed when the right action is certain. If it is uncertain, stop and ask.
- Treat the user as an active collaborator who may change the workspace concurrently. Expect state mismatches; for example, a development server may already be running or a previously absent file may have just been created. Re-check the current state before acting, preserve the user's work, and adapt without overwriting or duplicating it.
- While reading or navigating the codebase, immediately notify the user about any likely bug, mismatch, unintended behavior, problem, incorrect implementation, or gap you notice, even when it is outside the immediate change. Do not silently ignore it.
- Do not over-engineer or under-engineer the requested work.
- Always provide the best complete and working solution, without compromises.
- Be concise/precise.
- Prefer compact Markdown text diagrams in chat when they make flows, architecture, or decisions easier to understand.
- Never guess, speculate, or improvise. If confidence is not 100%, stop and ask before answering or acting.
- Never create a Git commit unless the user explicitly requests it. Each commit authorization is one-time, applies only to the changes explicitly named in that request, and does not authorize any later commit.
- Never ever run/spawn sub-agents, background agents, or Task-tool agents without explicit user permission. Each permission is one-time for the named task only and does not authorize later use.
- Some commands can race or cause failures for others (dev server, build, tests, lint, parallel runners). Run commands sequentially when they may conflict, and be aware of parallel-execution risks. Prefer the smallest safe sequential steps over parallel runs.
- When the user asks to fix a bug, or identifies a specific bug and asks for help with it, that identification is sufficient authorization to implement the fix. Do not pause to ask for approval before changing the code. Choose the best production-ready, minimal solution: neither over-engineered nor under-engineered.
- When adding a feature or fixing a bug, inspect and update every related integration point so the change is complete and the same omission does not recur elsewhere.
- After starting a command or agent, do not manually trigger it, request its status, or use repeated timed waits to check whether it finished.
- A timed wait that expires must never be followed by another status check or timed wait. Treat any repeated check as prohibited polling.
- Prefer commands that return the smallest useful output for the task to reduce token usage. Filter or limit output when the full result is unnecessary, for example with `tail -40`, `head -40`, or a search for only the relevant task/status lines.
- Move quickly through red/green TDD phases and work in small, focused slices. Use TDD to catch wrong directions early rather than allowing the process itself to slow down delivery.
- When updating a specific area or file, read the complete related files when their unseen sections could materially affect the change.
- A task may be incomplete, unclear, or incorrectly explained. If anything material is confusing or uncertain, ask the user a simple, focused question instead of guessing; the user is available to clarify.
- Explain problems in plain human language rather than developer-focused language so the user can understand them without needing coding expertise.
- Ask questions with the simplest practical wording and tone so the user can answer precisely.
## small tasks
- For a small task, only confirm green in the touched area (targeted build/lint/typecheck/tests). Do not run the full suite/baseline — those are long-running commands.
## Mid-to-high complexity workflow
1. Establish a baseline for the requested area ( if u are updating/going to update something in this part, ensure that this specific part is green before u even start, green === lint, build, typecheck, test )
2. implement the requested changes in full 
3. First confirm specific green in the touched area (targeted build/lint/typecheck/tests). Do not run the full
4. if the complixity is high, touching mulitple areas/scopes run/ensure everything is green accorss everything ( the entire codebase is green )
5. If context is compacted, re-read every instruction or reference document read at the start of the task. Do not rely only on the compaction summary.
## VPS and out-of-scope environment commands

- When the task requires the user to run commands on a VPS or another environment outside the current scope, provide commands one at a time and move quickly.
- Give one check or action, then provide the next step while assuming the previous step succeeded unless the user reports otherwise.