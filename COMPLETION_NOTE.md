# Frontdesk — Completion Note

**Assessment:** iNav Technologies — Full Stack Developer (November 2026)

## Implemented

- React/TypeScript responsive agent dashboard with login, filtering, ticket creation/detail, claim, message composer, SLA and activity panels.
- Express/PostgreSQL ticket endpoints, secure customer token, agent login, atomic ownership claim and append-only auditing.
- Working-hours SLA calculation including IST schedule, holidays, pause/resume, auto-closure and reopen policy.
- README with local setup, requirements interpretation, commands, API routes and deployment Blueprint.
- Automated unit tests for business-time calculations.

## Outstanding / time-boxed limitations

- Email notification/delivery integration was not included; agent-to-customer replies are stored and readable through the public-ticket API.
- A standalone browser-based customer portal is not included. The agent UI and public customer APIs are implemented.
- Holidays are manual configuration, not integrated with a festival calendar service.
- Expiration processing uses a timer plus lazy reconciliation, not an always-on dedicated worker; on a sleeping free-tier service, closure is reflected on the next request.
- Database integration tests, complete production build, live deployment verification and new remote GitHub repository publication still require execution/verification in an environment with network access, a running PostgreSQL database and the account owner's authorization.

**Reason for limitations:** The assessment favors correct business-rule interpretation, a reliable core workflow, and transparent prioritization within an approximately eight-hour development window.

**Before submitting:** Replace the outstanding deployment wording with an accurate status after verifying the live URL, GitHub repo, and working database; do not claim untested features as verified.
