# Event games

A live quiz game and a budget allocation game with a shared display and player tablets or phones.
The product spec is [issue #1](https://github.com/dev-deeper-online/event-games/issues/1).

## Run it locally

You need Node.js 22 or later, Postgres, and a free [Ably](https://ably.com) app.

```sh
npm install
cp .env.example .env.local   # fill in ABLY_API_KEY, and create the database it points to
npm run db:migrate
npm run dev
```

Open `/operator` to start a session, then open `/` on each device and enter the join code.

## Checks

```sh
npm run lint
npm run typecheck
npx playwright install chromium   # once
npm run test:e2e                  # migrates, builds, and serves on port 3100
```

The browser tests use the real Ably service and the database in `DATABASE_URL`.
CI runs all of these on every push and reads the key from the `ABLY_API_KEY` repository secret.

## Deploy to Vercel

1. In Vercel, import this repository. The framework preset is Next.js.
2. In the project's Storage tab, add a Neon Postgres database. It sets `DATABASE_URL`.
   Pick the region closest to the venue, and set the same region under Settings > Functions.
3. Under Settings > Environment Variables, add `ABLY_API_KEY` with the Ably app's root key.
4. Deploy. The `vercel-build` script applies `db/schema.sql` before building.

## How pairing and live sync work

- A session has a six character join code. Each device that joins has its own secret token,
  kept in the browser, so a reload keeps its seat. The joining browser creates the token,
  so a join can safely be retried when the reply is lost.
- Postgres is the source of truth. After a change commits, the server publishes a `changed`
  message on the session's Ably channel, and each device fetches a new snapshot.
  Devices also fetch one on every connect and reconnect.
- Ably presence shows which devices are connected. A device's Ably token only lets it listen
  on its own session's channel; only the server publishes.

Known limits:

- A player slot stays taken for the life of the session. If a tablet is lost or its browser data
  is cleared, start a new session.
- Starting a session needs no sign-in: anyone who knows the address can create one.
