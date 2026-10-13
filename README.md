# BAHETI – Aluminium Material Sorting & Heat Tracker

Web app for logging material sorting, heats, contractor productivity and monthly analytics.
Hosted free on **GitHub Pages**, data stored in **Supabase** (login required).

```
index.html            the app screen
app.js                app logic (talks to Supabase)
config.js             <-- you paste your Supabase URL + key here
assets/               BAHETI logo + favicon
supabase/schema.sql   database tables, default dropdown values, security rules
.github/workflows/    auto-deploy to GitHub Pages
```

---

## STEP 1 – Create the Supabase project (database)

1. Go to **https://supabase.com** → **Sign in** (use your GitHub account) → **New project**.
2. Name: `baheti-tracker`. Set a **database password** (save it somewhere safe). Region: nearest to you (e.g. *Mumbai – ap-south-1*). Click **Create new project** and wait ~2 minutes.
3. Left menu → **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this folder, copy everything, paste into the editor, click **Run**.
   You should see *Success*. Left menu → **Table Editor** now shows `sorting_logs` and `master_options`.

## STEP 2 – Create login users

The app is private: only people you create here can sign in.

1. **Authentication → Users → Add user → Create new user**.
2. Enter email + password, tick **Auto Confirm User**, click **Create user**. Repeat for each team member.
3. **Authentication → Sign In / Providers** (may be called *Settings* in some versions) → turn **OFF** "Allow new users to sign up", then Save.
   (Otherwise anyone who finds your website could create an account.)

## STEP 3 – Connect the app to Supabase

1. In Supabase open **Project Settings → Data API** and copy the **Project URL**.
2. Open **Project Settings → API Keys** and copy the **Publishable key** (`sb_publishable_...`).
   If you only see legacy keys, copy the **anon** key instead. Never use `secret` / `service_role`.
3. Open `config.js` and replace the two placeholder values with what you copied. Save.

## STEP 4 – Put the code on GitHub

1. Go to **https://github.com/new** → name `baheti-tracker` → keep **Public** (free Pages hosting; *Private* needs a paid plan) → **Create repository**.
2. Click **uploading an existing file**, drag in **everything from this folder**
   (including the `.github` folder – if it is hidden on your computer, enable "show hidden files").
   Click **Commit changes**.

   Or with Git on your computer:
   ```bash
   git init
   git add .
   git commit -m "BAHETI tracker"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/baheti-tracker.git
   git push -u origin main
   ```

## STEP 5 – Turn on GitHub Pages

1. In the repo: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab – the workflow "Deploy BAHETI Tracker to GitHub Pages" runs (1–2 min).
   If it did not start, click it → **Run workflow**.
4. When it turns green, your app is live at
   `https://YOUR-USERNAME.github.io/baheti-tracker/`

Every time you change a file and commit to `main`, the site updates automatically.

## STEP 6 – Use it

Open the link → sign in with a user from Step 2 → add entries. Data is saved in Supabase,
shared by everyone, and updates live on other open screens.

---

## Notes

* **Is the key in `config.js` safe in a public repo?** Yes. The publishable/anon key is designed to be public.
  Protection comes from login + Row Level Security rules in `schema.sql`. Never commit a `secret` / `service_role` key.
* **Backups:** Supabase → Table Editor → `sorting_logs` → Export to CSV, or use **Export CSV** in the app.
* **Free plan:** Supabase pauses free projects after ~1 week of no activity; open the dashboard and click *Restore* if that happens.
* **Add / change dropdown values** (materials, vendors, contractors, locations): use "+ Add New…" in the form, or edit the `master_options` table.
* **Other hosts:** the same folder also deploys as-is on Netlify, Vercel or Cloudflare Pages (no build command, publish directory = root).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Database not connected yet" screen | `config.js` still has placeholders – redo Step 3 |
| "Incorrect email or password" | Check user exists and is **confirmed** (Step 2) |
| "Database tables not found" | Run `schema.sql` (Step 1.4) |
| "Permission denied" | Sign out and in again; confirm schema.sql ran without errors |
| Blank page on GitHub Pages | Settings → Pages → Source must be **GitHub Actions** |
| Old version still showing | Hard refresh (Ctrl+Shift+R) |
