<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  A self-hosted Markdown notebook for writing, organizing, syncing, and backing up personal knowledge.
</p>

<p align="center">
  <a href="./README_ZH.md">Chinese</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a>
</p>

## About

Inkstone is a browser-based notebook that runs in your own Cloudflare account. Notes remain ordinary Markdown, while the application adds a focused editor, live preview, full-text search, linked-note navigation, offline editing, cross-device synchronization, sharing, and remote backups.

It is a complete application rather than a hosted service: you deploy one Worker and keep the database, files, and runtime under your control.

## Features

| Area | Included |
| --- | --- |
| Writing | CodeMirror 6 editor, live preview, editor/split/preview layouts, synchronized scrolling, outline, focus mode, typewriter mode, autosave, and version history |
| Markdown | Tables, task lists, footnotes, definition lists, callouts, tabs, details blocks, math, Mermaid diagrams, syntax highlighting, Front Matter, and Pandoc-style attributes |
| Organization | Nested folders, inline tags, favorites, pinning, archive, trash, wiki links, backlinks, block references, note embeds, and a relationship graph |
| Search | D1 FTS5 full-text search with CJK-aware indexing, filters, recent notes, and command-palette navigation |
| Reliability | Browser-side cache, offline write queue, optimistic concurrency checks, conflict recovery, realtime notifications, and polling fallback |
| Sharing | Public note links with optional access password and expiration |
| Portability | JSON and ZIP exports, readable Markdown files, attachment export, and manual or scheduled WebDAV/S3 backups |
| Interface | Desktop and mobile layouts, dark/light themes, accent colors, English and Simplified Chinese |

## How it is stored

| Component | Responsibility |
| --- | --- |
| Cloudflare D1 | Accounts, notes, folders, tags, settings, versions, shares, and search indexes |
| Cloudflare R2 or Workers KV | Attachment and uploaded-avatar bytes through the `FILES` or `FILES_KV` binding |
| Browser IndexedDB | Local cache and pending offline writes |
| `SyncHub` Durable Object | Realtime change notifications between active clients |
| `CredentialVault` Durable Object | Isolated encryption key for saved backup credentials |
| WebDAV or S3 storage | User-configured off-site backups |

Attachment and uploaded-avatar bytes are never written to D1. The default configuration uses R2; `wrangler.kv.toml` provides a KV alternative. File upload and attachment restore are disabled when neither binding is configured.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- A Cloudflare account for production deployment

No environment file is required for local development.

## Run locally

```bash
npm ci
npm run dev
```

Open [http://localhost:7712](http://localhost:7712). Wrangler emulates D1, R2, and Durable Objects locally, and stores their state under `.wrangler/state/`. Use `npm run dev:kv` to run the same application with the KV attachment configuration.

The first account created in a new instance becomes the owner. The database schema and the standard Chinese and English welcome notes are initialized automatically on first use for every account.

## Browser-only demo

Run the complete interface without a Worker or any Cloudflare data service:

```bash
npm run dev:demo
```

The sign-in form is prefilled with `admin` / `password`. Notes, folders, tags, search, sharing, settings, attachments, imports, exports, and backup controls are handled by an in-memory browser API. The demo starts from the same Chinese and English welcome notes as a deployed account. Reloading the page restores those notes and returns to the sign-in screen; nothing is written to D1, R2, KV, or a remote backup target.

Deploy the same static demo with:

```bash
npm run deploy:demo
```

This command uses `wrangler.demo.toml` and deploys static assets only, with no Cloudflare bindings.

## Deploy to Cloudflare

### 1. Install and sign in

```bash
npm ci
npx wrangler login
```

### 2. Create the D1 database

```bash
npx wrangler d1 create inkstone-db
```

Add the returned `database_id` to the D1 block in the configuration you will deploy: `wrangler.toml` for R2 or `wrangler.kv.toml` for KV.

```toml
[[d1_databases]]
binding = "DB"
database_name = "inkstone-db"
database_id = "<database-id>"
```

There is no migration command for a fresh installation. Inkstone creates the current schema when the database is first opened.

### 3. Choose attachment storage

R2 is the default and recommended file backend:

```bash
npx wrangler r2 bucket create inkstone-files
```

Keep the existing `[[r2_buckets]]` block in `wrangler.toml` when the bucket name is `inkstone-files`.

To use Workers KV instead, create a namespace and let Wrangler write its ID into the KV configuration:

```bash
npx wrangler kv namespace create inkstone-files --binding FILES_KV --config wrangler.kv.toml --update-config
```

Use one attachment backend per deployment. If both bindings are present, Inkstone chooses R2 for new files while continuing to read existing files from the backend recorded with each attachment.

### 4. Deploy

```bash
npm run deploy     # R2 configuration
npm run deploy:kv  # KV configuration
```

Open the generated Workers URL and register the owner account. Registration closes after the first owner is created. The owner can reopen it later from **Settings → Account**.

Both included Wrangler configurations declare the Durable Objects, hourly backup trigger, static assets, and observability settings. Authentication does not require a manually generated application secret.

## Accounts and recovery

Usernames are used to sign in. Display names and avatars can be changed independently.

Inkstone deliberately has no administrator bypass for forgotten passwords. Keep the owner password safe and configure an external backup after installation. Changing a password invalidates other sessions; individual sessions can also be revoked.

## Exports and backups

- JSON export preserves structured notebook data for re-import.
- ZIP export includes structured data, readable Markdown files, attachments, and a manifest.
- Remote backup targets support WebDAV and S3-compatible services.
- Multiple targets can be configured and run manually or on a schedule.
- Login passwords, active sessions, share passwords, and backup-service credentials are not included in exports.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Worker and client |
| `npm run dev:kv` | Start locally with the KV attachment configuration |
| `npm run dev:demo` | Start the reset-on-refresh browser-only demo |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run test:unit` | Run the Vitest suite |
| `npm run i18n:check` | Verify locale key parity |
| `npm run comments:check` | Enforce the source-comment policy |
| `npm run build` | Type-check and create a production build |
| `npm run deploy:kv` | Build and deploy with `wrangler.kv.toml` |
| `npm run deploy:demo` | Build and deploy the static browser-only demo |
| `npm run test:e2e` | Exercise the API against a running disposable local instance |

The end-to-end script creates, changes, and deletes data at `http://localhost:7712`. Run it only against a fresh local state created for testing.

## Repository layout

```text
src/
├── client/   React interface, editor, preview, local stores
├── shared/   Shared types, limits, locale resources, Markdown utilities
└── worker/   Hono API, authentication, D1 access, sync, sharing, backups
public/       Static assets
scripts/      Repository checks and end-to-end verification
tests/        Cross-module regression tests
```

## Updating

Create a current backup before updating a production instance, then install exactly from the lockfile and deploy again:

```bash
git pull --ff-only
npm ci
npm run deploy
```

Schema upgrades are applied by the application during startup.

## Security and contributions

Read [`SECURITY.md`](./SECURITY.md) before reporting a vulnerability. Development setup and contribution expectations are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Inkstone is distributed under the [GNU Lesser General Public License v3.0 only](./LICENSE), using the SPDX identifier `LGPL-3.0-only`.
