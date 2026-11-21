# Frontdesk

Frontdesk is a support workspace for managing customer tickets, tracking service commitments, and recording who did what. It was built for the iNav Technologies full-stack assessment, where nine agents needed to move from a shared spreadsheet and chat to an auditable queue.

[Live application](https://frontdesk-app-dzdl.onrender.com) · [Completion note](COMPLETION_NOTE.md)

## What it does

- Search the ticket queue and filter by ownership, waiting status, overdue status, or resolution.
- Claim unassigned tickets. When two agents claim the same ticket, PostgreSQL grants it to one agent.
- Send public replies, add internal notes, and view an append-only activity log with actors and timestamps.
- Calculate response and resolution deadlines using business hours, pause the clock while awaiting a customer, and reconcile overdue customer waits.
- Give customers token-based API access to their ticket, public replies, and eligible reopen actions.

## Architecture

The React UI calls the Express API under `/api`. Express serves the compiled frontend in production and uses PostgreSQL for agent accounts, tickets, messages, and audit events. Vite proxies API requests to Express during local development. The SLA calendar and session helpers run on the server.

| Layer | Technology |
| --- | --- |
| UI | React 19, TypeScript, Vite |
| API | Node.js 20+, Express 4 |
| Data | PostgreSQL 14+, node-postgres |
| Quality checks | TypeScript, Node test runner, GitHub Actions |
| Hosting | Render web service and managed PostgreSQL |

| Path | Purpose |
| --- | --- |
| `client/src/` | Agent sign-in, dashboard, ticket detail, and styles |
| `server/src/index.js` | HTTP routes, authorization, and ticket workflows |
| `server/src/db.js`, `server/src/schema.sql` | Database access, startup schema, and initial agents |
| `server/src/sla.js`, `server/src/security.js` | Business calendar and authentication helpers |
| `server/src/seed-demo.js` | Optional sample tickets for local development |
| `server/test/` | SLA, authentication, and database-backed integration tests |
| `render.yaml`, `.github/workflows/ci.yml` | Deployment and continuous integration |

## Run locally

1. Install Node.js 20+ and PostgreSQL 14+. Clone the repository and run `npm ci --include=dev`.
2. Create a local PostgreSQL database named `frontdesk`, for example with `createdb frontdesk` while connected as an authorized local database user.
3. Copy `.env.example` to `.env` and set the values below. Use `cp .env.example .env` in Bash or `Copy-Item .env.example .env` in PowerShell.
4. Start `npm run dev:server` and `npm run dev:client` in separate terminals. Open [http://localhost:5173](http://localhost:5173). Express listens on port 3001 by default. If you change that local port, update the Vite proxy target as well.

### Environment variables

| Variable | Local setup |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URI for your local database, such as `postgresql://USER:PASSWORD@localhost:5432/frontdesk` |
| `SESSION_SECRET` | Random session-signing secret of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| `SEED_AGENT_PASSWORD` | Set your own password before first startup. Production requires at least 12 characters. |
| `PORT` | HTTP port for Express. The template uses `3001`. |
| `NODE_ENV` | Use `development` locally and `production` for hosting. |
| `HOLIDAYS` | Optional comma-separated ISO dates (`YYYY-MM-DD`) in IST. An empty value excludes weekends only. |
| `TEST_DATABASE_URL` | Optional for local tests. Use a separate disposable PostgreSQL database. |
| `BASE_URL` | Optional target for `npm run seed:demo`. Defaults to the local Express URL. |

### Database initialization

On startup, the server applies the schema in `server/src/schema.sql` and inserts any missing seed agents. There is no separate migration runner. Review future schema changes as migrations before applying them to an existing database.

For a fresh local setup, sign in as `asha@arvo.example` or another seeded agent using the password you chose. Updating the seed variable after initialization does not rotate passwords on existing accounts. For sample tickets, run `npm run seed:demo` against your local service after it starts. Share hosted reviewer credentials privately.

## Roles and ticket workflow

| Access | Permissions |
| --- | --- |
| Agent | Sign in, view the shared queue and activity, create tickets, and claim available tickets. The assignee can change status and priority, send replies, add internal notes, and reopen eligible tickets. |
| Customer | Use the ticket-specific bearer token returned at creation to read that ticket and its public messages, reply while it is active, or reopen it within the allowed window. |
| Administration | The application has no separate admin account or admin UI. Deployment and database administration happen outside Frontdesk. |

Tickets start **Open**. Claiming moves a ticket to **In progress**. An agent can move it to **Waiting on customer**, which pauses the SLA. A customer reply resumes work. After five working days of silence, the service closes the ticket. A **Resolved** ticket can be reopened within five working days.

Business hours are Monday through Friday, 09:30–18:30 IST, excluding configured holidays. Priority changes recalculate the active SLA budget and are audited. A recorded first response keeps its original deadline.

| Priority | First response | Resolution |
| --- | --- | --- |
| High | 2 working hours | Close of the first active working day |
| Medium | Half a working day | 3 working days |
| Low | 1 working day | 5 working days |

Customer operations are available through the API. Send `Authorization: Bearer <customer-ticket-token>` to `GET /api/public/tickets/:id`, `POST /api/public/tickets/:id/reply`, or `POST /api/public/tickets/:id/reopen`. Create a ticket with `POST /api/public/tickets` and keep the returned token private. The customer response contains public messages only.

## Test and build

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | TypeScript without emitting files |
| `npm test` | SLA and security tests, plus HTTP/PostgreSQL integration when `TEST_DATABASE_URL` is set |
| `npm run build` | Vite production bundle in `dist/` |
| `npm run check` | Type check, tests, and build |
| `npm start` | Serve the built frontend and API from Express |

Create a disposable database such as `frontdesk_test` before setting `TEST_DATABASE_URL`. The integration test will initialize it and create synthetic tickets. CI provides its own PostgreSQL service and runs all checks without production credentials.

## Deployment

The existing [Render service](https://frontdesk-app-dzdl.onrender.com) builds from `main` using `render.yaml`. Render provisions the database connection and session secret. Set the seed password privately in Render when provisioning a fresh environment. The service starts with `npm start` and uses [`/api/health`](https://frontdesk-app-dzdl.onrender.com/api/health) for readiness. Pushes to `main` trigger automatic deployment.

## Screenshots

The [live sign-in page](https://frontdesk-app-dzdl.onrender.com) shows the actual interface. Sign in with reviewer credentials shared privately to view the queue, SLA details, and activity log.

## Future improvements

- Add a browser-based customer portal and notification delivery.
- Run timed closure in a dedicated worker and integrate a maintained holiday calendar.
- Introduce per-agent account provisioning and password rotation before wider production use.
- Add versioned database migrations as the schema evolves.
