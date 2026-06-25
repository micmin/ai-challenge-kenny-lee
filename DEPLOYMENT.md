# DriftDraw — Deployment

Goal: someone opens the GitLab README, clicks a link, and plays — no clone, no
install, no local server. We get there with **Vercel** (runs the app + holds the
secret API keys) + **Supabase** (database + image storage), deployed from the
GitLab repo. GitLab CI (`.gitlab-ci.yml`) verifies every push on a runner.

> **Status:** The Vercel deploy becomes meaningful once the Next.js app exists
> (Plan 3a-2). Until then, GitLab CI verification is the active piece. Set up the
> accounts below in parallel so deploy is one click away when the app lands.

---

## Why this shape

- A GitLab **CI runner** builds/tests on a clean-internet machine — it is *not* a
  place the app lives. GitLab **Pages** can host only static files and can't keep
  API keys secret. DriftDraw needs a server (for shared game state and secret AI
  keys), so the app runs on **Vercel**; the README just links to its URL.
- The corporate npm block on the dev laptop is irrelevant to deployment: Vercel
  and GitLab runners install dependencies themselves.

---

## 1. Supabase setup (you)

1. Create a free project at https://supabase.com → note the **Project URL** and the
   **service_role** key (Project Settings → API). The service key is secret — it
   only ever lives in Vercel env vars, never in the repo or client code.
2. Create the `games` table (SQL editor):
   ```sql
   create table games (
     id text primary key,
     state jsonb not null,
     version integer not null default 0,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   ```
3. Create a **public** Storage bucket named `images` (Storage → New bucket → Public).
4. Upload a small `placeholder.png` to the `images` bucket (used when an image
   generation fails). Its public URL is
   `<SUPABASE_URL>/storage/v1/object/public/images/placeholder.png`.

## 2. Vercel setup (you)

1. Create a free account at https://vercel.com and **import the GitLab repo**
   (Add New → Project → GitLab). Vercel auto-deploys on every push.
2. Add these **Environment Variables** (Project → Settings → Environment Variables):
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `GEMINI_API_KEY` | your Google AI Studio key |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_KEY` | Supabase service_role key |
   | `IMAGE_BUCKET` | `images` (optional; this is the default) |
   | `PLACEHOLDER_IMAGE_URL` | the placeholder.png public URL (optional) |
3. Framework preset: **Next.js** (auto-detected once Plan 3a-2 adds the app).

## 3. GitLab CI (already configured)

`.gitlab-ci.yml` runs `npm install → npm run typecheck → npm test` on a runner for
every pushed branch. This is our correctness signal in place of the (blocked)
local test loop. Push the repo to GitLab to activate it:

```
git push -u origin <branch>
```

(GitLab — `git.ringcentral.com` — is internal and not blocked by the corporate
npm filter, so pushing works from the dev machine.)

## 4. README link (later)

Once deployed, add the play link to `README.md`, e.g.:

```md
## ▶️ Play DriftDraw
[Start or join a game](https://<your-vercel-app>.vercel.app)
```

---

## Local development note

The dev laptop is behind a corporate web filter that blocks `npm install` from
`registry.npmjs.org`. Write code locally; rely on **GitLab CI** (and Vercel's
build) to install dependencies and verify — both run on clean-internet machines.
