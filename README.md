# Professional Events Tracker

An event dashboard for the Berkeley Haas EWMBA cohort. A daily task gathers events from Bear Necessities and other
Haas newsletters and from public Bay Area listings. Slack is supported too, but the Haas workspace currently blocks
the connector, so it's skipped. Cohort mates sign in with their @berkeley.edu account,
filter everything, mark "I'm going" (visible to the cohort), and add events to their calendars (.ics or Google).

```
docs/                 the website (GitHub Pages serves this folder)
supabase/schema.sql   database tables and access rules (run once)
refresh/REFRESH.md    instructions the daily task follows
refresh/push-events.ps1  sends refresh/events.json to the database
serve.ps1             local preview server
```

School event data never goes into the repo. It lives in Supabase and only signed-in Berkeley accounts can read it.

## One-time setup (about 20 minutes)

### 1. Supabase (database + sign-in)
1. Create a free account at supabase.com and a new project (any name, e.g. `haas-events`, region US West).
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` → **Run**. Repeat with `supabase/002_bug_reports.sql`.
3. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key into `docs/config.js`.
4. Copy `refresh/.env.example` to `refresh/.env` and paste the Project URL and the **secret** key there yourself.
   The secret key only goes in that file.
5. **Authentication → URL Configuration**: set **Site URL** to your GitHub Pages address (step 3), and add it plus
   `http://localhost:8765/` under **Redirect URLs**.
6. **Authentication → Sign In / Providers → Email**: keep **Confirm email** on.

### 2. "Continue with bMail" (Google sign-in)
1. At console.cloud.google.com (a personal Google account is fine), create a project → **APIs & Services →
   OAuth consent screen**: External, app name "Professional Events Tracker", scopes: email, profile, openid only.
   Publish the app (basic scopes don't need Google verification).
2. **Credentials → Create credentials → OAuth client ID** → Web application. Authorized redirect URI: the
   callback URL shown in Supabase under **Authentication → Providers → Google**
   (`https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
3. Paste the client ID and client secret into Supabase's Google provider and enable it.

Email sign-in links also work as a fallback. Supabase's built-in mailer only sends a few emails per hour, so if many
people use links, add a free SMTP sender (for example Resend) under **Authentication → Emails → SMTP**.

### 3. GitHub Pages (hosting)
1. Create a free GitHub account and a **public** repository, e.g. `haas-events`.
2. Push this folder (Claude can do this once you've signed in to GitHub in the browser).
3. Repo **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/docs`.
   Your site appears at `https://YOUR-USERNAME.github.io/haas-events/`.

### 4. Daily refresh
A scheduled Claude task runs `refresh/REFRESH.md` every morning at 6am Pacific. It needs the **Gmail** connector
signed in to your @berkeley.edu account. (The Slack connector is optional and currently blocked by the Haas workspace.) It runs on
this computer, so the Claude app has to be open. A run missed while the computer was asleep happens when it wakes.

## Preview locally
```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```
Then open http://localhost:8765/. With `docs/config.js` blank, the page shows example events.

## Bug reports
Signed-in users can send a report from **Report a bug** in the header, or from **Report a problem with this event**
in any event's details. Reports go to the `bug_reports` table (Supabase → Table Editor). Users can file reports but
can't read them, and each person is limited to 5 per hour. Each daily refresh lists new reports at the top of its log,
checks "event info is wrong" reports against the original source, and marks the reports it handled as seen. To read
them yourself:
```
powershell -NoProfile -ExecutionPolicy Bypass -File refresh\bug-reports.ps1
```

## Fonts
Headlines use **Larken**, subheads and dates use **Barlow**, and body text uses **Inter**. Barlow and Inter load from
Google Fonts. Larken is licensed through Adobe Fonts: create a Web Project that includes Larken at fonts.adobe.com
(add your site's domain and `localhost`), then paste the project ID into `adobeFontsKitId` in `docs/config.js`.
Until then, headlines fall back to Barlow.

## Disclaimer
The header and footer state that this is an independent, open-source, student-run project for Haas EWMBA students,
and that it isn't affiliated with, endorsed by, or sponsored by UC Berkeley or the Haas School of Business. Keep that
text if you fork or rename the site.
