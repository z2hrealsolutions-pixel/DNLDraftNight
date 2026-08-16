# PB71 DNL Draft Night — self-hosted setup

Same app, same auction logic, no Claude branding, no Claude account needed for
anyone who opens the link. This replaces Claude's storage with a free
Supabase database. Follow these in order.

## 1. Create the Supabase project

1. Go to supabase.com → sign up (free) → **New project**.
2. Pick any name (e.g. `pb71-dnl`), set a database password (save it somewhere), pick a region close to Sri Lanka if offered.
3. Wait ~2 minutes for the project to spin up.
4. In the left sidebar, open **SQL Editor** → **New query**.
5. Paste in the contents of `supabase-setup.sql` (included in this project) and click **Run**. This creates the one table the app needs.
6. In the left sidebar, open **Project Settings → API**. Copy two values:
   - **Project URL**
   - **Publishable key** (older Supabase projects may call this "anon public")

## 2. Add your credentials locally

1. In this project folder, copy `.env.example` to a new file named `.env`.
2. Paste your Project URL and Publishable key into it:
   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. `.env` is already in `.gitignore` — it will never get pushed to GitHub. You'll re-enter these same two values into your hosting provider in step 4.

## 3. Push this project to GitHub

**No-terminal way:**
1. Go to github.com → **New repository** (e.g. `pb71-dnl-draft-night`) → Private is fine → Create.
2. Click **uploading an existing file**, drag in every file/folder from this project **except** `node_modules`, `dist`, and `.env` (they're already excluded by `.gitignore`, but the web upload doesn't know that — just don't drag those three in).
3. Commit.

**Terminal way, if you have one:**
```bash
cd pb71-dnl-selfhost
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/pb71-dnl-draft-night.git
git push -u origin main
```

## 4. Deploy it (Vercel — free, easiest)

1. Go to vercel.com → sign up with your GitHub account.
2. **Add New → Project** → select the `pb71-dnl-draft-night` repo → Import.
3. Framework preset should auto-detect as **Vite**. Leave build command (`npm run build`) and output directory (`dist`) as default.
4. Before deploying, open **Environment Variables** and add the same two values from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**. In about a minute you'll get a live URL like `pb71-dnl-draft-night.vercel.app` — fully working, zero Claude branding.

(Netlify works the same way if you'd rather use that — same repo, same env vars, same build command/output folder.)

## 5. Point your own domain at it (optional but recommended)

1. In Vercel: **Project → Settings → Domains** → add `draftnight.pb71.org` (or whatever subdomain you want).
2. Vercel will show you a CNAME record to add.
3. Send that CNAME record to whoever manages pb71.org's DNS (Z2H Design Studio / RealSolutions, per the site footer) — it's a one-line addition on their end.
4. Once it propagates (usually minutes, sometimes a couple hours), your subdomain loads the app directly, fully on your own brand.

## 6. Set up the real event data

Open the live URL → **Auctioneer Console** → admin code is `DNL2026` by default (change it in the Setup tab immediately). From there:
- Add your 6 real captains
- Set category names + reserve prices
- Bulk-import your 66 players
- Do a full dry run — this is a new backend, so re-verify the whole flow once before the real night

The Setup tab's Danger Zone now has separate **Clear all players** / **Clear all captains** buttons, so you can wipe test data cleanly before loading the real roster, without needing to redeploy anything.

## Updating the app later

Whenever I hand you new code:
1. Replace `src/App.jsx` (or whichever files changed) in your GitHub repo.
2. Vercel automatically redeploys on every push to `main` — no extra steps needed.
