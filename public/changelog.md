# Wyvern Changelog

## 2026-05-07

- Added public-only directory recommendations: the User Directory, Server Directory, and Community Hub Discover tab can now request suggested public users and servers ranked from cached recommendation signals and optional EmbeddingGemma embeddings.
- Split directory recommendations behind a new `directory_recommendations` release flag so Edge can ship them first and Stable can promote them later.

## 2026-04-09

- Pins now have their own Direct Message / Server selector and only show a channel picker when browsing a server.
- Workspace selection now has an explicit Direct Message / Server mode, and server workspaces expose a second channel picker only when needed.
- Pins and Workspace now snap their target-mode pickers back cleanly when there is no matching DM or server target, instead of leaving the Community Hub in an inconsistent half-switched state.
- Stopped Workspace autosave from spamming the Community Hub Activity feed; only explicit manual saves now write a `workspace.updated` activity entry.
- Made Backspace at the start of a code-workspace line explicitly join to the previous line so the editor behaves more like a normal code editor.
- Aligned the code-workspace textarea line-height with the syntax mirror so the visible caret no longer sits slightly low.
- Aligned the code-workspace syntax mirror tab sizing and line metrics with the textarea so the visible caret no longer drifts by an indentation chunk.
- Made `Ctrl+A` in code workspaces explicitly select the editor contents so the selection behavior matches the visible code overlay.
- Added live syntax highlighting in code workspaces by mirroring the editor text into a syntax-colored overlay while typing.
- Fixed a blank Community Hub Workspace regression where the new language selector tried to toggle before it was mounted, causing the workspace UI to fail open.
- Improved Community Hub workspaces: live updates now stop refreshing the editor out from under the active cursor, code mode supports real tab/shift-tab indentation, and code workspaces now include a language selector with basic syntax-highlighted preview.
- Hardened the backend and landing shell: auth endpoints are now rate-limited, admin allowlist matching requires exact `username#discriminator`, password hashes no longer replicate through the Edge bridge, mirror HTML injection was removed from the landing shell, `/mirror` now blocks proxied HTML documents, DM close now hides the conversation per-user instead of deleting it for everyone, uploads have tighter limits and safer MIME checks, webhook failures no longer leak raw exceptions, and workspace GETs no longer create rows on read.
- Added workspace target and visibility controls so Community Hub workspaces can switch between different server channels and DMs, support public or private drafts, and keep code mode in a monospace editor. Server settings also now use side tabs with an inline `Integrations` section for webhook management.

## 2026-04-08

- Fixed the embedded Community Hub path so it refreshes safely in Edge, preserves the current server/channel context, and moved webhook management inline into server settings under `Integrations`.
- Added a channel picker to the Community Hub workspace so users can switch the active workspace target directly from the editor, and refreshed server settings with a roomier card-based layout.
- Community Hub now opens as a normal in-app page instead of a modal, and server webhooks live in server settings under `Integrations` so the hub no longer owns that workflow.
- DMs and channels now open at the newest message in Edge so the chat view starts at the bottom instead of mid-history.
- Removed the extra center-column whitespace in the Edge shell so channels and DMs sit closer to the live messages, and strengthened the bottom snap when opening chat.
- Tightened the Edge shell spacing so server and DM rows read larger, the channel menu feels less stretched, and new chat views snap to the bottom on open.
- Split the refreshed shell behind a new `shell_refresh` release flag so Edge keeps the labeled ChatGPT-style sidebar while Stable falls back to the older icon-first shell until promotion.
- DM mode now hides the middle sidebar completely and keeps inactive sidebar items quiet unless hovered or selected.
- Refactored the app shell into a ChatGPT-style labeled sidebar with visible DMs and servers, while keeping the pitch-black background and electric-blue hover treatment.
- Fixed the Edge Mode changelog double-popup by keeping the auto-open on the active app surface only, not the stable shell host.
- Converted the in-app notification, connect, disconnect, and error sounds to WAV and wired them to voice join/leave, error toasts, and incoming message pings.
- Added live websocket-driven UI updates for profile changes, presence changes, server updates, channel updates, and membership changes so the app stays in sync without reloads.
- Added an admin-only tiny `Cause Error` button in the top-right chat header for users on the admins allowlist.
- Added a custom emoji reaction picker so users can react with any emoji instead of a fixed preset list.
- Added the Edge-first community tools pass: in-app message search, pinned messages, bookmarks, server webhooks, activity logs, and channel workspaces for writing/coding.
- Added a `Community Hub` entry point in the chat header so search, pins, bookmarks, webhooks, activity, and workspace tools live in one place.
- Merged User Directory and Server Directory into the Community Hub discover tab so people and server browsing live in one place.
- Expanded Community Hub search to support author, pin, and date filters, added member role controls for server owners, and added webhook test posting with uploaded attachments.
- Split the Community Workspace into clearer Writing and Code modes with a side-by-side layout and revision history panel.
- Moved Community Hub into the left sidebar and added a composer shortcut so workspaces are easier to open from the message bar.
- Added `community_tools` as an Edge-only release flag so the new community features stay hidden from Stable until promotion.
- Restored the automatic changelog popup after fresh login while keeping it hidden before authentication.
- Kept the automatic changelog popup hidden until after a user logs in, while still allowing logged-in users to reopen it from the app.

