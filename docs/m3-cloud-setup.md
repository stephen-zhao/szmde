# M3 Cloud Setup — Creating OAuth Credentials for Google Drive & OneDrive

This walkthrough sets up the cloud credentials that szmde needs to read and write your
markdown files in **Google Drive** and **OneDrive** (milestone M3).

## What these credentials are and why you need them

szmde signs in to your cloud account using **OAuth 2.0** — the same "Sign in with Google /
Microsoft" flow you have used on countless websites. For szmde to be allowed to start that
flow, each provider requires you to **register the app once** in their developer console.
Registration produces a **Client ID** (a public identifier for the app) that szmde hands to
Google/Microsoft when it opens the sign-in window.

A few reassurances before you start, because these consoles look more intimidating than the
task actually is:

- **It is free.** Creating a Google Cloud project, an OAuth client, or an Azure app
  registration costs nothing. You are not enabling billing and not buying anything.
- **It is reversible.** Anything you create here can be deleted later (delete the OAuth
  client, or delete the whole app registration) with no lasting effect.
- **No money and no sensitive data is involved in setup.** You are only creating an
  identifier. You are not granting szmde access to your files *during setup* — that happens
  later, the first time you actually sign in from inside the app and approve the consent
  screen.

> **How szmde signs in (background, you don't configure this):** szmde uses the
> **Authorization Code flow with PKCE** and a **loopback redirect**. When you sign in, the
> app briefly starts a tiny local web server at `http://127.0.0.1:<port>` (or
> `http://localhost`) to catch the response from Google/Microsoft. PKCE is a modern
> security mechanism that replaces the need for a confidential client secret, which is why a
> desktop app like szmde does **not** keep a real, secret password — even where the console
> hands you a string it calls a "secret" (see the Google section). You don't need to do
> anything special to make the loopback work; the steps below select the right client type
> so it just works.

---

## 1. Google Drive (Google Cloud Console)

You will: create/select a project → turn on the Drive API → fill in the consent screen and
add yourself as a test user → declare the Drive scope → create a **Desktop app** OAuth
client and copy its Client ID.

> **2026 layout note:** Google reorganized the old "OAuth consent screen" page. It now lives
> under **APIs & Services → Google Auth platform**, split into sub-pages: **Branding**,
> **Audience**, **Clients**, and **Data Access**. The steps below use those names. If the
> console looks slightly different, navigate by the section names ("find **Credentials** in
> the left sidebar") rather than expecting a pixel-perfect match.

### Step-by-step

1. Go to the Google Cloud Console at **https://console.cloud.google.com/** and sign in with
   your Google account (`stephenzhao97@gmail.com`).

2. **Create or select a project.** At the top of the page, click the **project picker**
   (the drop-down next to the "Google Cloud" logo). Either pick an existing project or click
   **New Project**, give it a recognizable name like `szmde`, and click **Create**. After it
   is created, make sure that project is the one selected in the picker before continuing.

   > **Gotcha:** It is very easy to do all the following steps in the *wrong* project.
   > Always confirm the project name shown in the top bar is `szmde` (or whichever you
   > intend) before each step.

3. **Enable the Google Drive API.** In the left navigation (the ☰ "hamburger" menu at top
   left) go to **APIs & Services → Library**. Search for **Google Drive API**, click it, and
   click **Enable**.

   > **Gotcha:** "Enabling" the API and "creating credentials" are two separate things. If
   > you skip enabling, sign-in will fail later with an access error even though your
   > credentials look correct.

4. **Configure the consent screen (Branding).** Go to **APIs & Services → Google Auth
   platform → Branding** (if this is a brand-new project, the console may show a "Get
   started" button that walks you through Branding + Audience in one wizard). Fill in:
   - **App name:** `szmde` (this is what you'll see on the consent screen when you sign in).
   - **User support email:** select your own email (`stephenzhao97@gmail.com`).
   - **Developer contact email:** enter `stephenzhao97@gmail.com`.

   Save/continue.

5. **Set the audience to External and add yourself as a Test user.** Go to **Google Auth
   platform → Audience**.
   - For **User type**, choose **External**. (A personal Gmail account cannot use
     "Internal" — Internal is only for Google Workspace organizations.)
   - The app's **Publishing status** will be **Testing**. Leave it in **Testing** — you do
     not need to publish or get the app verified for personal use.
   - Under **Test users**, click **Add users** and add **`stephenzhao97@gmail.com`**.

   > **Gotcha — this is the #1 thing people miss.** While the app is in **Testing**, *only*
   > the emails listed under **Test users** are allowed to sign in. If you forget to add
   > your own email here, the very first sign-in attempt from szmde will be rejected with
   > "Access blocked: app has not completed verification" / "you do not have access." Adding
   > yourself as a test user is what makes the unverified app usable for you.

6. **Declare the Drive scope (Data Access).** Go to **Google Auth platform → Data Access**
   and click **Add or remove scopes**. Add:
   - **`https://www.googleapis.com/auth/drive.file`** — *preferred.* This grants access only
     to files the app itself creates or that you explicitly open with it. It is the least-
     privilege option and the one szmde is built around.

   If you ever need szmde to see/manage **all** files in your Drive (broader, not
   recommended for normal use), the alternative is the full **`.../auth/drive`** scope. For
   M3, stick with `drive.file`.

   > **Gotcha:** In the scope picker you can either tick `drive.file` from the filtered list
   > or paste the full scope URL into the **"manually add scopes"** box at the bottom and
   > click **Add to table**. Either works — just make sure the scope ends up in the
   > "Your sensitive scopes" / selected table before you save. `drive.file` is classified as
   > a **sensitive** scope, which is normal; it does not block you while in Testing.

7. **Create the OAuth client (Desktop app).** Go to **APIs & Services → Credentials** (or
   **Google Auth platform → Clients**) and click **Create credentials → OAuth client ID**.
   - For **Application type**, choose **Desktop app**.
   - **Name:** `szmde desktop` (any name; it's just a label).
   - Click **Create**.

   > **Gotcha:** Choose **Desktop app**, *not* "Web application." Desktop app is the correct
   > "installed app" type: it requires no redirect-URI configuration from you (the loopback
   > `http://127.0.0.1:<port>` redirect is handled automatically), and it is the type that
   > works with szmde's PKCE loopback flow. Picking "Web application" would force you to
   > register exact redirect URIs and would be the wrong shape for a desktop app.

8. **Copy what you need.** A dialog appears showing **Your Client ID** and a **Client
   secret**, with an option to **Download JSON**. Copy the **Client ID** (a long string
   ending in `.apps.googleusercontent.com`) and keep it safe.

   > **About that "Client secret":** Google issues a *client secret* even for Desktop app
   > clients, but for an **installed app using PKCE this value is NOT a true confidential
   > secret** — it cannot be kept hidden inside a desktop binary, and Google's installed-app
   > model accounts for that. szmde relies on **PKCE**, not on the secret, for security. You
   > may copy/keep the secret too (some libraries still pass it along), but do **not** treat
   > it as sensitive the way you would a server-side API key, and do **not** assume it
   > provides any real protection. **The Client ID is the value that matters.**

---

## 2. OneDrive (Microsoft Azure Portal / Microsoft Entra ID)

You will: create a new app registration → choose who can sign in → add a Mobile-and-desktop
redirect URI → add the Microsoft Graph delegated permissions → copy the Application (client)
ID and the tenant choice.

> **Naming note:** Microsoft renamed "Azure Active Directory" to **Microsoft Entra ID**.
> You may see either name. App registrations live under **Microsoft Entra ID**. You can do
> all of this from the main Azure Portal; you don't need a paid Azure subscription for app
> registrations.

### Step-by-step

1. Go to the Azure Portal at **https://portal.azure.com/** and sign in with the Microsoft
   account that owns the OneDrive you want szmde to use.

2. **Open App registrations.** In the top search bar, type **App registrations** and select
   it (equivalently: **Microsoft Entra ID → Manage → App registrations**). Click **New
   registration**.

3. **Fill in the registration:**
   - **Name:** `szmde` (this is shown on the consent screen at sign-in time).
   - **Supported account types:** choose **"Accounts in any organizational directory (Any
     Microsoft Entra ID tenant — Multitenant) and personal Microsoft accounts (e.g.
     Skype, Xbox)."**

     > **Gotcha:** Pick the option that includes **personal Microsoft accounts**. Consumer
     > OneDrive (the OneDrive attached to an `@outlook.com` / `@hotmail.com` / personal
     > Microsoft account) only works if personal accounts are allowed. If you choose a
     > single-tenant or work/school-only option, sign-in with your personal OneDrive will
     > fail.

4. **Add the redirect URI now (in the same form).** Under **Redirect URI (optional)**:
   - Set the platform drop-down to **"Public client/native (mobile & desktop)"**.
   - Enter the value **`http://localhost`**.

   Then click **Register**.

   > **Gotcha:** Make sure the platform type is **"Public client/native (mobile & desktop)"**
   > and *not* **"Web"** or **"Single-page application (SPA)."** The desktop/loopback flow
   > szmde uses needs the public-client (native) redirect type. If you missed it during
   > creation, you can add it afterward under the app's **Authentication** blade → **Add a
   > platform → Mobile and desktop applications**, then add the custom URI
   > `http://localhost`.
   >
   > **Gotcha:** Use `http://localhost` exactly (HTTP, not HTTPS; no trailing slash). For
   > loopback desktop clients Microsoft allows `http://localhost` even though HTTP is
   > otherwise disallowed.

5. **Add API permissions (Microsoft Graph, delegated).** In the app's left menu choose
   **API permissions**, then **Add a permission → Microsoft Graph → Delegated permissions**.
   Search for and tick each of:
   - **`Files.ReadWrite`** — read and write the user's OneDrive files.
   - **`offline_access`** — issues a refresh token so szmde can stay signed in without
     re-prompting every hour.
   - **`User.Read`** — read the signed-in user's basic profile (used to show which account
     is connected).

   Click **Add permissions** to save them to the list.

   > **Gotcha — don't forget `offline_access`.** Without it, szmde gets a short-lived access
   > token and *no* refresh token, so cloud sync would silently stop working after about an
   > hour and force a re-login. It's easy to add `Files.ReadWrite` and `User.Read` and miss
   > this one.

6. **Grant consent (optional but tidy).** For a personal account these delegated permissions
   are user-consentable, so you can simply approve them at first sign-in. If you see a
   **"Grant admin consent for …"** button on the API permissions page and it's available to
   you, you may click it to pre-approve; if it's greyed out or asks for an admin, ignore it —
   you'll consent in-app at first login instead.

7. **Copy what you need.** Go to the app's **Overview** page and copy:
   - **Application (client) ID** — a GUID like `00000000-1111-2222-3333-444444444444`.
   - **Directory (tenant) ID** — also a GUID.

   > **Tenant choice:** Because you chose the multitenant + personal-accounts option, szmde
   > should sign in against the **`common`** tenant (the special value `common` lets both
   > personal and work/school accounts in) rather than your specific Directory (tenant) ID.
   > Copy the Directory (tenant) ID anyway for reference, but for M3 plan on using
   > **`common`** as the tenant. (Single-tenant/work-only setups would use the specific
   > tenant GUID — not what you want here.)

---

## Where these go in szmde (Google Drive — live as of M3 L2)

szmde reads the Google client config from a small JSON file in its **OS app-config dir**:

```
%APPDATA%\com.zhaostephen.szmde\gdrive_client.json
```

Create that file (copy [src-tauri/gdrive_client.example.json](../src-tauri/gdrive_client.example.json))
with your real values:

```json
{
  "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  "client_secret": "YOUR_GOOGLE_DESKTOP_CLIENT_SECRET"
}
```

Then in szmde: **hamburger → Storage → Connect Google Drive…** — your browser opens, you
approve consent, and the loopback catches the redirect. Open a Drive file via **Open from
Google Drive…** (paste a Drive link or file ID). Save / autosave / conflict all work as for
local files.

Notes:
- **`gdrive_client.json` is git-ignored** and lives outside the repo (in `%APPDATA%`), so it
  is never committed. The Client ID/secret are app-registration identifiers, not user data.
- **OAuth tokens never go in `gdrive_client.json` or `user.json`.** The live access/refresh
  tokens are stored in the **Windows Credential Manager** (OS secure store) after you connect.
- **OneDrive** isn't wired yet — it lights up the same way once you complete the Azure
  registration above.

---

## Checklist — values to have ready before S7/S8

By the end of this walkthrough you should have collected:

- [ ] **Google Client ID** — long string ending in `.apps.googleusercontent.com`.
- [ ] **Google client secret** *(if shown)* — keep it, but remember it is **not** treated
      as a confidential secret for this PKCE desktop flow. Optional; the Client ID is what
      matters.
- [ ] **Microsoft Application (client) ID** — the GUID from the Azure app's Overview page.
- [ ] **Tenant choice** — plan to use **`common`** (multitenant + personal accounts). Keep
      the **Directory (tenant) ID** GUID on hand for reference.

Keep all of these out of git, and out of `user.json`. They'll be wired in during the M3
live-wiring slice (S7/S8).
