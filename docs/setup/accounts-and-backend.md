# Setting up accounts and the backend

Plan 3 adds sign-in, sync and prices. These steps need **you**: they create accounts in your name or involve secrets. Claude can do everything after them. Start with step 2, because Apple can take a day or two to approve a new membership.

Secrets rule: **never paste a secret into chat.** Anything marked *secret* goes into a file on your Mac (`apps/mobile/.env` or the Supabase dashboard) that only you fill in. Things marked *public* are safe to share.

---

## 1. Supabase project (free)

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick a region near you and save the database password in your password manager (*secret*: you type it into the terminal in step 7; never paste it into chat).
2. Note the **project ref** (*public*): **Project Settings → General → Project ID**, e.g. `abcd1234`. The **Project URL** (*public*) is `https://<project ref>.supabase.co`, e.g. `https://abcd1234.supabase.co` (the dashboard's **Connect** button shows it too).
3. Open **Project Settings → API Keys** and copy the **publishable key** (on the *Legacy API keys* tab it is called the *anon* key; the app's `EXPO_PUBLIC_SUPABASE_ANON_KEY` variable takes either) (*public*: it ships inside the app).
   Leave the **secret / service_role key** where it is (*secret*). The backend reads it automatically; nobody needs to copy it.
4. In a terminal in the project folder, sign the Supabase command-line tool in to your account (it opens your browser):

   ```bash
   npx supabase login
   ```

Free projects pause after about a week without activity. If the app stops syncing after a break (it keeps working offline), open the project in the dashboard and click **Restore project**; it's back within a few minutes and the app syncs again on its own.

Send Claude: the Project URL, the publishable key, and the project ref.

## 2. Apple Developer Program ($99/year)

Needed for Sign in with Apple, for running the app with native sign-in, and later for the App Store.

1. Enrol at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) with your Apple ID. Approval is usually quick, but it can take a day or two.
2. Once approved, choose the app's **bundle identifier**: a reverse-domain name that's permanent once the app ships, e.g. `app.mastersettracker` or `com.<yourname>.mastersettracker`.
3. In **Certificates, Identifiers & Profiles → Identifiers**, register an **App ID** with that bundle identifier and tick **Sign in with Apple**.
4. Note your **Team ID** (top-right of the developer site; *public*).
5. In Supabase: **Authentication → Sign In / Providers → Apple** → enable it, and put your bundle identifier in **Client IDs**. The native iOS flow needs no secret key.

Send Claude: the bundle identifier and the Team ID.

Sign in with Apple is enabled automatically once `APP_BUNDLE_ID` is filled in (`apps/mobile/.env`); until then the app builds without it, so the simulator needs no code signing. After changing `APP_BUNDLE_ID` you must rebuild the native app: `rm -rf apps/mobile/ios && pnpm --filter mobile ios`.

## 3. Google sign-in (free)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (e.g. "Master Set Tracker").
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your support email, and save. Testing mode is fine for now. Add your own Google account as a test user.
3. **Credentials → Create credentials → OAuth client ID**, twice:
   - **iOS**: bundle ID = the one from step 2. Copy its **client ID** (*public*).
   - **Web application**: no settings needed. Copy its **client ID** (*public*) and **client secret** (*secret*).
4. In Supabase: **Authentication → Sign In / Providers → Google** → enable it, paste the **Web client ID** and **Web client secret** there (you type the secret into Supabase directly), and add the **iOS client ID** to *Authorized Client IDs* (comma-separated after the web one). Also turn on **Skip nonce check** (the iOS Google SDK adds a nonce Supabase can't verify).

Send Claude: the iOS client ID and the Web client ID (not the secret).

## 4. Email sign-in codes

The app signs in with a numeric code typed into the app, so no email link ever has to open it. Supabase sends a **new** user the *Confirm signup* email and a **returning** user the *Magic Link* email, so both need the code.

### Custom SMTP (required to edit templates)

Supabase only lets you edit email templates once a custom SMTP server is configured. Resend's free tier works:

1. Create a [Resend](https://resend.com) account and an **API key** (*secret*: you type it into Supabase only; never paste it into chat).
2. In Supabase: **Authentication → Emails → SMTP Settings → Enable custom SMTP** and fill in:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key.
   - Sender email **`onboarding@resend.dev`** and any sender name.
3. Sender and recipient rules until you own a domain:
   - The sender **must** be `onboarding@resend.dev`. A sender on a domain you haven't verified (for example a `gmail.com` address) fails with Resend `550 domain is not verified`.
   - Resend's test sender only delivers to the **email address of your Resend account**, so only that address can receive codes.
   - **Verify a domain you own in Resend (Domains) before other people sign in, then switch the sender to an address on that domain.**

### Templates and code length

1. **Authentication → Emails → Templates → Confirm signup**: paste `docs/setup/email-templates/confirm-signup.html` and use the subject from its first line (`Welcome to Master Set Tracker: your code is {{ .Token }}`).
2. **Authentication → Emails → Templates → Magic Link**: paste `docs/setup/email-templates/magic-link.html` and use the subject from its first line (`Your Master Set Tracker code: {{ .Token }}`).
   Save each template. `{{ .Token }}` must appear exactly like that (with the spaces and the dot).
3. **Authentication → Sign In / Providers → Email**: set **Email OTP Length** and leave **Confirm email** on. Supabase's default is **8**, but the app's code field defaults to **6**: **Email OTP Length must equal `EXPO_PUBLIC_EMAIL_OTP_LENGTH`** (6 if unset; allowed 6 to 10). If they differ, codes are truncated and rejected. Either set Supabase to 6, or set `EXPO_PUBLIC_EMAIL_OTP_LENGTH` in `apps/mobile/.env` to match Supabase and restart Expo.

Without custom SMTP the built-in sender is rate-limited (a few emails an hour) and its templates can't be edited.

## 5. Your Mac: CocoaPods

Native sign-in needs a development build of the app, which needs CocoaPods:

```bash
brew install cocoapods
```

(If you don't have Homebrew, see [brew.sh](https://brew.sh).)

CocoaPods needs a UTF-8 terminal. If `pod install` (or the iOS build) fails with *Unicode Normalization not appropriate for ASCII-8BIT*, add this line to `~/.zshrc`, then open a new terminal window:

```bash
export LANG=en_US.UTF-8
```

## 6. The app's settings file

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill in the values from steps 1–3. That file is git-ignored and never committed.

Expo reads `.env` only when its bundler (Metro) starts. After editing `.env`, stop Metro (Ctrl+C) and start it again with a cleared cache, or the app keeps the old values:

```bash
cd apps/mobile && npx expo start --clear
```

## 7. Backend: link, the price-refresh secret, deploy

The daily price refresh is called by a scheduled database job with a random secret of its own (not the service-role key). You create it so that it lives only in Supabase; Claude never sees it. Run these in a terminal in the project folder, in this order.

1. Link the folder to your project. When it asks for the **database password**, type it (from step 1):

   ```bash
   npx supabase link --project-ref <project ref>
   ```
2. Generate the secret and give it to the price function. The value is never printed; the last command puts the SQL for the next step on your clipboard:

   ```bash
   SECRET=$(openssl rand -hex 32)
   npx supabase secrets set REFRESH_PRICES_SECRET="$SECRET"
   printf "select vault.create_secret('%s', 'refresh_prices_secret');\n" "$SECRET" | pbcopy
   unset SECRET
   ```
3. In the dashboard, open **SQL Editor → New query**, paste (Cmd+V) and **Run**. Then run this too (with your project ref):

   ```sql
   select vault.create_secret('https://<project ref>.supabase.co/functions/v1/refresh-prices', 'refresh_prices_url');
   ```
   Then clear the editor, and if the SQL Editor saved the first query as a snippet, delete it (it contains the secret). Copy something else so the secret leaves your clipboard.
4. Create the database tables and the daily schedule. Type the database password again if asked:

   ```bash
   npx supabase db push --remote   # CLI v3 targets the local Docker stack unless --remote is given
   ```
   If it fails on `pg_cron` or `pg_net`, enable both under **Database → Extensions** in the dashboard and run it again.
   Check the schedule exists: in **SQL Editor**, run `select jobname, schedule from cron.job;`. It should list `refresh-prices-daily` with `0 9 * * *`. If it's empty, the Vault secrets from step 3 were missing when the tables were created: create them, then run the one-off `cron.schedule(...)` SQL from the header of `supabase/migrations/20261116000002_prices.sql`.
5. Deploy the two backend functions (`--use-api` deploys without Docker; the CLI asks you to confirm because this is a production project):

   ```bash
   npx supabase functions deploy refresh-prices --use-api
   npx supabase functions deploy delete-account --use-api
   ```

6. Fill the prices once now instead of waiting for 09:00 UTC. In **SQL Editor**, run (the secret is read inside the database and never shown):

   ```sql
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
     headers := jsonb_build_object('Content-Type', 'application/json',
       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_secret')),
     body := '{}'::jsonb, timeout_milliseconds := 120000);
   ```
   After a minute or two, `select set_id, count(*) from card_prices group by set_id;` should show rows for both sets. If not, `select status_code, content from net._http_response order by created desc limit 1;` shows what the function answered (401: the two secrets differ; 500 `misconfigured`: `REFRESH_PRICES_SECRET` isn't set).

Tell Claude when this is done.
