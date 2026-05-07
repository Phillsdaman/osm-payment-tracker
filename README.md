# OSM Payment Tracker

A simple shared dashboard for tracking Online Scout Manager activity payments and attendance across a family with multiple kids and leaders.

**Live site:** https://phillsdaman.github.io/osm-payment-tracker/

## Features
- Google sign-in (allowlisted to authorised emails)
- Real-time sync across devices via Firestore
- Track members (leaders + children), activities/camps, and payments
- Auto-create payment entries when adding attendees to an activity
- Dashboard with outstanding totals, overdue, and upcoming activities
- JSON export/import for backups

## Stack
- Static HTML + Tailwind (CDN) + vanilla JS
- Firebase Auth (Google) + Firestore
- Hosted on GitHub Pages

## Setup (one-time, already done)

### 1. Firebase Console
- Create project → enable **Authentication** (Google) and **Firestore** (production mode)
- Add a Web app and copy the `firebaseConfig` into `app.js`
- In **Authentication → Settings → Authorized domains**, add `phillsdaman.github.io`
- Paste `firestore.rules` into **Firestore → Rules** and publish

### 2. Allowlist
Edit `ALLOWED_EMAILS` at the top of `app.js` and the email list inside `firestore.rules`. Both must match.

### 3. Hosting
Pushed to `main` → GitHub Pages serves it from the repo root.

## Local dev
Just open `index.html` in a browser. (For the Google popup to work locally, add `localhost` under Firebase Authentication → Authorized domains — already there by default.)
