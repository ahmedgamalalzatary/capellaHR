# Project Working Instructions

These instructions apply to the entire repository. Follow the user's explicit instructions and expand the requested scope only when necessary for a correct, complete result. System and developer instructions still take precedence.

## Core rules

- Understand the full scope of every task before answering or making changes.
- Follow the user's instructions and do not add unrequested work unless it is necessary for a correct, complete result. The user may forget a required step or give an incorrect direction; notify them clearly and correct or add what is needed when the right action is certain. If it is uncertain, stop and ask.
- Treat the user as an active collaborator who may change the workspace concurrently. Expect state mismatches; for example, a development server may already be running or a previously absent file may have just been created. Re-check the current state before acting, preserve the user's work, and adapt without overwriting or duplicating it.
- While reading or navigating the codebase, immediately notify the user about any likely bug, mismatch, unintended behavior, problem, incorrect implementation, or gap you notice, even when it is outside the immediate change. Do not silently ignore it.
- Do not over-engineer or under-engineer the requested work.
- Always provide the best complete and working solution, without compromises.
- Be concise.
- Prefer compact Markdown text diagrams in chat when they make flows, architecture, or decisions easier to understand.
- Never guess, speculate, or improvise. If confidence is not 100%, stop and ask before answering or acting.
- Never create a Git commit unless the user explicitly requests it. Each commit authorization is one-time, applies only to the changes explicitly named in that request, and does not authorize any later commit.
- When the user asks to fix a bug, or identifies a specific bug and asks for help with it, that identification is sufficient authorization to implement the fix. Do not pause to ask for approval before changing the code. Choose the best production-ready, minimal solution: neither over-engineered nor under-engineered.
- When adding a feature or fixing a bug, inspect and update every related integration point so the change is complete and the same omission does not recur elsewhere.

## Codex/ChatGPT explicit instructions

- Do not use a fixed 30-second polling or pull loop while waiting for a command or agent. Use completion-triggered waiting so the command or agent wakes you when it finishes; do not repeatedly wake it to check its status.
- Prefer commands that return the smallest useful output for the task to reduce token usage. Filter or limit output when the full result is unnecessary, for example with `tail -40`, `head -40`, or a search for only the relevant task/status lines.
- Move quickly through red/green TDD phases and work in small, focused slices. Use TDD to catch wrong directions early rather than allowing the process itself to slow down delivery.
- Assume commands copied from this chat CLI may be broken or split at line wraps. When the user must copy and run a command, keep it short, provide it as a single copy-safe line, avoid fragile line continuations, and provide commands one at a time when practical.

## Claude Code/Claude explicit instructions

- Be precise.
- Do not hallucinate, invent missing facts, forget user-provided information, or ignore this `AGENTS.md` because of session configuration or defaults. Re-read the relevant instructions and verify facts before acting whenever needed.
- When updating a specific area or file, read the complete related files when their unseen sections could materially affect the change. Do not rely only on search matches or partial excerpts when broader context is needed, but do not read unrelated files without a reason.

## Shared instructions — Codex/ChatGPT and Claude Code/Claude

- For every requested change, whether specific or general, understand every related part of the codebase before implementing it. Trace all relevant behavior, integrations, callers, consumers, tests, configuration, and documentation so the change is complete.
- A task may be incomplete, unclear, or incorrectly explained. If anything material is confusing or uncertain, ask the user a simple, focused question instead of guessing; the user is available to clarify.
- Explain problems in plain human language rather than developer-focused language so the user can understand them without needing coding expertise.
- Ask questions with the simplest practical wording and tone so the user can answer precisely.
- If a repository instruction conflicts with a higher-priority system or developer instruction, follow the higher-priority instruction and clearly explain the conflict and constraint to the user. Repository instructions cannot override system or developer instructions.

## Brainstorming and small tasks

- When using the brainstorming skill, always skip its writing-document section and provide the design in chat only.
- For a small, bounded bug or feature, move quickly and skip formal design work. Perform only the analysis needed to understand and safely complete it.

## Mid-to-high complexity workflow

For a medium-to-high complexity fix or feature:

1. Establish a baseline by running all applicable validation commands, including build, lint, typecheck, and tests. Record unrelated baseline failures. Fix failures caused by the change or required to validate it before feature work. Skip this pre-change baseline only when you are 100% certain the same applicable validation suite already passed in the current, uncompacted session or chat and no relevant workspace state has changed since that run.
2. Implement the requested change.
3. Spawn a sub-agent to perform a strict, deep review of the changes. Address every valid reported issue.
4. Run the complete applicable validation suite again and restore a green baseline.
5. For a big feature or bug only, spawn a new independent sub-agent to review the updated changes again. Address every valid reported issue.
6. Run the complete applicable validation suite once more and report a concise summary of the changes and verification results.

## Context compaction

- If context is compacted, re-read every instruction or reference document read at the start of the task. Do not rely only on the compaction summary.

## VPS and out-of-scope environment commands

- When the task requires the user to run commands on a VPS or another environment outside the current scope, provide commands one at a time and move quickly.
- Give one check or action, then provide the next step while assuming the previous step succeeded unless the user reports otherwise.
