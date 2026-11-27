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
In a quiz session, the operator enters both names and starts the match once both players are connected.

## Quiz content

`content/quiz.json` holds the questions and the tunable numbers:

- `questionsPerMatch`: how many questions each match draws, at random and without repeats.
- `pauseSeconds`: the wait between a question closing and the next one opening.
- `scoring`: a correct answer earns `start` points, minus `lostPerSecond` for each second
  since the question opened, never less than `floor`.
- `questions`: each has a unique `prompt`, at least two `choices`, and `answer`,
  the position of the correct choice counting from 0.

A mistake in the file fails the build with a message that names it. A change takes effect on the
next deploy; a match already running keeps the questions it drew.

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
  message on Ably, and subscribed devices fetch a new snapshot. Budget confirmations use
  the event-wide budget channel. Other changes use the session's channel.
  Devices also fetch one on every connect and reconnect.
- Ably presence shows which devices are connected to each session. Budget devices also listen
  for event-wide result changes. Only the server publishes.

## How budget results work

The deployment's database holds one event's rounds. The result compares each product's share
with its average share across confirmed rounds in all budget sessions. Each round contributes
equally using its saved budget and product names. A product absent from a round contributes zero
for that round. Confirming a round refreshes results on connected budget devices.

## How a quiz match works

- The server serializes taps by locking the match row. An answer is scored on the time it reached the server.
- A wrong answer locks out only the player who gave it. If both answer wrong, the question closes with no points.
- No server timer opens the next question. Its opening time is saved when the previous one closes,
  and each device asks for a new snapshot at that moment.
- The correct choice never leaves the server.

Known limits:

- Two taps that reach the server within a few milliseconds of each other may be accepted in either order.
- A running match ends only when its last question closes. If a player leaves, start a new session.

- A player slot stays taken for the life of the session. If a tablet is lost or its browser data
  is cleared, start a new session.
- Starting a session needs no sign-in: anyone who knows the address can create one.
