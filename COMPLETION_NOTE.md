# Frontdesk completion note

Frontdesk is deployed on Render. The agent workspace, ticket API, PostgreSQL persistence, business-hours SLA, and audit history are implemented. The assessment checks exercised atomic ticket claiming, customer-side isolation of private notes, immutable audit history, and the wait, auto-close, and reopen workflows.

## Scope and limitations

- Customer reply and reopen are available through the API. A standalone customer UI and email or SMS delivery were outside the assessment scope.
- Holidays are configured manually. Auto-close is reconciled on relevant requests and by the web process while it is running, so a sleeping instance handles pending closures when it wakes.
- The seeded agent accounts support the assessment workflow. Account administration and password rotation are not part of the application.
- The database applies an idempotent startup schema. A versioned migration runner was outside the initial scope.

The implementation prioritized the agent workflow and the three reported failure scenarios within the assessment time box.

[Live application](https://frontdesk-app-dzdl.onrender.com) · [Assessment verification run](https://github.com/abinavdev/Frontdesk/actions/runs/44953121564)
