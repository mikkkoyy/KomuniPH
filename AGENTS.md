# KomuniPH — Codex Development Instructions

## Core Development Rules

1. Understand the existing project architecture before making changes.
2. Do not rewrite, delete, or replace unrelated code.
3. Preserve existing functionality unless the task explicitly requires changing it.
4. Work feature-by-feature.
5. Keep changes focused and maintainable.
6. Follow the project's existing naming, folder, coding, and architectural conventions.
7. Do not introduce new dependencies unless they are necessary and approved.
8. Never expose secrets, API keys, passwords, tokens, or private configuration.
9. Never make destructive database or filesystem changes without explicit approval.
10. Before making major architectural changes, explain the proposed change first.

## Implementation Workflow

For every requested feature:

1. Inspect the relevant existing files.
2. Explain the implementation approach briefly.
3. Identify affected backend, frontend, database, API, and configuration components.
4. Implement the feature.
5. Run the appropriate build, lint, and test commands.
6. Fix errors caused by the implementation.
7. Verify that existing functionality still works.
8. Report:
   - files changed
   - what was implemented
   - tests/builds performed
   - remaining issues

## Safety

- Do not delete project files unless explicitly requested.
- Do not reset Git history.
- Do not run destructive Git commands without permission.
- Do not overwrite large portions of the project simply to simplify implementation.
- Do not modify unrelated features.
- Ask before changing the project's fundamental architecture.

## Coding Philosophy

Prefer:

- simple solutions
- modular architecture
- reusable components
- clear separation of concerns
- secure defaults
- maintainable code
- production-ready implementations

Avoid:

- unnecessary complexity
- duplicated code
- temporary hacks presented as final solutions
- hardcoded secrets
- unnecessary dependencies

## Testing

A feature is not considered complete until:

1. The code compiles/builds successfully.
2. Relevant tests pass.
3. Runtime errors are investigated.
4. The implementation has been checked against the requested behavior.

If testing cannot be performed, clearly state why.

## Communication

Before large changes, explain the plan.

After implementation, provide a concise summary of:

- What changed
- Why it changed
- Files affected
- Tests performed
- Any remaining problems

When uncertain about an existing behavior, inspect the code rather than guessing.