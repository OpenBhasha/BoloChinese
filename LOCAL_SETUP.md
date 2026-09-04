# Local Setup

Get Bolo running on your machine end-to-end. Estimated time: 10–15 minutes.

## Prerequisites

- **Node.js 18+** and **npm 9+** (`node -v` / `npm -v`)
- **MongoDB** (see [MongoDB](#mongodb) below — pick one option)
- **Cloudinary account** — only required for the audio recording + playback endpoints. The rest of the app (login, verify, edit, navigation) works without it.
- **Git**

## 1. Clone

```bash
git clone https://github.com/OpenBhasha/Bolo.git
cd Bolo
```

## 2. Install dependencies

```bash
cd backend && npm install
```

```bash
cd ../frontend && npm install
```

## 3. Configure environment

Copy each example file and fill in your own values.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**`backend/.env` — key fields**

| Key | What to put | Notes |
|---|---|---|
| `PORT` | `5000` (or `5001` on macOS) | macOS's AirPlay Receiver holds port 5000; use 5001 or turn AirPlay Receiver off in System Settings → General → AirDrop & Handoff. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/bolo` for local, or your Atlas URI | See [MongoDB](#mongodb). |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Any long random strings | Generate with `openssl rand -hex 32`. Don't ship the defaults. |
| `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` | From your Cloudinary dashboard | Optional for a first run; audio upload will 500 without them. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Your first admin login | Seeded automatically on first server boot when no admin exists yet. Password must be ≥ 6 chars. |
| `ADMIN_NAME` | Display name | Defaults to "Super Admin". |
| `SEED_ADMIN` | `true` | Set to `false` to disable the boot-time seed once you have an admin. |

**`frontend/.env`**

```env
VITE_API_BASE_URL=http://localhost:5000/api   # or :5001 if you moved the backend
VITE_APP_TITLE=Bolo
VITE_APP_VERSION=1.0.0
```

If you don't create `frontend/.env`, the app falls back to `http://localhost:5000/api`.

## MongoDB

Pick whichever fits your environment.

### Option A — MongoDB Atlas (recommended for teams)

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Add your IP to the cluster's network access list.
3. Create a database user and copy the connection string.
4. Put it in `backend/.env` as `MONGODB_URI` — it usually looks like `mongodb+srv://<user>:<pass>@<cluster>/bolo?retryWrites=true&w=majority`.

### Option B — Local MongoDB via Homebrew (macOS / Linuxbrew)

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

If `brew install` refuses the tap ("Refusing to load formula from untrusted tap"), run:

```bash
brew trust mongodb/brew
```

Then re-run the install. Default URI: `mongodb://127.0.0.1:27017/bolo`.

### Option C — Docker

```bash
docker run -d --name bolo-mongo -p 27017:27017 -v bolo-mongo-data:/data/db mongo:7
```

### Option D — No system MongoDB, no Docker (dev-only fallback)

If you can't install anything, the `mongodb-memory-server` npm package can download a real `mongod` binary into `~/.cache/mongodb-binaries` and run it against a persistent data directory. This is a dev-only workaround; do not use it in production.

```bash
cd backend
npm install --save-dev mongodb-memory-server
```

Create a helper script `local-mongo.js` (outside the repo, e.g. `~/.bolo-local-mongo/local-mongo.js`):

```js
const os = require("os");
const path = require("path");
const fs = require("fs");
const { MongoMemoryServer } = require("/absolute/path/to/Bolo/backend/node_modules/mongodb-memory-server");

const DB_PATH = path.join(os.homedir(), ".bolo-local-mongo", "data");
const PORT = 27017;

(async () => {
  fs.mkdirSync(DB_PATH, { recursive: true });
  const mongod = await MongoMemoryServer.create({
    instance: { port: PORT, dbPath: DB_PATH, storageEngine: "wiredTiger" },
  });
  console.log(`Local MongoDB running at ${mongod.getUri()}  (data: ${DB_PATH})`);
  const stop = async () => { await mongod.stop({ doCleanup: false }); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
})();
```

Run it in its own terminal and leave it up:

```bash
node ~/.bolo-local-mongo/local-mongo.js
```

## 4. Run the app

Three terminals. Or two, if you skipped Option D.

```bash
# (Option D only) terminal 1 — MongoDB
node ~/.bolo-local-mongo/local-mongo.js
```

```bash
# terminal 2 — backend
cd backend && npm run dev
```

```bash
# terminal 3 — frontend
cd frontend && npm run dev
```

Default URLs:

- Frontend: <http://localhost:5173>
- Backend health: <http://localhost:5000/health> (or `:5001` if you moved the port)
- API base: `http://localhost:5000/api`

## 5. Log in

Use the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`. The first admin is seeded automatically on boot. **Change the password after your first login.**

## 6. First-time smoke test

1. Log in as admin.
2. Register a second account (role = user) at `/register`.
3. As admin, go to **Users** and click **Verify** on the new user — this auto-creates a dedicated project for them.
4. Open that project → **Upload Tasks** and drop in the sample CSV (columns: `dialogue_id`, `chinese_transcript`, `pinyin`).
5. Log out and log back in as the annotator to walk the verify → record loop.

## Troubleshooting

**Backend crashes with `EADDRINUSE :::5000` on macOS.** ControlCenter (AirPlay Receiver) holds port 5000. Either move `PORT` to 5001 in `backend/.env` (and update `VITE_API_BASE_URL` in `frontend/.env`), or turn AirPlay Receiver off.

**Audio upload returns 500 "Cloudinary is not configured".** Fill in the three `CLOUDINARY_*` variables in `backend/.env` and restart the backend. Verify/edit still work without Cloudinary.

**Registration returns 422 "Password must contain at least one uppercase letter".** The password validator requires uppercase + digit + minimum length. `Annotator123` works; `annotator123` does not.

**Nodemon says "app crashed" but the server still responds.** An orphan `node` process is holding the port. Find and kill it:

```bash
lsof -nP -iTCP:5000 -sTCP:LISTEN   # or :5001
kill <pid>
```

**Frontend hits `http://localhost:5000/api` but backend is on 5001.** Create `frontend/.env` with the right port and restart Vite (`Ctrl+C`, then `npm run dev`).

**Admin seed didn't run.** Check the boot log for `Admin already present` (an admin already exists — expected on rerun) or a `skipped` message (missing/short password, or a non-admin user already owns the email). The seed only ever creates the *first* admin; rotate passwords in-app after login.

## Backend scripts

| Command | Purpose |
|---|---|
| `npm start` | Production start (`node index.js`). |
| `npm run dev` | Dev start with nodemon file-watching. |
| `npm run seed` | Manual first-admin seed from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. |

## Frontend scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server. |
| `npm run build` | Production build. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | ESLint. |
