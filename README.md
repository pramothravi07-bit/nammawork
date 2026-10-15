# NammaWork

NammaWork is a vanilla HTML, CSS, and JavaScript application. Supabase Auth and
PostgreSQL provide authenticated cloud storage; demo mode uses browser-local
storage and has no pre-filled personal records.

## Project files

```text
worktk/
├── fronted.html
├── style.css
├── script.js
├── supabase-config.js
└── supabase/
    └── schema.sql
```

`fronted.html` is the supplied filename. It loads the existing design from
`style.css`; the empty `frontend.css` file is not used. There is no
`fronted.css` file in the project.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com) and wait for its
   database to finish starting.
2. In the Supabase dashboard, open **SQL Editor**, create a query, paste all of
   `supabase/schema.sql`, and run it. This creates the tables, indexes,
   timestamp triggers, profile-creation trigger, RLS, and per-operation policies.
   For an existing project, run the updated schema again to add the shift choice
   column to `work_shifts`; no additional table is created.
3. Under **Authentication → Providers**, ensure Email is enabled. Decide whether
   email confirmation is required; if enabled, verify the confirmation email
   before signing in.
4. Under **Authentication → URL Configuration**, add the local development
   address you will use (for example `http://127.0.0.1:5500/**`) to the allowed
   redirect URLs. The password-reset flow returns to the current app URL.
5. In **Project Settings → API**, copy the Project URL and the publishable key
   (or legacy anon key) into `supabase-config.js`:

   ```js
   export const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
   export const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY";
   ```

   Replace both placeholder strings with values from your own project. Use only
   the publishable key or legacy anon key here. Never put a service-role or
   secret key in this frontend file; the app refuses recognized secret keys.

## Run in VS Code

1. Open `D:\worktk` as a folder in VS Code.
2. Install or enable the **Live Server** extension if it is not already present.
3. Right-click `fronted.html` and choose **Open with Live Server**.
4. Confirm the browser address starts with `http://127.0.0.1:` or
   `http://localhost:`. Do not open the HTML by double-clicking it or use an
   address starting with `file:///`; browsers block JavaScript ES modules from
   local files because their origin is `null`. This causes errors like
   `Access to script at 'file:///D:/worktk/script.js' ... blocked by CORS`.
5. The dashboard opens in demo mode. With Supabase configured and the SQL
   installed, open **Settings â†’ Supabase account** to create an account or sign
   in. Profile, household, shift, agreement, and concern forms then save to the
   matching tables.
6. Demo records stay in the browser and are not uploaded to Supabase.

Alternatively, double-click `start-local.bat` in the project folder and open
`http://127.0.0.1:5500/fronted.html`. Keep the command window open while using
the dashboard; press `Ctrl+C` there to stop the local server. This requires
Python 3. The HTML references `script.js` as an ES module, so it must be served
over HTTP; changing the script URL alone cannot make `file://` module loading
work.

The Supabase JavaScript client and Chart.js are imported from jsDelivr, so
development requires an internet connection. No Node.js build step is used.

## Implemented behavior

- Email/password registration, sign-in, sign-out, session restore, and password
  reset. The password reset redirect must be allowed in Supabase URL settings.
- Per-account profile, household, shift, agreement, and concern records.
- Shift duration calculation supports overnight work and deducts break minutes.
  Wages use the selected household's hourly rate; payments are validated against
  expected wages and outstanding balances are calculated from amounts received.
- Weekly and monthly chart periods, weekly overtime alerts, reports, print, and
  CSV exports.
- Household, shift, agreement, and concern management, theme preference, global
  search, notifications, mobile navigation, and the existing local help assistant.

## Test checklist

- [ ] Register a user; test the configured email-confirmation behavior.
- [ ] Sign in, refresh to verify session restore, sign out, and sign in again.
- [ ] Request a password reset and follow the email link to set a new password.
- [ ] Save profile information and verify it after refreshing.
- [ ] Add, edit, and delete a household.
- [ ] Record a normal shift and an overnight shift; verify breaks, hours, wages,
      paid/partial/unpaid validation, edit, mark-paid, and delete.
- [ ] Add an agreement; edit it, cycle its status, and delete it.
- [ ] Report a concern; cycle its status and delete it.
- [ ] Verify dashboard totals, weekly/monthly charts, overtime alerts, reports,
      household breakdown, and outstanding balances.
- [ ] Export shift CSV, report CSV, and all-record CSV; print the report.
- [ ] Sign in as a second test user and confirm the first user's records are not
      visible. For a stronger RLS test, run cross-user reads/writes through the
      Supabase client and confirm they return no rows or permission errors.
- [ ] Test mobile sidebar, theme toggle, global search, notifications, quick
      actions, modals, and the help/chat content at narrow viewport widths.

The RLS policies are enforced by PostgreSQL and the browser key is publishable;
do not disable RLS or add a service-role key to the frontend.
