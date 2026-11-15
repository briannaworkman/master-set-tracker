# Setting up accounts and the backend

Plan 3 adds sign-in, sync and prices. These steps need **you**: they create accounts in your name or involve secrets. Claude can do everything after them. Start with step 2, because Apple can take a day or two to approve a new membership.

Secrets rule: **never paste a secret into chat.** Anything marked *secret* goes into a file on your Mac (`apps/mobile/.env` or the Supabase dashboard) that only you fill in. Things marked *public* are safe to share.

---

## 1. Supabase project (free)

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick a region near you and save the database password in your password manager.
2. In the project, open **Project Settings → API** and copy:
   - **Project URL** (*public*), e.g. `https://abcd1234.supabase.co`
   - **anon / publishable key** (*public*: it ships inside the app)
   - leave the **service_role / secret key** where it is (*secret*). The backend reads it automatically; nobody needs to copy it.
3. Note the **project ref**: the `abcd1234` part of the URL.
4. In a terminal in the project folder, sign the Supabase command-line tool in to your account (it opens your browser):

   ```bash
   npx supabase login
   ```

Send Claude: the Project URL, the anon key, and the project ref.

## 2. Apple Developer Program ($99/year)

Needed for Sign in with Apple, for running the app with native sign-in, and later for the App Store.

1. Enrol at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) with your Apple ID. Approval is usually quick, but it can take a day or two.
2. Once approved, choose the app's **bundle identifier**: a reverse-domain name that's permanent once the app ships, e.g. `app.mastersettracker` or `com.<yourname>.mastersettracker`.
3. In **Certificates, Identifiers & Profiles → Identifiers**, register an **App ID** with that bundle identifier and tick **Sign in with Apple**.
4. Note your **Team ID** (top-right of the developer site; *public*).
5. In Supabase: **Authentication → Sign In / Providers → Apple** → enable it, and put your bundle identifier in **Client IDs**. The native iOS flow needs no secret key.

Send Claude: the bundle identifier and the Team ID.

## 3. Google sign-in (free)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (e.g. "Master Set Tracker").
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your support email, and save. Testing mode is fine for now. Add your own Google account as a test user.
3. **Credentials → Create credentials → OAuth client ID**, twice:
   - **iOS**: bundle ID = the one from step 2. Copy its **client ID** (*public*).
   - **Web application**: no settings needed. Copy its **client ID** (*public*) and **client secret** (*secret*).
4. In Supabase: **Authentication → Sign In / Providers → Google** → enable it, paste the **Web client ID** and **Web client secret** there (you type the secret into Supabase directly), and add the **iOS client ID** to *Authorized Client IDs* (comma-separated after the web one).

Send Claude: the iOS client ID and the Web client ID (not the secret).

## 4. Email sign-in codes

In Supabase: **Authentication → Emails → Templates → Magic Link**, make sure the email body includes the code `{{ .Token }}` (e.g. "Your Master Set Tracker code is {{ .Token }}"). The app signs in with that 6-digit code, so no links have to open the app.

The free plan's built-in email sender is rate-limited (a few emails an hour). That's fine for development; add your own SMTP provider before launch.

## 5. Your Mac: CocoaPods

Native sign-in needs a development build of the app, which needs CocoaPods:

```bash
brew install cocoapods
```

(If you don't have Homebrew, see [brew.sh](https://brew.sh).)

## 6. The app's settings file

Claude will create `apps/mobile/.env.example`. Copy it to `apps/mobile/.env` and fill in the values from steps 1–3. That file is git-ignored and never committed.
