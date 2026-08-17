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

  let following = true;
  let lastRaw = '';

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

    let match = null;

    const link = readLinkUnderCursor();
    if (link) {
      match = globalThis.__sidebarMatcher.findMatch(link);
    }

    if (!match) {
      const selection = readSelectionText();
      if (selection && selection.length <= MAX_SELECTION_LENGTH) {
        match = globalThis.__sidebarMatcher.findMatch(selection);
      }
    }

    if (match && match.raw !== lastRaw) {
      lastRaw = match.raw;
      api.storage.local.set({
        lastMatch: { ...match, at: Date.now(), source: 'google-docs' },
      });
    }
  }

  setInterval(tick, POLL_MS);
})();