## 2026-04-05

- Added message replies with inline reply previews in chat and a reply composer bar before send.
- Added connected message rendering so consecutive posts from the same person merge into a cleaner stacked layout.
- Added built-in `GIPHY` support in the message bar with a picker for built-in GIFs and direct GIF URLs.
- Added a changeable user status control in the user panel for `Online`, `Idle`, and `Do Not Disturb`.
- Added live speaking indicators inside voice chat so active speakers glow and animate while talking.
- Extended message payloads to carry reply metadata and reaction summaries so chat updates stay consistent in history loads and real-time events.
- Fixed the landing-page mirror launcher so it can open mirrored root and nested app paths, and mirror redirects now stay on `/mirror/...`.
- Added a `/landing/mirror/...` shell that fetches mirrored app HTML and injects it into the current page so root loads stay on the landing mirror URL without visible redirects.
- Added a localhost-safe landing mirror fallback so `/landing/mirror/` can load the local app shell from `/` when the external mirror proxy is not configured.
- Made the landing mirror portable for deployed hosts and Netlify by allowing the landing page to launch mirror mode from its own URL with a `?mirror=` target and fall back to a full-page embedded app view when proxy injection is unavailable.
- Added a backend startup schema check that stops the app with a clear `alembic upgrade head` message when the database revision is behind the code.
- Updated the landing maintenance banner to use a shorter `Notice` label and support a separate custom `message` field in addition to estimated time.
- Refined chat replies so they render as connected message references above the author line, staying visually distinct from emoji reactions.
- Fixed reaction updates so emoji reaction chips appear immediately from both direct clicks and live socket events.
- Locked `edge_release_banner` to the Edge channel so Stable promotions cannot surface the banner to Stable users.
- Added a cache-busting embed version to the landing page's deployed iframe fallback so Netlify-style mirrors pick up the latest app UI changes reliably.
- Added a browser-local `Edge Mode` in `Settings -> For Devs` with a required `I understand` warning gate before users can enter the live development environment.
- Wired the Edge Mode switch itself to the same enable/disable handler as the button so the toggle animates and responds to clicks instead of acting like a dead indicator.
- Made Edge Mode disable cleanly exit embedded edge shells, clear edge-session tokens, and route direct `/edge` tabs back to Stable instead of leaving the browser stuck in Edge.
- Routed Edge websocket traffic through `/edge/ws` alongside `/edge/api/v1` so the edge client uses the same path namespace for both realtime and HTTP traffic.
- Made chat sends update the message list immediately after a successful post, and loosened message event channel matching to avoid missing live Edge updates.
- Replaced the old profile-only entry point with a lightweight settings hub that now includes `Account` and `For Devs`, while keeping profile editing inside the app.
- Added runtime Edge configuration, stable-to-edge iframe session handoff, and a stable-hosted Edge shell with a persistent banner, `Return to Stable`, and `Reload Edge`.
- Added separate-environment sync metadata, replication outbox/inbound ledger tables, signed internal sync endpoints, and a background bridge worker so compatible writes can flow between `main` and `edge` without sharing a database.
- Seeded the Edge environment from `main` through a signed bootstrap sync path and made `main` authoritative for conflict handling so rejected or incompatible Edge writes do not overwrite stable data.
- Moved Edge entry to a same-host `/edge` endpoint behind an `EDGE_MODE_ENABLED` feature flag so users no longer need separate stable/edge public URLs.
- Removed the public stable/edge app URL runtime wiring and now derive the Edge shell target from the current origin plus `/edge`.
- Added a DB-backed release-flag system with `/admin` promotion controls so Edge-only feature flags can be promoted into Stable with an audit trail instead of requiring a deploy swap.
- Added a release-channel runtime payload so the SPA can resolve Stable vs Edge feature flags from the backend and show Edge-only UI only inside the Edge channel.
- Tightened the sync bridge so only shared chat records and DM-related changes can cross from Edge back into Stable before promotion, while structural and experimental Edge writes stay out of Stable.

## 2026-04-04

- Replaced icons
- Added an automatic changelog popup to the main chat app.
- Kept the release notes in markdown so updates stay easy to edit.
- The changelog now opens when users visit the site and can be reopened from the modal.
- Updated the landing page with a fallback launch link and configurable maintenance messaging.
