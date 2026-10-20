# FitTrack Pro Max: accounts, cloud storage, 3D stage

Static site (HTML/CSS/vanilla JS) for GitHub Pages. Accounts and permanent data come from Supabase; no private server.
Without Supabase configured, the app still runs exactly as before (data stays in this browser).

## What changed vs. your original
| File | Change |
|---|---|
| `index.html` | + 3D stage card, + 4 script tags (Supabase, Three.js, config, cloud, scene). Nothing removed. |
| `sxript.js` (name kept) | `writeStorage` now notifies the cloud layer; calorie/water goals come from preferences instead of hard-coded 2200 / 2500. All workout/food/water/weight logic untouched. |
| `demo2.css` | Appended: 3D card, sync chip, account dialog, toasts, page-entrance motion (respects reduced-motion). |
| **new** `cloud.js` | Auth, sync queue, localStorage migration, account/settings UI. |
| **new** `scene3d.js` | Procedural Three.js barbell; plate rims glow with today's calorie progress. SVG fallback. |
| **new** `config.js` / `config.example.js` | Your Supabase URL + **publishable** key. |
| **new** `supabase/migrations/001..003` | Tables, RLS, triggers, RPCs, program seed. |
| `landing.*` | Unchanged. |

## Setup (about 15 minutes)
1. **Create a Supabase project** at supabase.com.
2. **Run the SQL**: Dashboard -> SQL Editor -> run, in order, the full contents of
   `supabase/migrations/001_schema_and_rls.sql`, then `002_functions_and_triggers.sql`, then `003_seed_programs.sql`.
3. **Auth settings** (Authentication):
   - URL Configuration -> **Site URL**: `https://gopalchavan512-eng.github.io/my-website/`
   - URL Configuration -> **Redirect URLs**: add the same URL (and `http://localhost:*` if you test locally).
   - Sign In / Providers -> Email: keep **Confirm email ON**; set minimum password length to **8**.
   - Email delivery: Supabase's built-in sender is heavily rate-limited and not meant for production. For real users, add your own SMTP (Authentication -> SMTP Settings).
4. **Credentials**: Project Settings -> API Keys. Copy the **Project URL** and the **publishable key** (`sb_publishable_...`; a legacy `anon` key also works) into `config.js`.
   Never paste a secret / `service_role` key anywhere in this folder. `cloud.js` refuses to start if it detects one.
5. **Deploy**: upload the folder contents to the repo root of `my-website` (replace existing files), commit, and make sure Pages serves from that branch. Open the site.
6. Run the checklist in `docs/TESTING.md`.

## How data works
- Signed out: identical to your original app (localStorage).
- Signed in: each change goes to a persistent outbox and is sent to Supabase; offline changes are retried automatically and survive refresh/close. Records are keyed by `(user_id, client_id)`, so nothing duplicates.
- First sign-in on a device that already has local records: a **backup copy is saved first**, then you're asked whether to import. Invalid records (e.g. bad dates) are skipped *and reported*, and remain in the backup. Import is re-runnable from Account.
- Sign-out clears the on-device cache (the cloud copy is the source of truth); unsynced changes stay queued per account.
- Account deletion calls `delete_my_account()`, which cascades all rows.
- Not synced by design: in-progress workout drafts (they say "saved on this device").

## Tech notes
- Libraries load from CDNs with pinned versions (supabase-js 2.45.4 via jsDelivr, Three.js r128 via cdnjs). If either is blocked, the app degrades (local-only / SVG fallback). To self-host, download them next to `index.html` and change the two script tags.
- Schema: `profiles`, `preferences`, `programs` (seeded, read-only), `workout_sessions` + `exercise_logs`, `food_entries`, `water_entries`, `weight_entries`. RLS is on for all; anon has no access.
- Regenerate the program seed after editing programs: `node docs/gen_seed.js`.
