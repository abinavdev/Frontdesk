# Frontdesk — Full-Stack Support Ticket System

A customer-support agent workspace built for the **21 November 2026 iNav Technologies / Arvo Systems Full Stack Developer hiring assessment**. Written from scratch as a practical full-stack interpretation of the supplied meeting notes and three incident reports.

**Stack:** React 19 + TypeScript + Vite (frontend), Node.js + Express 4 (API), PostgreSQL (data), native Node test runner (SLA tests). A single Node service serves the built frontend and API in production.

## Features

- Ticket creation with priority, customer details and secure one-time customer access token.
- Agent login, agent queue with filters/search, ticket details, ownership, customer replies and **private internal notes**.
- **Atomic claim:** exactly one agent can claim an unassigned ticket. Simultaneous claims: one succeeds; the other gets HTTP `409`.
- **No private-note leak:** customer endpoints select *only explicit public-safe ticket fields* and messages where `visibility='public'`. They do not send audit events, internal messages, or internal message contents. Customer access requires an unguessable token stored only as a hash.
- Immutable `audit_events` table with PostgreSQL trigger blocking UPDATE/DELETE, recording actions with actor and timestamp.
- Business-hours SLA: Monday–Friday **09:30–18:30 IST**; excludes weekends and dates configured in `HOLIDAYS`.
- Pause SLA clock while waiting for a customer; resume from the remaining working-time budget when they reply or the agent resumes work.
- Auto-close after **five working days** of customer silence; reopen resolved tickets within **five working days**.
- Priority changes recorded; see documented policy below.
- Responsive agent dashboard and conversation/activity views.

## Run locally

**Prerequisites:** Node.js 20+; npm; PostgreSQL 14+.

```bash
# 1. Install dependencies from the repository root
npm install

# 2. Create a database (example for a local postgres user)
createdb frontdesk
# If your local PostgreSQL uses a password and/or different user, edit DATABASE_URL.

# 3. Copy and configure environment
cp .env.example .env
# Edit DATABASE_URL, SESSION_SECRET, SEED_AGENT_PASSWORD, and HOLIDAYS.

# 4. Start the backend (creates schema and nine agents at first launch)
npm run dev:server

# 5. In another terminal start the React frontend
npm run dev:client
```

Open **http://localhost:5173**. The API is **http://localhost:3001**.

The backend automatically initializes SQL tables and seeds nine demo agents if absent. After starting the backend, run `npm run seed:demo` in a third terminal to populate five realistic sample tickets (the command skips duplicates by subject). Example agent emails: `asha@arvo.example`, `ravi@arvo.example`, `maya@arvo.example`. All nine agents use the `SEED_AGENT_PASSWORD` from the **first** initialization (changing the environment variable later does not update existing password hashes). For local development only, if `SEED_AGENT_PASSWORD` is unset, the seed password is `local-demo-only`; production *requires* a stronger password and a distinct `SESSION_SECRET`.

### Tests

```bash
npm test              # native Node SLA/calendar tests
npm run build         # React frontend production bundle
npm run check         # both

# Optional: HTTP/PostgreSQL integration tests. Use a disposable, separate test DB.
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/frontdesk_test npm test
```

For a production-like local test, run `npm run build` then `npm start` and visit `http://localhost:3001`.

> **Security:** Never commit `.env`, database credentials, customer access tokens or session secrets. For the live demo, share an agent login with the reviewer privately rather than putting its password in the public README. HTTP is appropriate only for local development; use the platform's HTTPS endpoint in production.

## Business rules & key decisions

| Requirement inferred from assessment | Implemented behavior |
| --- | --- |
| Urgent: reply in 2 hours, resolve same working day | High: reply within 120 working minutes; resolution due at the close (18:30 IST) of the ticket's first active working day |
| Medium: reply within half a day, resolve in ~3 days | 270 working minutes and 1,620 working minutes respectively |
| Small: reply within 1 day, resolve in ~1 week | 540 working minutes and 2,700 working minutes respectively |
| Don't count weekends, outside work, holidays | IST calendar; explicit holiday dates from `HOLIDAYS=YYYY-MM-DD,YYYY-MM-DD` |
| Waiting on customer must pause timers | When status changes to `waiting_customer`, calculations freeze at wait start; on resume, deadlines move by the amount of *working* time spent waiting |
| Silence for about a working week | Auto-close 2,700 working minutes after entering `waiting_customer` |
| Reopen within about a week | Resolved tickets can reopen within five working days; the resolution SLA excludes the resolved interval |
| No dual assignment | A single SQL `UPDATE ... WHERE assignee_id IS NULL` in a transaction is atomic; loser gets conflict |
| Internal notes must never reach customers | Separate customer API and explicit safe-field projection; customer message query enforces `visibility='public'` |
| History cannot be altered | Append-only `audit_events`, server timestamps and author identity; database UPDATE/DELETE trigger rejects changes |
| Priority changed mid-ticket (not specified) | **Explicit interpretation:** a priority change starts *fresh response/resolution budgets* at the change time. Already-sent first response remains recorded. If the ticket is waiting, the new SLA is frozen until the customer wait ends. The change and policy are audited. |

