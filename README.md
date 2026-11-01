# Workout, Weight and Calorie Tracker

A home screen web app for iPhone. No build step, no accounts. Everything is stored on the phone.

## Put it online (one time)
1. Make a free account at github.com.
2. Create a new repository named `tracker`, set to Public.
3. Click "uploading an existing file", drag in everything inside this folder (not the folder itself), and commit.
4. Repository Settings, then Pages. Under Branch pick `main` and `/ (root)`, then Save.
5. After about a minute your address is `https://YOUR-NAME.github.io/tracker/`.
6. On the iPhone open that address in Safari, tap Share, then Add to Home Screen.

Open the app from the new icon from then on. Data in Safari and data in the home screen app are separate, so always use the icon.

## Push an update
1. Edit or replace the files on GitHub.
2. Open `sw.js` and raise the VERSION number by one (v3 becomes v4). This step is what tells phones there is something new.
3. Open the app. A blue "Update available" bar appears. Tap it to reload.

## Backups
Settings, then Export backup file. Save it to Files or iCloud Drive. The app reminds you every 7 days. Importing a backup on a fresh install brings everything back.

## Morning weigh in reminder
Make a daily alarm or reminder at your wake up time named "Weigh in", then open the app from the icon. Shortcuts cannot open a home screen app with a link, and a link opened in Safari would use separate storage.
