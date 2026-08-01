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
- Never guess, speculate, or improvise. If confidence is not 100%, stop and ask before answering or acting.
- When adding a feature or fixing a bug, inspect and update every related integration point so the change is complete and the same omission does not recur elsewhere.

## Brainstorming and small tasks

- When using the brainstorming skill, always skip its writing-document section and provide the design in chat only.
- For a small, bounded bug or feature, move quickly and skip formal design work. Perform only the analysis needed to understand and safely complete it.

## Mid-to-high complexity workflow

For a medium-to-high complexity fix or feature:

1. Establish a baseline by running all applicable validation commands, including build, lint, typecheck, and tests. Record unrelated baseline failures. Fix failures caused by the change or required to validate it before feature work.
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
