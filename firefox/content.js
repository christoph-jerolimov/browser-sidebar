/*
 * Content script for Google Docs (https://docs.google.com/document/...).
 *
 * Google Docs renders documents on a <canvas>, so window.getSelection() does
 * not see the document text. Two workarounds are used:
 *
 *  1. Selected text: Docs mirrors the current selection into a hidden
 *     contenteditable iframe (.docs-texteventtarget-iframe) so that native
 *     copy works. We read the selection from there.
 *
 *  2. Link under cursor: when the cursor/focus lands on a link, Docs shows a
 *     "link bubble" popup containing an <a> with the target URL. We read the
 *     visible bubble's href (unwrapping Google's redirect URL).
 *
 * Whenever the detected value changes (and "follow" mode is on), the match is
 * written to extension storage; the sidebar panel picks it up from there.
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const POLL_MS = 500;
  const MAX_SELECTION_LENGTH = 2000;

  const MAX_ALTERNATES = 8;

  let following = true;
  let lastSignature = '';

  api.storage.local.get({ following: true }).then((v) => {
    following = v.following;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.following) {
      following = changes.following.newValue;
    }
  });

  function unwrapGoogleRedirect(href) {
    try {
      const u = new URL(href);
      if (u.hostname === 'www.google.com' && u.pathname === '/url') {
        return u.searchParams.get('q') || href;
      }
    } catch {
      /* not a URL */
    }
    return href;
  }

  function readSelectionText() {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (iframe) {
      try {
        const text = iframe.contentDocument?.body?.innerText?.trim();
        if (text) return text;
      } catch {
        /* cross-origin or not ready */
      }
    }
    // Fallback for surfaces that still use DOM selection (comments, old editor)
    return String(window.getSelection() || '').trim();
  }

  function readLinkUnderCursor() {
    const anchors = document.querySelectorAll(
      '.docs-linkbubble-bubble a[href], .docs-bubble a[href]'
    );
    for (const a of anchors) {
      // Hidden bubbles have display:none, so offsetParent is null
      if (a.offsetParent !== null) {
        return unwrapGoogleRedirect(a.href);
      }
    }
    return '';
  }

  function tick() {
    if (!following) return;

    let matches = [];

    const link = readLinkUnderCursor();
    if (link) {
      matches = globalThis.__sidebarMatcher.findAllMatches(link);
    }

    if (!matches.length) {
      const selection = readSelectionText();
      if (selection && selection.length <= MAX_SELECTION_LENGTH) {
        matches = globalThis.__sidebarMatcher.findAllMatches(selection);
      }
    }

    if (!matches.length) return;

    // First match becomes the card; further Jira/GitHub matches are offered
    // as clickable alternates in the sidebar.
    const [primary, ...rest] = matches;
    const alternates = rest
      .filter((m) => m.kind === 'jira' || m.kind === 'github')
      .slice(0, MAX_ALTERNATES);

    const signature = [primary, ...alternates].map((m) => m.raw).join('|');
    if (signature !== lastSignature) {
      lastSignature = signature;
      api.storage.local.set({
        lastMatch: { ...primary, alternates, at: Date.now(), source: 'google-docs' },
      });
    }
  }

  setInterval(tick, POLL_MS);
})();
