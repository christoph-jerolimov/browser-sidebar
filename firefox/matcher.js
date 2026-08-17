/*
 * Shared pattern matcher, used by the content script (Google Docs) and the
 * sidebar panel. Turns a piece of text (selection or link URL) into a
 * structured "match" describing a Jira issue, a GitHub issue/PR, or a
 * plain URL.
 */
(function (global) {
  'use strict';

  // https://github.com/owner/repo/pull/123 (also accepts /pulls/, /issues/, /issue/)
  const GITHUB_URL_RE =
    /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|pulls|issue|issues)\/(\d+)/;

  // Shorthand like owner/repo#123
  const GITHUB_SHORT_RE = /(^|[\s(<])([\w.-]+)\/([\w.-]+)#(\d+)\b/;

  // Jira issue keys like ABC-1234
  const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/;

  // Any http(s) URL
  const URL_RE = /https?:\/\/[^\s"'<>()\]]+/;

  function findMatch(text) {
    if (!text) return null;

    const gh = text.match(GITHUB_URL_RE);
    if (gh) {
      const [, owner, repo, type, number] = gh;
      const ghType = type.startsWith('pull') ? 'pull' : 'issue';
      return {
        kind: 'github',
        owner,
        repo,
        number: Number(number),
        ghType,
        url: `https://github.com/${owner}/${repo}/${ghType === 'pull' ? 'pull' : 'issues'}/${number}`,
        raw: gh[0],
      };
    }

    const jira = text.match(JIRA_KEY_RE);
    if (jira) {
      const key = jira[1];
      return {
        kind: 'jira',
        key,
        project: key.split('-')[0],
        raw: key,
      };
    }

    const short = text.match(GITHUB_SHORT_RE);
    if (short) {
      const [, , owner, repo, number] = short;
      return {
        kind: 'github',
        owner,
        repo,
        number: Number(number),
        ghType: 'unknown',
        url: `https://github.com/${owner}/${repo}/issues/${number}`,
        raw: `${owner}/${repo}#${number}`,
      };
    }

    const url = text.match(URL_RE);
    if (url) {
      return { kind: 'url', url: url[0], raw: url[0] };
    }

    return null;
  }

  global.__sidebarMatcher = { findMatch };
})(globalThis);
