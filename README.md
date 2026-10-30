# HelloCat (React Native / Expo)

A native Android port of the HelloCat web app. It uses the **same Firebase project**, so existing accounts,
chats, friends, posts and themes work as-is.

## Get the APK for free (no PC setup, no Android Studio)

The repo includes a GitHub Actions workflow that builds the APK in the cloud.

1. Create a free account at github.com and make a **new repository** (public = unlimited free build minutes).
2. Upload everything in this folder to the repo (web: "Add file" -> "Upload files").
   - Make sure the hidden folder `.github/workflows/build-apk.yml` is included. If your upload skips it, use
     "Add file" -> "Create new file", type the path `.github/workflows/build-apk.yml`, and paste the file's contents.
3. Open the **Actions** tab. The "Build Android APK" workflow starts by itself (or press "Run workflow").
4. After ~10-20 minutes, open the repo's **Releases** (right side of the repo page) and download `HelloCat.apk`
   on your phone. Allow "install unknown apps" when Android asks.

If the build fails, open the failed run, copy the red error lines and send them to me - first builds often need one small fix.

## Alternative: Expo EAS (needs a free Expo account)

    npm install
    npx expo install --fix
    npx eas-cli login
    npx eas-cli build -p android --profile preview

## Run it while developing

    npm install
    npx expo install --fix
    npx expo start      # scan the QR code with the Expo Go app

## What is included
Sign in / sign up / email verification / profile creation, chats (realtime text, photos, files, replies, delete,
typing + seen + online status), friends (find, requests, unfriend, follow), posts (feed, likes, comments + replies,
images, create/delete), profiles, settings (edit profile + photo, account, 20 themes, login history).

## Crash protection (v1.1.0)
The database is shared with the web app, so any field can be missing or a different type than the app expects.
All data now goes through `src/safe.js` (normalisers, key validation, listeners that cannot throw), every list row and
chat bubble is wrapped in an error boundary, and a global handler stops uncaught errors from closing the app. If something
unexpected still happens, a "Something went wrong - Try again" screen appears instead of the app closing, and the last error
is saved under the AsyncStorage key `last-error`.
Chat previews now read only the newest message by key (no `orderByChild('timestamp')`), which avoids downloading entire
conversations when the database has no `.indexOn` for `timestamp`.

## Notifications
A system notification appears when someone sends you a message (not for the chat you have open). Turn it off, hide the
message text, or disable sound/vibration in **Me -> Settings -> Notifications**. Tapping a notification opens that chat.
Notifications are raised while the app is open or recently used in the background. To also get them when the app has been
fully closed you need server push (a Firebase Cloud Function sending FCM messages) - not included.

## Not ported yet
Google sign-in, custom emoji images, doodles, voice/webcam messages, image editor, code-message composer,
admin/JSON viewer pages, comment likes, post editing.

## Notifications when the app is closed (push) - 100% free

The in-app listener only works while the app process is alive. For closed-app notifications HelloCat uses
Firebase Cloud Messaging (free) plus a tiny Cloudflare Worker (free plan). No Firebase Blaze plan needed.
The app tells the worker right after sending a message; the worker sends the push to the receiver's phone.

1. **google-services.json** - Firebase console -> Project settings -> Add app -> Android, package `com.hellocat.app`.
   Download the file. For GitHub builds add its full content as the repo secret `GOOGLE_SERVICES_JSON`
   (Settings -> Secrets and variables -> Actions). For local builds put it in the project root.
2. **Service account key** - Firebase console -> Project settings -> Service accounts -> Generate new private key (a JSON file; keep it secret).
3. **Deploy the worker** (free Cloudflare account):
   - Dashboard way: Workers & Pages -> Create -> Hello World -> Deploy -> Edit code -> paste `worker/index.js` -> Deploy.
     Then Settings -> Variables and Secrets: add text vars `FIREBASE_PROJECT_ID`, `DATABASE_URL`, `WEB_API_KEY`
     (values are in `worker/wrangler.toml`) and a **secret** `SERVICE_ACCOUNT` = the whole JSON from step 2.
   - CLI way: `cd worker && npx wrangler deploy && npx wrangler secret put SERVICE_ACCOUNT`
4. Copy the worker URL (like `https://hellocat-push.yourname.workers.dev`) into `src/config.js` as `PUSH_WORKER_URL`.
5. **Database rules** (free) - let each user save their own phone token and preferences:
   ```json
   "fcm_tokens": { "$uid": { ".read": false, ".write": "auth != null && auth.uid === $uid" } },
   "push_prefs": { "$uid": { ".read": false, ".write": "auth != null && auth.uid === $uid" } }
   ```
6. Rebuild and install the APK, open the app once and allow notifications, then close it and message yourself from another account.

Note: only messages sent from the HelloCat app trigger a push. Messages sent from the website will not, unless the site also calls the worker.
