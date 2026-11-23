# Investly

Investly is a full-stack investment planning app with an accessible responsive interface, a server API, account sessions, a local relational database, seven calculators, comparison, private calculation history, PDF/Excel reports, sourced currency conversion, and role-protected administration.

## Run locally

Requirements: Node.js 22.5 or newer. The application uses Node's built-in HTTP, crypto, and SQLite modules and has no runtime package dependencies.

```powershell
node server.js
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). To use a different port or database path, set `PORT` and `DATABASE_PATH` in the environment or create a local `.env` from `.env.example`. Versioned SQL migrations in `migrations/` are applied once and recorded in `schema_migrations` at startup. The default database file is `data/investly.sqlite`; keep that directory on persistent storage.

The project also defines `npm start`, `npm run dev`, and `npm test` scripts for machines with npm. No dependency install is required. Run the test suite here with:

```powershell
node --test
```

## Admin bootstrap

Investly does not ship a default admin account. For the first start only, provide `BOOTSTRAP_ADMIN_EMAIL` and a private `BOOTSTRAP_ADMIN_PASSWORD` of at least 14 characters. `BOOTSTRAP_ADMIN_NAME` is optional. The server creates that account as an administrator only when the database has no administrator, then clears the bootstrap variables from its process environment. Store the values in an untracked `.env` file or secure environment variables; never commit the password. Remove them from `.env` or your shell after the first successful bootstrap. Rotate or disable the account from the Admin area as needed.

Example PowerShell setup:

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
$env:BOOTSTRAP_ADMIN_PASSWORD = 'use-a-private-random-password-of-14-or-more-characters'
node server.js
```

Set `COOKIE_SECURE=true` when serving over HTTPS. The default is `false` for local HTTP development. Do not expose the development server directly to the public internet.

## Features

- Registration, sign in/out, account profile and preferred currency.
- SIP, lump sum, simple interest, compound interest, ROI, goal planning, and inflation tools.
- Input validation and explicit calculation assumptions; saved snapshots include inputs, outputs, formula version, and currency.
- Side-by-side comparison of two to five plans using highest projected value as its stated metric.
- Private history with open, delete, PDF, and Excel actions.
- PDF reports with bar and pie graphs, and Excel reports with native bar and pie charts when graph inclusion is selected.
- Currency conversion uses administrator-maintained rates first, then falls back to Frankfurter published reference rates when a configured pair is unavailable. Each result identifies its rate source and effective date; reference rates are published central-bank rates, not live market quotes.
- Admin management for user roles/status, supported calculator modules, exchange rates, reports, and system activity.

## Security and data behavior

Passwords are salted and hashed with Node's `scrypt`; raw passwords are not stored. Sessions use random opaque tokens, server-side hashed token records, HTTP-only SameSite=Lax cookies, and seven-day expiry. Mutating requests with an Origin header must be same-origin. Calculator, history, report, and admin ownership/role checks run on the server. Login and report generation have rate limits. Errors returned to clients do not include internal stack traces.

Amounts are calculated with JavaScript's IEEE-754 number arithmetic and rounded to two decimal places in the result snapshot and reports. Inputs and output ranges are bounded, but this is not a ledger or tax engine. SIP/goal monthly rates use nominal annual return divided by 12 with end-of-month contributions. Lump sum and inflation use annual compounding; simple interest does not compound; compound interest supports annual, half-yearly, quarterly, monthly, and daily periods. Inflation is a cost estimate, not an investment return.

## Architecture and diagrams

See [docs/architecture.md](docs/architecture.md) for the activity, sequence, use-case, and domain diagrams mapped to the application.

The repository was empty, and this runtime has Node but no npm, PostgreSQL service, or Prisma installation. To keep the requested application runnable here without downloading dependencies, this implementation uses native Node.js and SQLite. It creates the normalized relational schema through a tracked SQL migration on startup. The schema is suitable for a single-instance local deployment; a multi-instance production deployment should move persistence to managed PostgreSQL and add a deployment-specific migration adapter before scaling out.

The supplied UML class, activity, sequence, and use-case diagrams were used. The class diagram omits `InflationCalculator`, while the activity and product requirements include inflation; Investly implements inflation as its own calculator module. The class diagram's inheritance-like arrows from concrete calculators to `Calculator Type` are represented as a calculator registry plus a shared calculation service, not as calculator types inheriting from metadata records. `Account` is represented by the users table with `user` and `admin` roles. Comparison is a separate persisted workflow because it appears in the use-case diagram but not in the supplied sequence diagram. No object or deployment diagram was supplied, so none is claimed or inferred as source material.

## Tests

`node --test` covers the seven formula paths, zero-rate cases, validation boundaries, comparison metric, report package generation, session/cookie behavior, server-side history ownership, role protection, currency-unavailable behavior, sourced-rate conversion, and persisted PDF/Excel downloads.

## Deployment notes

For lasting data, run Investly on a long-running Node.js web service with a persistent disk (Render, Railway, Fly.io, Heroku). Static hosts such as Netlify and GitHub Pages cannot run it at all, because it needs a Node HTTP server plus a SQLite file.

Vercel works as a live demo: `vercel.json` bundles `public/` and `migrations/`, and the database is written to `/tmp` because Vercel's filesystem is read-only. Vercel gives each function instance its own `/tmp` that is discarded when the instance stops, so accounts and saved calculations there are temporary. Point `DATABASE_PATH` at a persistent volume or move to a hosted database for real use.

- **Runtime:** Node.js 22.13 or newer. `.nvmrc` pins 24 and `package.json` requires `24.x` (the runtime Vercel supports); `node:sqlite` only exists from 22.5 and is flagged before 22.13, so older runtimes crash at startup.
- **Start command:** `npm start` (or `node server.js`). The included `Procfile` declares the same command for process-based hosts.
- **Networking:** the server binds `0.0.0.0` and uses `PORT` from the environment, so platform port detection and health checks succeed. Set `HOST` only if a specific interface is required.
- **Environment:** set `COOKIE_SECURE=true` behind HTTPS, point `DATABASE_PATH` at persistent storage, and provide `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` once to create the first administrator.
- **Storage:** keep `data/` on a persistent encrypted volume, take regular backups, and do not run multiple app instances against one SQLite file. For higher availability, migrate to PostgreSQL and use a shared session/database layer.