**Other interpretations:** Five working days is used for each “about one week” rule. “Same working day” means the next available close of business, not a full nine-hour period. The assignment only mentioned holidays abstractly; there is no authoritative public-holiday dataset supplied. Configure festival dates in `HOLIDAYS` before evaluating real cases.

## Customer privacy / API examples

Agents sign in with `POST /api/auth/login` and receive a 12-hour signed bearer session token. Send that token as `Authorization: Bearer <agent_token>` for `/api/agents` and `/api/tickets/*`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health/status check |
| POST | `/api/auth/login` | Agent login |
| GET | `/api/agents` | List agents (agent auth) |
| GET/POST | `/api/tickets` | Search/list or create ticket (agent auth) |
| GET | `/api/tickets/:id` | Ticket, agent-visible messages, immutable history (agent auth) |
| POST | `/api/tickets/:id/claim` | Atomic single-agent claim |
| POST | `/api/tickets/:id/priority` | Change priority with audited SLA reset |
| POST | `/api/tickets/:id/status` | Set `in_progress`, `waiting_customer`, `resolved` |
| POST | `/api/tickets/:id/messages` | Public reply or private internal note |
| POST | `/api/tickets/:id/reopen` | Agent reopen (within window) |
| POST | `/api/public/tickets` | Customer ticket creation: return ID and one-time access token |
| GET | `/api/public/tickets/:id` | Public-only ticket and messages, customer bearer token required |
| POST | `/api/public/tickets/:id/reply` | Customer public reply with customer bearer token |
| POST | `/api/public/tickets/:id/reopen` | Customer reopen within allowed window |

**Example customer workflow:**

```bash
# 1) Create a ticket, save the returned customer_access_token
curl -X POST http://localhost:3001/api/public/tickets \
  -H 'Content-Type: application/json' \
  -d '{"subject":"Login unavailable","description":"Unable to access my account","customer_name":"Test User","customer_email":"test@example.com","priority":"high"}'

# 2) The response includes ticket.id and one-time customer_access_token.
# Do not paste the customer token into public tickets, logs or chat.

# 3) Public-safe read; the token goes in the Authorization header
curl -H "Authorization: Bearer YOUR_CUSTOMER_TOKEN" http://localhost:3001/api/public/tickets/TICKET_ID
```

## Deploy for a one-week reviewer window

This repository includes **`render.yaml`**, a Render Blueprint for a Node web service plus a free PostgreSQL database.

1. Push the contents to a new **public** GitHub repository.
2. In [Render Dashboard](https://dashboard.render.com/), choose **New → Blueprint** and connect that repo.
3. Choose the provided `render.yaml`. During creation, set `SEED_AGENT_PASSWORD` to a strong, memorable 12+ character password. Render automatically generates `SESSION_SECRET` and provisions `DATABASE_URL` from its PostgreSQL instance. Set `HOLIDAYS` for known festival holidays if applicable.
4. Deploy. On app startup the backend creates the schema and nine agents.
5. Open the generated HTTPS URL; sign in and create some realistic sample tickets. Verify `/api/health`, claim, public reply, internal note, waiting/resume and activity history.
6. Submit the verified live URL and your GitHub link. Keep the service and database available for at least a week after submission.

**Free-tier caution (as documented by Render):** Free PostgreSQL instances expire 30 days after creation, so the assessment's one-week evaluation is within that period. Free web services can spin down when idle and need time to wake up. Keep an eye on deployment health and free usage limits. See [Render free-tier docs](https://render.com/docs/free).

## Git workflow (meaningful milestones)

Use natural, accurate commits reflecting actual work, rather than creating fake timestamps or waiting just to make a commit log look longer. Example phases: `chore: scaffold full-stack project`; `feat: add working-hours SLA engine`; `feat: add ticket API and audit trail`; `feat: build agent dashboard`; `docs: add deployment and test instructions`. Commit after verifying each phase.

```bash
git init
git branch -M main
git add .
git commit -m "feat: initial Frontdesk full-stack implementation"

# Create a new empty public repository in your GitHub account named 'frontdesk-assessment'.
git remote add origin https://github.com/YOUR_USERNAME/frontdesk-assessment.git
git push -u origin main
```

On Windows, after extracting the ZIP and opening PowerShell in the project directory, you can alternatively run `./publish-github.ps1` to sign in via the browser and create/push the new repository (GitHub CLI required).

Or, if GitHub CLI is installed and authenticated:

```bash
gh auth login
gh repo create frontdesk-assessment --public --source=. --remote=origin --push
```

No password or personal access token should ever be pasted into a chat or committed to the repository.

## Known limitations / submission completion note

See [`COMPLETION_NOTE.md`](./COMPLETION_NOTE.md) for the current, editable completion note. This is a purposefully scoped assessment project, **not** a hardened production helpdesk. In particular, there is no email/SMS delivery integration; the customer-facing workflow is an API rather than a polished separate customer portal. Configured holidays are manual, and there is no persisted job queue for auto-close while the free web instance is asleep: stale tickets are reconciled on active requests and in-process every 15 minutes. A live deployment and complete database integration tests must be verified on an environment with npm/PostgreSQL/network access before submission.