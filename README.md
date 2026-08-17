# browser-sidebar — Docs Ticket Sidebar

A personal Chrome + Firefox extension that watches your **selection and
cursor position in Google Docs**, detects **Jira issue keys** (e.g.
`ABC-1234`) and **GitHub issue/PR links** (e.g.
`https://github.com/owner/repo/pull/123`), fetches details from the Jira /
GitHub REST APIs, and shows them in the **browser sidebar** (Chrome Side
Panel API, Firefox Sidebar API).

```
chrome/    Chrome extension  (Manifest V3, chrome.sidePanel)
firefox/   Firefox extension (Manifest V2, sidebar_action)
build.sh   Bundles both into dist/chrome.zip and dist/firefox.xpi
```

Both folders contain the same shared files (`matcher.js`, `content.js`,
`config.json`, `sidebar/`); only `manifest.json` and `background.js` differ.
If you edit a shared file, copy it to the other folder too.

## How it works

- A content script runs on `https://docs.google.com/document/*`.
  Google Docs renders documents on a canvas, so the extension uses two
  Docs-specific tricks:
  - **Selected text** is read from the hidden clipboard iframe
    (`.docs-texteventtarget-iframe`) that Docs keeps in sync with the
    current selection.
  - **Link under the cursor** is read from the link-preview bubble that
    Docs shows when the cursor/focus lands on a link.
- The content script polls every 500 ms; when the detected value changes it
  writes the match to extension storage.
- The sidebar panel listens to storage changes, fetches details
  (Jira: `/rest/api/2/issue/KEY`, GitHub: `api.github.com`), and renders a
  card with title, status, assignee, labels, etc., plus a link to open the
  original page in a tab.
- Each card also shows the newest activity: the latest comment (Jira and
  GitHub), or — for Jira — the latest status transition from the changelog
  if that is more recent than the last comment.
- Fetched tickets are cached (last 50, in extension storage): revisiting a
  ticket renders the latest known information instantly, while a fresh fetch
  runs in the background and updates the card only if something changed
  (the status line shows "cached … refreshing", then "updated"/"up to date").
- **Follow / Pause**: the button in the sidebar header toggles whether the
  sidebar follows your selection. The state is shared between the content
  script and the sidebar via storage.
- The input field at the bottom of the sidebar lets you test a key/URL
  manually without touching a Google Doc.

What gets detected (in precedence order):

1. GitHub URLs: `https://github.com/o/r/pull/123` (also `/pulls/`, `/issues/`)
2. Jira keys: `ABC-1234` (any `PROJECT-123`-shaped key reacts; narrow it with
   `projectKeys` in `config.json` if needed)
3. GitHub shorthand: `owner/repo#123`
4. Any other `http(s)` URL → shown as a plain link card

If the selection contains **several** tickets (e.g. `ABC-1234, DEF-56 and
XYZ-7`), the first one becomes the card and the rest appear as clickable
"Also detected" chips above it, so you can flip between all of them.

## Configuration (`config.json`)

Each extension folder has its own `config.json`. Edit it **before** loading
or bundling the extension (it ships inside the package):

```jsonc
{
  "jira": {
    "baseUrl": "https://jira.example.com",  // your Jira, e.g. https://yourcompany.atlassian.net
    "issuePath": "/browse/",                // use "/" if your issues live at baseUrl/ABC-1234
    "projectKeys": [],                      // e.g. ["ABC", "XYZ"] to only react to those projects
    "email": "",                            // Jira Cloud: email + API token (basic auth)
    "apiToken": "",                         //   create at id.atlassian.com → Security → API tokens
    "personalAccessToken": ""               // Jira Server/DC: personal access token (bearer auth)
  },
  "github": {
    "token": ""                             // optional; needed for private repos / higher rate limits
  }
}
```

Without credentials the sidebar still detects matches and shows the link —
it just can't fetch details (public GitHub repos work without a token).

> Note: the API calls are made from the sidebar page and rely on the broad
> `https://*/*` host permission, so any Jira host works without editing the
> manifest. Since this is a personal extension with tokens in a plain JSON
> file, don't share the built packages.

## Build / bundle

```sh
./build.sh
```

This produces `dist/chrome.zip` and `dist/firefox.xpi`. (Any `zip` works —
the packages are just the folder contents zipped with `manifest.json` at
the top level.)

For Firefox you can alternatively use
[web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):
`cd firefox && npx web-ext build` (or `npx web-ext run` to test).

## Install

### Chrome

Easiest (unpacked, no bundling needed):

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `chrome/` folder

Or drag & drop `dist/chrome.zip` onto `chrome://extensions` with developer
mode enabled.

Usage: click the extension's toolbar icon to open the side panel (Chrome
only allows opening it from a click, not automatically). Pin the icon via
the puzzle-piece menu.

### Firefox

Temporary (resets on browser restart):

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `firefox/manifest.json` (or `dist/firefox.xpi`)

Permanent (unsigned add-ons need Firefox **Developer Edition**, **Nightly**,
or **ESR**):

1. In `about:config`, set `xpinstall.signatures.required` to `false`
2. Open `about:addons` → gear menu → **Install Add-on From File…** →
   pick `dist/firefox.xpi`

(Regular release Firefox refuses unsigned add-ons; either stay with the
temporary install or sign the xpi for free via `npx web-ext sign` /
addons.mozilla.org as an unlisted add-on.)

Usage: click the toolbar icon (or **View → Sidebar**) to toggle the
sidebar.

## Try it

1. Open the sidebar and make sure it says **⏸ Pause** (i.e. it is following).
2. Open any Google Docs document and:
   - select a Jira key like `ABC-1234` (double-clicking part of it usually
     selects enough), or
   - click into a GitHub or Jira link so the link bubble pops up.
3. The sidebar updates with the fetched details.
4. Use **⏸ Pause** to freeze the sidebar (e.g. to keep a ticket visible
   while you keep editing), **▶ Follow** to resume.

## Limitations

- The sidebar cannot open itself automatically — both browsers require a
  user gesture (click the toolbar icon once; after that it follows along).
- Jira/GitHub pages can't be embedded in an iframe (they send
  `X-Frame-Options: DENY`), which is why the sidebar renders an info card
  fetched from the REST APIs with an "open in tab" link instead.
- Plain (unlinked) text under the cursor can't be read in Google Docs'
  canvas renderer without a selection — select the key (double-click) for
  plain-text detection; links work by cursor position alone.
