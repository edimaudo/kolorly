# kolorly: Vercel testing and Reddit Devvit deployment

This project has two build targets:

- **Vercel test build:** a standalone version for testing the screens and five-round game flow at a normal website URL. It uses sample daily colours and stores each test session in that browser's `localStorage`.
- **Reddit Devvit:** the production app. It uses the Devvit server, Reddit APIs, Redis, scheduled posts, and Reddit identity.

Vercel is a testing environment only. It does not host the production Reddit game backend. The Devvit build remains separate and uses the normal `vite.config.ts` configuration.

## 1. Put the project in GitHub

1. Download the `kolorly-source.zip` project package.
2. Create a new, preferably private, repository on [GitHub](https://github.com/new), for example `kolorly`.
3. Use **Add file → Upload files** to upload `kolorly-source.zip` to the repository, then commit the upload.
4. Open the repository and select **Code → Codespaces → Create codespace on main**.

You now have a browser-based development environment. The terminal opened inside Codespaces runs in GitHub's cloud environment; it is not your Mac's Terminal.

## 2. Extract and prepare the project in Codespaces

In the Codespaces terminal, run:

```bash
unzip -o kolorly-source.zip
cd kolorly
```

Check the runtime version:

```bash
node -v
npm -v
```

The project specifies Node.js `>=22.20.0`. If the Codespace has an older version and `nvm` is available, select a newer Node.js release:

```bash
nvm install 24
nvm use 24
```

Install dependencies:

```bash
npm install
```

Commit the extracted project to the repository so Vercel can import it. From the `kolorly` folder:

```bash
git add .
git commit -m "Add kolorly app and Vercel test build"
git push
```

The project folder is `kolorly/` inside the GitHub repository. Select that folder as the Vercel **Root Directory** in the next section.

## 3. Deploy the standalone test build to Vercel

### 3.1 Import the GitHub repository

1. Open [Vercel New Project](https://vercel.com/new).
2. Connect the GitHub account that contains the `kolorly` repository.
3. Import the repository.
4. In **Root Directory**, select `kolorly` (the folder containing `package.json`, `vite.config.vercel.ts`, and `vercel.json`).
5. Keep the build settings from `vercel.json`:
   - Build command: `npm run build:vercel`
   - Output directory: `dist-vercel`
   - Install command: `npm install`
6. Deploy.

No environment variables are required for the standalone test build.

### 3.2 Use the preview

Open the Vercel URL after the deployment succeeds.

- `/` displays the kolorly feed card.
- Select the play button to open `/game`, which displays the five-round mixer.
- Complete the five rounds to inspect the reveal and results screens.

The standalone test build intentionally keeps its interface focused on the game. It does not display test-environment banners or a reset control. Its technical limitations are:

- It uses sample daily targets, not the secret-seeded Reddit daily puzzle.
- Session progress is stored in that browser's `localStorage`; it is not shared with other users or browsers.
- It does not connect to Reddit, Devvit Redis, a subreddit leaderboard, the daily scheduler, Reddit comments, Reddit flair, or Devvit Journeys.
- The results screen offers a copy action instead of Reddit comment sharing.

Use this build to evaluate the layout, responsive behaviour, sliders, timer, scoring display, reveal and results flow at a web URL. It is not a production backend or a substitute for a Reddit playtest.

### 3.3 Update the Vercel test build

After changing the code in Codespaces, commit and push the changes:

```bash
git add .
git commit -m "Update kolorly test build"
git push
```

Vercel will create a new deployment from the updated GitHub commit.

## 4. Prepare the Reddit Devvit version

Stay in the same Codespace and the same `kolorly` project folder. Do not use the Vercel build command for this stage.

The normal `vite.config.ts` loads Reddit's Devvit Vite plugin. The plugin builds both the browser client and the Devvit server from the project's `devvit.json` configuration.

Run the checks:

```bash
npm run type-check
npm test
npm run build
```

The Devvit build is different from the Vercel build:

| Command | Build target | Result |
|---|---|---|
| `npm run build:vercel` | Vercel | Static standalone test build in `dist-vercel/` with a browser session adapter |
| `npm run build` | Reddit Devvit | Client and server bundles in `dist/` for Reddit |

The Vercel standalone shims are selected only by `vite.config.vercel.ts`. The normal Devvit build continues to use the real Devvit client navigation, telemetry package, server endpoints, Reddit API and Redis.

## 5. Connect the Reddit developer account

1. Create or sign in to a Reddit account that you will use as the app developer.
2. Open [Reddit for Developers](https://developers.reddit.com/) and complete the developer onboarding.
3. In the Codespaces terminal, authenticate:

```bash
npx devvit login --copy-paste
```

4. Follow the browser instructions and paste the one-time code back into the terminal.
5. Confirm the account:

```bash
npx devvit whoami
```

If `kolorly` has not yet been registered as an app in the Developer Platform, run `npx devvit init` once and follow the registration flow. Do not use `--force` on an existing app unless you specifically intend to reinitialize it.

## 6. Upload and playtest on Reddit

### 6.1 Upload a private development version

From the `kolorly` project folder, run:

```bash
npm run deploy
```

The script runs the TypeScript check, the game-logic tests, the Devvit build, and `devvit upload`. The upload is private to the developer account; it does not make the app publicly available.

### 6.2 Install it in a test subreddit

Use a subreddit you moderate that has fewer than 200 subscribers:

```bash
npx devvit playtest r/YOUR_TEST_SUBREDDIT
```

Replace `YOUR_TEST_SUBREDDIT` with the actual subreddit name. The playtest command installs the uploaded development version and streams its logs to the Codespaces terminal. Keep the Codespace active while testing. Press `Ctrl+C` in the terminal to stop the playtest session; the latest installed version remains in the test subreddit.

### 6.3 Set the daily puzzle secret

The app has an encrypted, app-global setting named `puzzleSalt`. The app can create its initial post before the setting exists, but it will not let a player begin a round until the secret is configured.

After the app has been installed at least once, generate a strong secret in the Codespaces terminal:

```bash
openssl rand -hex 32
```

Copy the generated value and set the app setting:

```bash
npx devvit settings set puzzleSalt
```

Paste the generated value when prompted. Check the setting name:

```bash
npx devvit settings list
```

Keep the secret private. Use the same value for every subreddit installation and do not rotate it after daily puzzles have been generated. If the first install created a post before the secret was configured, reload that post after setting the secret.

### 6.4 Test the Reddit-only behaviour

Test the app in Reddit itself, not only on Vercel:

- The install trigger creates the first daily post.
- The moderator menu can create the daily post if needed.
- The scheduler runs at `00:00 UTC`.
- The same daily targets are generated for each installation using the same app-global secret.
- Sessions, crowd averages, participant counts and streaks use the installation's Devvit Redis store.
- Round timeouts and refresh recovery work.
- Comment sharing is tested with the requested `SUBMIT_COMMENT` user-action permission.
- Flair is tested only after its required moderator permissions and existing-flair behaviour have been resolved.
- The game is tested on Reddit desktop, iOS and Android.

A Vercel browser test cannot verify these Reddit-only capabilities.

## 7. Submit kolorly for Reddit review

When the Reddit playtest is successful, submit the app for public review:

```bash
npx devvit publish --public
```

This creates an app version, uploads the source and submits a public publishing request. It does not mean the app is immediately live; Reddit must review and approve it.

After approval, install the approved app in the intended subreddit:

```bash
npx devvit install r/YOUR_SUBREDDIT
```

The account running the command must have moderator permissions in that subreddit.

## 8. Updating the app after launch

1. Make changes in the same GitHub repository.
2. Push the changes so Vercel can create a new test-build deployment.
3. Run the Devvit checks and `npm run deploy` in Codespaces.
4. Run `npx devvit playtest` again to verify the new build in the test subreddit.
5. Submit the updated version with `npx devvit publish --public` when it is ready for review.
6. After approval, update the target subreddit installation as required by the Devvit release flow.

## Useful commands

| Command | Purpose |
|---|---|
| `npm install` | Install the project dependencies |
| `npm run build:vercel` | Build the standalone Vercel test version |
| `npm run type-check` | Check TypeScript |
| `npm test` | Run the game-logic tests |
| `npm run build` | Build the Devvit client and server |
| `npm run deploy` | Check, test, build and privately upload to Devvit |
| `npx devvit login --copy-paste` | Connect the Reddit developer account |
| `npx devvit playtest r/NAME` | Install and test in a development subreddit |
| `npx devvit settings set puzzleSalt` | Configure the daily puzzle secret |
| `npx devvit publish --public` | Submit the app for public review |
| `npx devvit install r/NAME` | Install an approved app in a subreddit |

## Platform documentation

- [GitHub Codespaces](https://docs.github.com/en/codespaces)
- [Vercel: Vite deployments](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Reddit Devvit CLI](https://developers.reddit.com/docs/guides/tools/devvit_cli)
- [Reddit Devvit Vite plugin](https://developers.reddit.com/docs/guides/tools/vite)
- [Reddit Devvit Web overview](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview)
- [Reddit app launch guide](https://developers.reddit.com/docs/guides/launch/launch-guide)
