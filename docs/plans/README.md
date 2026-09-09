# Plans

Plans are organized by delivery status:

- `pending/` — plans that are being drafted or are ready to be implemented.
- `active/` — optional workspace for a plan currently being implemented.
- `completed/` — plans whose work has been merged and verified.

Each plan represents exactly one pull request. Keep the plan focused on one cohesive change that can be reviewed, tested, and merged independently.

## Naming

Use a date-prefixed, descriptive filename:

```text
YYYY-MM-DD-short-descriptive-name.md
```

For example:

```text
pending/2026-09-09-split-machine-operational-signal-delivery.md
```

When implementation begins, the plan may move to `active/`. After the pull request is merged and verification is complete, move it to `completed/`.
