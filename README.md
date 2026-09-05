# Bolo

Bolo is a full-stack platform for verifying Chinese transcripts and their Pinyin, correcting them where needed, and collecting matching audio recordings from individual users.

- Admin users can create projects, bulk-import dialogue transcripts, verify users, and review submissions (including corrected and erroneous items).
- Regular users work through their assigned dialogues: verify the Pinyin against the Chinese transcript, correct it when needed (or mark it erroneous/invalid), and record matching audio.

## Monorepo Structure

```text
Bolo/
  backend/   Express API + MongoDB
  frontend/  React (Vite) application
```

## Tech Stack

### Backend
- Node.js
- Express
- MongoDB + Mongoose
- JWT authentication
- Multer (file uploads)
- Local filesystem (audio storage under `backend/uploads/audio/`)

### Frontend
- React + Vite
- React Router
- Axios
- Tailwind CSS
- Lucide React

## Prerequisites

- Node.js 18 or newer
- npm 9 or newer
- MongoDB instance (local or cloud)

## Environment Setup

### 1) Backend environment file

Copy `backend/.env.example` to `backend/.env` and fill in your values:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/bolo
JWT_SECRET=replace_with_a_strong_secret
JWT_EXPIRES_IN=7d
NODE_ENV=development

# Audio files are stored on the local filesystem under backend/uploads/audio/
# (created on demand). No external storage service is required.

# First admin, seeded automatically on server startup
ADMIN_NAME=Super Admin
ADMIN_EMAIL=admin@bolo.com
ADMIN_PASSWORD=replace_with_a_strong_password
SEED_ADMIN=true
```

### 2) Frontend environment file

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

Note: Frontend already falls back to `http://localhost:5000/api` if the variable is not provided.

## Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Run in Development

Start backend:

```bash
cd backend
npm run dev
```

Start frontend (new terminal):

```bash
cd frontend
npm run dev
```

Default URLs:
- Frontend: http://localhost:5173
- Backend health: http://localhost:5000/health
- API base: http://localhost:5000/api

## Seed the First Admin

The first admin is created from environment variables, so a production
deployment needs no manual database step - set the credentials on the backend
and start the server:

```env
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=a-strong-password
ADMIN_NAME=Super Admin        # optional, defaults to "Super Admin"
SEED_ADMIN=true               # optional, set to false to skip seeding at boot
```

On every boot the server checks the database and:
- creates the admin when `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set and no admin
  exists yet (the account is created verified);
- does nothing if an admin already exists, if the address belongs to an
  existing non-admin user, or if the variables are unset.

It never overwrites an existing account or password, and a seeding problem is
logged without stopping the API. Because it only ever creates the *first*
admin, changing `ADMIN_PASSWORD` later does not reset the account - rotate the
password through the app.

To seed without starting the API (one-off job, local setup, CI), run the same
logic from the CLI with the same variables in the environment:

```bash
cd backend
npm run seed
```

Change the password after the first login.

## Scripts

### Backend (`backend/package.json`)
- `npm start` - Start server
- `npm run dev` - Start with nodemon
- `npm run seed` - Seed the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`

### Frontend (`frontend/package.json`)
- `npm run dev` - Start Vite dev server
- `npm run build` - Production build
- `npm run preview` - Preview production build
- `npm run lint` - Lint frontend source

## API Overview

Base path: `/api`

### Auth
- POST `/auth/register`
- POST `/auth/login`

### Admin routes
- Prefix: `/admin`
- Protected: requires authenticated user with `admin` role
- Approving a user (`PATCH /admin/users/:id/verify`) also auto-creates a
  dedicated project named after that annotator's generated username and assigns
  it to them; upload the task CSV into that project afterwards.
- Result export (partial results allowed, no completion gate):
  - `GET /admin/export?projectId=&userId=` - CSV, optionally scoped
  - `GET /admin/projects/:projectId/export` - CSV for one project
  - `GET /admin/users/:id/export` - CSV for one annotator

### User routes
- Prefix: `/user`
- Protected: requires authenticated user with `user` role
- Verify → Edit → Record: `PATCH /user/tasks/:id/verify-pinyin` (Yes/No),
  `PATCH /user/tasks/:id/correct` (Submit an edit), `POST /user/tasks/:id/discard`
  (Discard an edit), `POST /user/tasks/:id/reconsider` (undo erroneous/discarded).
- Audio uploads (`POST /user/tasks/:id/audio`) must be mono 16 kHz 16-bit PCM
  WAV; non-conforming files are rejected with `400`.

### Registration
`POST /auth/register` collects Full Name (required), Email, Phone Number, role
and password. A unique username is generated from the name, and anonymous or
invalid-looking identities are flagged for admin review.

## Auth Behavior

- API expects JWT token in `Authorization: Bearer <token>` header.
- Frontend attaches token automatically through Axios interceptor.
- On 401 response, frontend clears local auth data and redirects to login.

## License

No license file is currently included.
