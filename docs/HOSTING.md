# Hosting the Modra docs on GitHub Pages

This site is a single static SPA: `index.html` + `README.html` + everything under
`docs/`. There is **no server-side rendering** and **no build step required at
serve time** — every browser-side file is already committed.

You have two ways to publish it. Pick one.

---

## Option A — Easy: serve straight from `main` (no Actions)

Best for "I just want my repo to show up at `https://<user>.github.io/modra/`."

1. Push the repo to GitHub (you've already done that with GitHub Desktop).
2. On GitHub.com, open the repo and go to **Settings → Pages**.
3. Under **Build and deployment**, set:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/ (root)`
4. Click **Save**.
5. Wait ~30–60 seconds. The page will refresh and show
   `Your site is live at https://<user>.github.io/modra/`.

That's it. The root `index.html` we shipped redirects to `README.html`, so
visitors landing on the bare URL go straight to the docs.

> ⚠️ GitHub Pages reads from the root of the branch, so do **not** delete
> `index.html`, `README.html`, `docs/`, `assets/`, or `favicon.ico`.

---

## Option B — Pro: deploy via GitHub Actions

This is what most modern repos do. It's already wired up for you in
`.github/workflows/pages.yml`. It re-bundles the browser compiler every time
`main` changes, then publishes a clean `_site/` artifact.

1. Push the repo to GitHub.
2. Open **Settings → Pages**.
3. Under **Source**, choose **`GitHub Actions`** (not "Deploy from a branch").
4. That's it. The next push to `main` will trigger
   `.github/workflows/pages.yml`, which:
   - Installs deps (`npm ci`)
   - Re-bundles the browser compiler (`npm run docs`)
   - Verifies every doc snippet (`npm run docs:verify`)
   - Uploads `_site/` to Pages

You can watch the deploy live under the **Actions** tab. The Pages URL appears
on the workflow summary once the `deploy` job completes.

---

## Custom domain (optional)

If you've registered, say, `modra.dev`:

1. In your DNS provider, add either:
   - A **CNAME** record from `modra.dev` (or `www.modra.dev`) to
     `<user>.github.io`, **or**
   - Four **A** records pointing at GitHub's IPs: `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
2. In **Settings → Pages → Custom domain**, enter `modra.dev` and save.
3. Wait for the DNS check to pass (usually < 5 min).
4. Tick **Enforce HTTPS** once GitHub provisions the cert.

GitHub will auto-create a `CNAME` file at the repo root with your domain inside.
**Don't delete it.**

---

## Updating the site after publishing

You don't need to do anything special. With either option:

- Push to `main` → site updates automatically (within ~1 minute).
- For Option A, it's a direct file serve, so the new files appear after the
  Pages cache TTL.
- For Option B, the deploy workflow runs and republishes the artifact.

---

## Local preview before pushing

You don't need a real server — these files are static. Any local file server
works. The fastest options:

```bash
# Python (already on most machines)
python -m http.server 8080

# Node (no install)
npx serve .

# VSCode "Live Server" extension — right-click README.html -> Open with Live Server
```

Then open `http://localhost:8080/README.html`.

> If you open the file with the `file://` protocol directly, fonts and the
> browser compiler bundle still load, but some browsers refuse to fetch
> sibling files over `file://`. Use a local server if you see broken icons.

---

## Common gotchas

| Symptom | Fix |
|---|---|
| Pages URL is 404 | Wait a minute, then hard-refresh. First publish takes longer. |
| Site loads but no styles | Confirm `docs/styles.css` is committed and on the deployed branch. |
| Playground says "Modra is loading…" forever | `docs/modra-bundle.js` is missing. Run `npm run docs` and commit the result. |
| Favicon doesn't update | Browsers cache favicons aggressively. Try Cmd/Ctrl+Shift+R, or open in private mode. |
| Hash-routed sub-page reloads break (Option A) | Add this `<base>` tag at the top of `<head>` in `README.html`: `<base href="/modra/">`. Option B handles this with the `404.html` fallback. |

---

## Where everything lives

```
modra/
  README.html         The SPA. This is the page Pages serves.
  index.html          Tiny redirect shim so `/` -> `README.html`.
  favicon.ico         Multi-resolution favicon (16/32/48).
  docs/
    styles.css        Stylesheet for the SPA.
    router.js         Hash-based router + theme toggle.
    highlighter.js    Per-language syntax highlighter.
    playground.js     Live compiler playground.
    modra-bundle.js   Browser-bundled Modra compiler (≈ 115 KB).
    favicon.svg       Vector favicon for modern browsers.
    favicon-512.png   High-res favicon (Android, PWA).
    apple-touch-icon.png  iOS home-screen icon.
    og-image.png      Social-preview card (1200x630).
    logo.svg          Master vector logo.
    logomark.svg      Just the M, no panels.
    wordmark.svg      Logo + "modra" text.
  assets/
    *.svg             Editable master vector sources.
    png/              Pre-generated raster exports (script: npm run assets).
```

That's the whole hosting story. Push, flip the switch in Settings, share the URL.
