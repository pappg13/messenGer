# messenGer

Voice-only messaging in private **Journals**. A Journal is a closed space of voice messages that only its
members can see or hear. Each message gets an AI transcript and a short summary.

## How it works

- **Frontend:** vanilla JS (ES modules in `js/`), hash routes: `#/` Home, `#/j/<id>` a Journal,
  `#/join/<token>` invite link, `#/account`.
- **Backend:** Firebase Auth, Realtime Database, Storage and Cloud Functions (`functions/`).
- **Authorization is server-side.** `database.rules.json` only lets members read a Journal. Clients can
  never read or delete Storage files: they drop an upload in `uploads/<uid>/<journal>/`, the
  `processRecording` function verifies it against the message record, converts it and stores it in
  `recordings/<journal>/`, and members get short-lived signed URLs from the `getAudioUrl` callable.
  Creating/joining/leaving/deleting a Journal go through callables (`createJournal`, `joinJournal`,
  `leaveJournal`, `deleteJournal`).

## Data model (Realtime Database)

```
journals/<jid>/meta       name, color, inviteToken, createdBy, createdAt, lastMessageAt, lastMessageBy
journals/<jid>/members/<uid>   displayName, joinedAt, lastSeenAt
journals/<jid>/messages/<mid>  authorId, authorName, createdAt, duration, peaks, mimeType, location,
                               status, audioPath, transcript, summary, deletedAt
journals/<jid>/listens/<mid>/<uid>   listenedAt
journals/<jid>/reactions/<mid>/<uid> emoji
userJournals/<uid>/<jid>  true         (written by functions only)
inviteTokens/<token>      <jid>        (no client access)
```

## Run it locally (no deploy needed)

Requires Node 22+, the Firebase CLI and **Java** (the database/storage emulators need it).

```bash
npm install            # root: live-server
(cd functions && npm install)
npm run emulators      # auth, database, storage, functions
npm start              # in a second terminal: serves the app
```

Open <http://localhost:8080/?emulator=1> (the port is whatever `live-server` prints). `?emulator=1` makes the
app talk to the emulators instead of production (remembered; `?emulator=0` switches back). Create two
accounts on the login page (the auth emulator accepts any email/password) to try inviting.
Transcription needs `OPENAI_API_KEY` in `functions/.env`; without it messages end in an error state.

## Tests

```bash
npm test               # starts the emulators and runs functions/test (rules + callables)
```

## Migrating the old feed into a Journal

`functions/scripts/migrate.js` moves the old flat `messages/` feed into a default Journal ("Journal")
created by you, with all existing users as members. It is a dry run unless `--apply` is passed and never
deletes the old data.

```bash
cd functions
node scripts/migrate.js --email you@example.com            # dry run
node scripts/migrate.js --email you@example.com --apply
```

## Going live (not done yet)

1. One-time: give the Cloud Functions service account the *Service Account Token Creator* role (needed to
   sign audio URLs).
2. `firebase deploy --only functions`, run the migration, then `firebase deploy --only database,storage`.
3. `npm run build && npm run deploy` publishes the frontend to GitHub Pages. The old client stops working
   once the rules change.
