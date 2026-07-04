# Content dashboard (Sveltia CMS) — setup

The site has a content editing dashboard at **`/admin/`** (i.e.
`https://hermeneutic-ai.github.io/admin/`). It's powered by
[Sveltia CMS](https://github.com/sveltia/sveltia-cms), a maintained drop-in for
Decap/Netlify CMS. Editors log in with their **GitHub account**; saving a page
commits to `main`, which triggers the normal deploy.

There is no separate password: **whoever has write access to this repo can
edit**. That's the access control.

The repo side (`static/admin/index.html`, `static/admin/config.yml`) is already
in place. Two one-time pieces need your accounts to finish wiring up login.

---

## 1. Add the editors as repo collaborators

Repo → **Settings → Collaborators and teams** → add each editor (Victor, Vito)
with **Write** access. Anyone without write access can open `/admin/` but cannot
save.

## 2. Create a GitHub OAuth App (org-owned)

GitHub → the **Hermeneutic-AI org** → **Settings → Developer settings →
OAuth Apps → New OAuth App**:

- **Application name:** `Hermeneutic AI CMS`
- **Homepage URL:** `https://hermeneutic-ai.github.io/`
- **Authorization callback URL:** `https://<your-worker-subdomain>.workers.dev/callback`
  (you'll get the worker subdomain in step 3 — you can come back and fill this in)

Register it, then **copy the Client ID** and **generate a Client Secret**.

## 3. Deploy the Cloudflare auth worker

This is the small relay that completes GitHub's OAuth handshake (the client
secret can't live in the browser). Use the official project:
**https://github.com/sveltia/sveltia-cms-auth**

- Deploy it to your Cloudflare account (the repo has a "Deploy to Cloudflare"
  button, or `npx wrangler deploy`). Give it a distinct name, e.g.
  `hermeneutic-cms-auth`.
- Set these Worker **secrets / variables**:
  - `GITHUB_CLIENT_ID` — from step 2
  - `GITHUB_CLIENT_SECRET` — from step 2
  - `ALLOWED_DOMAINS` — `hermeneutic-ai.github.io` (comma-separate more if needed)
- Your worker URL will look like
  `https://hermeneutic-cms-auth.<your-account>.workers.dev`.
- Go back to the OAuth App (step 2) and make sure the **callback URL** is
  `https://hermeneutic-cms-auth.<your-account>.workers.dev/callback`.

## 4. Point the CMS at the worker

In **`static/admin/config.yml`**, set:

```yaml
backend:
  name: github
  repo: Hermeneutic-AI/hermeneutic-ai.github.io
  branch: main
  base_url: https://hermeneutic-cms-auth.<your-account>.workers.dev
```

(You can edit that file directly on GitHub — ✏️ pencil → commit. It deploys
automatically.)

## 5. Log in

Visit `https://hermeneutic-ai.github.io/admin/`, click **Sign in with GitHub**,
authorize the app once, and you're in. You'll see **Pages**, **Research Notes**,
and **Tools**. Edits save straight to `main` and go live after the deploy
(usually under a minute).

---

### Notes

- **Custom domain later:** if/when the site moves to `hrmn.ai`, add that domain
  to the worker's `ALLOWED_DOMAINS` and update `site_url`/`display_url` in
  `config.yml`.
- **Monitor feeds:** the Monitor tool's tabs are editable under Tools → Monitor
  ("Feeds"). The config preserves that list on save — don't remove the `layout`
  field.
- **Drafts/review:** this is set up to commit directly to `main` (simplest). If
  you'd later prefer a draft-then-publish flow with pull requests, that's a
  one-line change (`publish_mode: editorial_workflow`) — ask and I'll switch it.
