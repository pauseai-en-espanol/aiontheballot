# AI on the Ballot

A multi-tenant platform on which advocacy organisations publish, per country and per election, a transparent,
sourced comparison of political parties' positions on frontier-AI risk. The first tenant is Spain
("IA en las urnas"), run by PauseAI España. "AI on the Ballot" is a working name; it lives in config.

## Documentation

- [Product brief](docs/BRIEF.md): scope and constraints (source of truth)
- [Plan](docs/PLAN.md): milestones, cut list, open decisions
- [Architecture decisions](docs/adr/): hosting, tenancy and authorization, application stack
- [Specs](docs/spec/): data model, workflows, pages
- [Contributing](CONTRIBUTING.md): workflow, conventions, the new-table checklist

## Getting started

Requires Node 26 (see `.nvmrc`) and pnpm 12 (pinned in `package.json`).

```sh
pnpm install
pnpm lint
pnpm test
pnpm build:check
```

## Licence

- **Code:** [GNU AGPL-3.0-or-later](LICENSE). Anyone running a modified version of this platform as a service must
  publish their changes.
- **Our content** (ratings, summaries, methodology texts): [CC BY 4.0](LICENSE-CONTENT).
- **Party quotes** are third-party material, quoted for analysis and criticism. They are not ours to license.
- **Names and logos** of the platform, tenants and operator organisations are not covered by either licence.
