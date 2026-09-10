# ☁️ CloudPad — Notes on Cloud

**🌐 Live site:** https://lalibano.github.io/cloudpad/

A fast, private, full-stack notepad:

- **Frontend:** pure static HTML/CSS/JS → deploy free on **GitHub Pages** (no build step)
- **Backend:** **Supabase** (Postgres + Auth + Realtime) — free tier is enough
- **Phase 2:** **Composio** for integrations (Gmail / Notion / Drive / Slack / GitHub backup & share)

Works instantly in **local demo mode** (localStorage), then upgrades to **cloud sync** once you add Supabase keys.

## ✨ Features (built)

- 📝 Create / edit / autosave (700ms debounce) + `Ctrl+S`
- 📌 Pin, 📦 Archive, 🗑 Trash + restore (double-click to restore)
- 🔍 Instant search (`/` shortcut), tag filter, word/char count
- Markdown toolbar + 👁 live preview (offline, no dependency)
- 🌙 Dark / light mode, 📱 mobile responsive
- ⤓ Export single `.md`, full `.json` backup/restore
- 📱 Demo accounts (instant sign up/in, hashed password, device-only) + ☁️ Supabase Auth (email+password, magic link) + per-user RLS + realtime multi-tab sync
- 🔑 Optional `config.js` deploy defaults (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) so visitors can sign in without pasting keys

## 🚀 Run locally

```bash
cd notepad-cloud
python3 -m http.server 8000
# open http://localhost:8000
```

No install needed. The only CDN is `@supabase/supabase-js@2` (app still works offline in local mode).

## ☁️ Connect Supabase (5 min)

**Status: ✅ LIVE** — project `ogmxvnpwhslafjatxrhg` (ap-southeast-2) wired via Composio: `notes` table + RLS + realtime applied, anon key baked into `config.js`, signup open with autoconfirm. Cloud sign-in works out of the box — steps below only if you ever re-provision.

1. Go to **supabase.com → New project** (free).
2. **SQL Editor → New query** → paste `supabase-schema.sql` → Run.
3. (Optional, for live multi-device sync) **Database → Replication →** enable `notes` table, or run the commented `alter publication …` line.
4. **Project Settings → API** → copy `Project URL` + `anon public` key.
5. Open the app → **⚙ Settings** → paste URL + key → **Connect** → **Sign in / Sign up**.
6. Done — badge turns green: **Cloud sync**.

> Keys are stored only in *your* browser localStorage, never on a server. For a shared deployment, each user pastes keys of the same project (or fork and hardcode your URL + anon key — anon key is safe to expose with RLS on).

### Auth tip
If sign-up says "confirm email", either click the email link or disable confirmations: **Supabase → Authentication → Providers → Email → Confirm email: OFF** (dev only).

## 📄 Deploy to GitHub Pages

**Option A — web UI (easiest):**
1. Create a repo `cloudpad` on GitHub.
2. Upload `index.html`, `styles.css`, `app.js`, `supabase-schema.sql`, `README.md`, `.nojekyll`.
3. Repo **Settings → Pages → Deploy from branch → `main` / root** → Save.
4. Open `https://<you>.github.io/cloudpad/`.

**Option B — CLI:**
```bash
git init && git add . && git commit -m "CloudPad MVP"
git branch -M main && git remote add origin https://github.com/<you>/cloudpad.git
git push -u origin main
# then enable Pages as in Option A step 3
```

A ready workflow is in `.github/workflows/deploy.yml` — push to `main` and Pages deploys automatically.

## 🔌 Phase 2 — Composio plan

Composio gives agents/apps one API + managed OAuth for 1000+ toolkits (Gmail, Notion, Drive, Slack, GitHub…) instead of per-app integrations.

Planned wiring (all behind the Settings → Composio key field already in the UI):

| Feature | Composio toolkit | Behavior |
|---|---|---|
| Backup note | Google Drive / Notion / GitHub | "Backup" button pushes `.md` to Drive/Notion or commits to a repo |
| Share note | Gmail / Slack | Send note as email or Slack message |
| Import | Notion / Drive | Pull docs in as notes |
| AI actions | OpenAI + Composio tools | "Summarize", "Action items → Linear", etc. |

Because GitHub Pages is static, Composio calls will go through either:
- **Supabase Edge Function** (recommended, keeps Composio key secret), or
- direct browser call with a **publishable** key for personal use.

Say the word and I'll scaffold `supabase/functions/composio/` + the Backup/Share buttons.

## 🐙 GitHub backup via Composio (built)

One-click backup of the open note to a GitHub repo as `notes/<slug>.md`.

**How it works:** app → Supabase Edge Function `github-backup` (holds the Composio key server-side — safe for a static site) → `POST /api/v3/tools/execute/GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` [2](https://docs.composio.dev/api-reference/tools/post-tools-execute-by-tool-slug) with `x-api-key` auth [3](https://docs.composio.dev/reference/v3/authentication). Content is sent as plain text (auto-Base64), SHA auto-fetched for updates. If the repo doesn't exist, the function creates it privately and retries.

**Deploy:**
```bash
# 1. GitHub already linked? verify (want status ACTIVE):
export PATH=/home/user/composio-cli/bin:$PATH
composio link github --list   # copy the user_id value

# 2. Composio API key: dashboard.composio.dev → API keys
#    (project key with Tool execution: Write — CLI web-auth can't be used server-side)

# 3. deploy function + secrets (from repo root containing supabase/)
supabase functions deploy github-backup
supabase secrets set COMPOSIO_API_KEY=ak_... COMPOSIO_USER_ID=consumer-... \
  BACKUP_GITHUB_OWNER=lalibano BACKUP_GITHUB_REPO=cloudpad-notes BACKUP_GITHUB_BRANCH=main
```

**In the app:** ⚙ Settings → *GitHub backup* → paste `https://<project>.supabase.co/functions/v1/github-backup` → Save → open any note → 🐙.

> Personal-use setup: one shared GitHub connection. Per-user backups later = per-user Composio `user_id` + each user linking GitHub via `composio link`.

## 🗂 Project structure

```
notepad-cloud/
├── index.html              # app shell + modals
├── styles.css              # light/dark theme
├── app.js                  # state, editor, Supabase sync, realtime
├── supabase-schema.sql     # Postgres table + RLS (run once)
├── .github/workflows/deploy.yml
├── .nojekyll               # Pages: don't run Jekyll
└── README.md
```

## 🔒 Security notes
- RLS enforces `auth.uid() = user_id` on all operations — users can't read each other's notes.
- Never commit service-role keys; only the `anon` key belongs in a frontend.
- Revoke/replace keys from Supabase dashboard if ever leaked.
