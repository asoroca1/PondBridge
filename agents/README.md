# Camp Agents

This directory stores tenant-specific AI agent definitions.

## Structure

Each camp gets its own folder:

- `context.yaml`: stable camp identifiers and environment guardrails.
- `SYSTEM_PROMPT.md`: full operating rules for service and data isolation.
- `openai.yaml`: display metadata and default prompt entry point.

## Required Rules For Every Camp Agent

- Operate only within the camp tenant scope unless explicitly asked otherwise.
- Gate on stable tenant identifiers (`tenantId` first, then slug).
- Apply server/data tenant isolation before UI changes.
- Validate target-camp behavior and one control-camp behavior.
- Include rollback steps in every implementation summary.

## Demo Environments

If a camp has an active demo environment, encode an explicit preserve-or-wipe rule in `context.yaml` and mirror it in `SYSTEM_PROMPT.md`.
