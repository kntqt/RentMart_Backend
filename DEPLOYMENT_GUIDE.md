# RentMart — Deployment Guide

> **Backend → Render (free/paid web service)**  
> **Frontend → Hostinger (static site / file manager)**

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Backend — Deploy to Render](#backend--deploy-to-render)
3. [Frontend — Deploy to Hostinger](#frontend--deploy-to-hostinger)
4. [Post-Deployment Checklist](#post-deployment-checklist)
5. [Environment Variables Reference](#environment-variables-reference)

---

## Prerequisites

| Tool | Purpose |
|---|---|
| [GitHub account](https://github.com) | Host both repos — Render pulls from GitHub |
| [Render account](https://render.com) | Backend hosting |
| [Hostinger account](https://hostinger.com) | Frontend hosting |
| Node.js 18+ (local) | Run build locally |
| MySQL database | Production DB (PlanetScale, Railway, or Aiven free tier) |

> **IMPORTANT:** Render's free tier does NOT include a persistent filesystem — uploaded
> files (profile images, space images) will be lost on redeploy. For production, connect
> a cloud storage service (Cloudinary, S3, etc.) or upgrade to a paid Render plan with a disk.

---

## Backend — Deploy to Render

### Step 1 — Push backend to GitHub

```bash
# In RentMart_Backend/
git add .
git commit -m "chore: render deployment ready"
git push origin main
```

### Step 2 — Create a MySQL database

Use one of these free MySQL providers:

| Provider | Free Tier | URL |
|---|---|---|
| **PlanetScale** | 5 GB | planetscale.com |
| **Railway** | $5 credit/mo | railway.app |
| **Aiven** | 1 instance | aiven.io |

After creating the database, note these values:
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT` (usually `3306`)

### Step 3 — Create a Render Web Service

1. Go to https://dashboard.render.com → **New → Web Service**
2. Connect your GitHub account → select the **RentMart_Backend** repository
3. Fill in the settings:

| Setting | Value |
|---|---|
| **Name** | `rentmart-backend` |
| **Region** | Singapore (closest to PH) |
| **Branch** | `main` |
| **Root Directory** | `backend/server` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | Free (or Starter for always-on) |

### Step 4 — Set Environment Variables on Render

In the Render dashboard → your service → **Environment** tab, add:

```
NODE_ENV          = production
PORT              = 10000
JWT_SECRET        = <run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
DB_HOST           = <your MySQL host>
DB_USER           = <your MySQL user>
DB_PASSWORD       = <your MySQL password>
DB_NAME           = duero_market_db
DB_PORT           = 3306
FRONTEND_URL      = https://your-hostinger-domain.com
```

> NOTE: Render automatically injects PORT. `server.js` is already configured to use
> `process.env.PORT || 5000`.

### Step 5 — Deploy

Click **Create Web Service**. Render will:
1. Clone the repo
2. Run `npm install` in `backend/server/`
3. Start the server with `node server.js`

Watch the **Logs** tab. A successful start looks like:
```
=======================================================
 RentMart CSS Backend running on port 10000
 ENV: production
 Allowed origins: https://your-hostinger-domain.com
=======================================================
```

### Step 6 — Note your Render URL

Your backend URL will look like:
```
https://rentmart-backend.onrender.com
```

**Copy this URL** — you need it for the frontend `.env.production`.

---

## Frontend — Deploy to Hostinger

### Step 1 — Create `.env.production` locally

Inside `RentMart_Frontend/frontend/client/`, create a new file `.env.production`:

```env
VITE_API_BASE_URL=https://rentmart-backend.onrender.com/api
VITE_SERVER_URL=https://rentmart-backend.onrender.com
```

> Replace `rentmart-backend.onrender.com` with your actual Render URL from Step 6.

### Step 2 — Build the production bundle

Open a terminal, navigate to `RentMart_Frontend/frontend/client/`, then run:

```bash
npm install
npm run build
```

This generates a `dist/` folder:
```
dist/
├── index.html
├── _redirects          <-- handles React Router page refreshes
└── assets/
    ├── index-xxxx.css
    └── index-xxxx.js
```

### Step 3 — Log in to Hostinger

1. Go to https://hpanel.hostinger.com
2. Select your hosting plan → click **Manage**

### Step 4 — Upload files

**Option A — File Manager (recommended)**

1. hPanel → **Files → File Manager**
2. Navigate to `public_html/`
3. Delete any placeholder files already there (`index.html`, etc.)
4. Click **Upload** → upload ALL contents inside `dist/`:
   - `index.html`
   - `_redirects`
   - The entire `assets/` folder

> **WARNING:** Upload the CONTENTS of `dist/`, not the folder itself.
> `public_html/index.html` must exist (not `public_html/dist/index.html`).

**Option B — FTP/SFTP (FileZilla / WinSCP)**

1. hPanel → **Files → FTP Accounts** → note host, user, password
2. Connect with FileZilla
3. Drag-and-drop all `dist/` contents into `public_html/`

### Step 5 — Configure `.htaccess` for React Router

In Hostinger File Manager, create or edit `public_html/.htaccess`:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [QSA,L]
```

This ensures refreshing any React route (e.g. `/admin/dashboard`) returns
`index.html` instead of a 404 error.

### Step 6 — Point your domain

1. hPanel → **Domains → Domain List**
2. Confirm your domain is assigned to the hosting plan
3. SSL auto-issues via Let's Encrypt — wait ~5 minutes for HTTPS to activate

### Step 7 — Verify the deployment

Open your domain in a browser. Test:
- Landing page loads correctly
- Login with `admin@duero.com` / `Admin1234`
- Dashboard loads with revenue chart and KPIs
- Images render (served from Render `/uploads`)
- Refreshing a deep route does NOT return 404
- No CORS errors in browser DevTools Console

---

## Post-Deployment Checklist

- [ ] Backend health check: `GET https://rentmart-backend.onrender.com/api/health`
- [ ] Admin login works
- [ ] Staff login works
- [ ] Renter login works
- [ ] Revenue chart loads on Admin Dashboard (Year/Month/Day tabs)
- [ ] Reports page: Year/Month/Date Range filters work
- [ ] File uploads work (profile images, space images)
- [ ] Contact number validation: only 11 digits accepted
- [ ] HTTPS active on frontend (Hostinger Let's Encrypt)
- [ ] HTTPS active on backend (Render auto-SSL)

---

## Environment Variables Reference

### Backend (`backend/server/.env`)

| Variable | Required | Example |
|---|---|---|
| `PORT` | Auto (Render injects) | `10000` |
| `NODE_ENV` | Yes | `production` |
| `JWT_SECRET` | Yes | 64-char hex string |
| `DB_HOST` | Yes | `aws.connect.psdb.cloud` |
| `DB_USER` | Yes | `your-db-user` |
| `DB_PASSWORD` | Yes | `your-db-password` |
| `DB_NAME` | Yes | `duero_market_db` |
| `DB_PORT` | Yes | `3306` |
| `FRONTEND_URL` | Yes | `https://rentmart.com` |

### Frontend (`client/.env.production`)

| Variable | Required | Example |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | `https://rentmart-backend.onrender.com/api` |
| `VITE_SERVER_URL` | Yes | `https://rentmart-backend.onrender.com` |

---

## Tips

- **Render free tier cold starts:** Free services spin down after 15 min of inactivity.
  The first request after idle may take 30–60 seconds. Upgrade to Starter ($7/mo) for always-on.

- **MySQL on Render:** Render offers its own PostgreSQL DB. If you want MySQL, use an
  external provider (Railway, PlanetScale, Aiven).

- **Custom domain on Render:** Add a custom domain in Render settings and point a CNAME
  from your DNS provider to `rentmart-backend.onrender.com`.

- **Persistent uploads on Render:** Add a Render Disk (paid) mounted at `/app/uploads`
  to survive redeploys, or migrate to Cloudinary for image hosting.

