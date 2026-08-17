/*
 * Sidebar panel: listens for matches written to extension storage by the
 * Google Docs content script, fetches details from the Jira or GitHub API
 * (configured in config.json), and renders them. Also owns the
 * follow/pause toggle.
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const { findAllMatches } = globalThis.__sidebarMatcher;

  const cardEl = document.getElementById('card');
  const statusEl = document.getElementById('status');
  const altsEl = document.getElementById('alts');
  const toggleBtn = document.getElementById('follow-toggle');
  const pausedBanner = document.getElementById('paused-banner');
  const tryForm = document.getElementById('try-form');
  const tryInput = document.getElementById('try-input');

  let config = null;
  let following = true;
  let currentSignature = null;
  let currentAlternates = [];
  let requestSeq = 0;

  /* ---------- tiny DOM helpers (no innerHTML with remote data) ---------- */

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'href') node.href = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function setCard(...nodes) {
    cardEl.replaceChildren(...nodes.filter(Boolean));
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function metaList(pairs) {
    const dl = el('dl', { class: 'meta' });
    for (const [term, value] of pairs) {
      if (value == null || value === '') continue;
      dl.append(el('dt', {}, term), el('dd', {}, value));
    }
    return dl;
  }

  function badge(text, variant) {
    return el('span', { class: `badge ${variant || ''}` }, text);
  }

  const TYPE_VARIANTS = [
    [/bug|defect/i, 't-red'],
    [/story/i, 't-green'],
    [/epic/i, 't-purple'],
    [/sub-?task/i, 't-teal'],
    [/task/i, 't-blue'],
    [/improvement|enhancement|feature/i, 't-cyan'],
  ];

  const PRIORITY_VARIANTS = [
    [/blocker|highest|urgent/i, 'p-crit'],
    [/critical/i, 'p-crit'],
    [/high|major/i, 'p-high'],
    [/medium|normal/i, 'p-med'],
    [/lowest|trivial/i, 'p-min'],
    [/low|minor/i, 'p-low'],
  ];

  function variantFor(name, table, fallback) {
    for (const [re, variant] of table) {
      if (re.test(name)) return variant;
    }
    return fallback;
  }

  function typeBadge(name) {
    if (!name) return null;
    return badge(name, variantFor(name, TYPE_VARIANTS, 't-gray'));
  }

  function priorityBadge(name) {
    if (!name) return null;
    return badge(name, variantFor(name, PRIORITY_VARIANTS, 'p-med'));
  }

  // GitHub label colors come from the API as hex; pick black/white text by luminance
  function coloredLabelChip(name, hex) {
    const chip = el('span', { class: 'label-chip' }, name);
    if (/^[0-9a-f]{6}$/i.test(hex || '')) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      chip.style.background = `#${hex}`;
      chip.style.borderColor = 'transparent';
      chip.style.color = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#1f2328' : '#ffffff';
    }
    return chip;
  }

  function openLink(url, label) {
    return el('a', { class: 'open-link', href: url, target: '_blank', rel: 'noreferrer' },
      label || url);
  }

  function snippet(text, max = 500) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const trimmed = text.trim();
    const short = trimmed.length > max ? trimmed.slice(0, max) + ' …' : trimmed;
    return el('div', { class: 'snippet' }, short);
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
  }

  /* ---------------------------- follow/pause ---------------------------- */

  function renderToggle() {
    toggleBtn.textContent = following ? '⏸ Pause' : '▶ Follow';
    pausedBanner.hidden = following;
  }

  /* ------------------------------- config ------------------------------- */

  async function loadConfig() {
    const res = await fetch(api.runtime.getURL('config.json'));
    return res.json();
  }

  function jiraBrowseUrl(key) {
    const base = (config?.jira?.baseUrl || '').replace(/\/+$/, '');
    const path = config?.jira?.issuePath ?? '/browse/';
    return `${base}${path}${key}`;
  }

  function jiraAuthHeaders() {
    const jira = config?.jira || {};
    if (jira.personalAccessToken) {
      return { Authorization: `Bearer ${jira.personalAccessToken}` };
    }
    if (jira.email && jira.apiToken) {
      return { Authorization: `Basic ${btoa(`${jira.email}:${jira.apiToken}`)}` };
    }
    return {};
  }

  function githubAuthHeaders() {
    const headers = { Accept: 'application/vnd.github+json' };
    if (config?.github?.token) {
      headers.Authorization = `Bearer ${config.github.token}`;
    }
    return headers;
  }

  /* ------------------------------ renderers ------------------------------ */

  function renderJira(match, issue, error) {
    const url = jiraBrowseUrl(match.key);
    const head = el('div', { class: 'card-head' }, [
      el('a', { class: 'ref', href: url, target: '_blank', rel: 'noreferrer' }, match.key),
    ]);

    const children = [head];

    if (issue) {
      const fields = issue.fields || {};
      const statusName = fields.status?.name || '';
      head.append(badge(statusName || 'unknown', statusName.toLowerCase().replace(/\s+/g, '-')));
      const tBadge = typeBadge(fields.issuetype?.name);
      const pBadge = priorityBadge(fields.priority?.name);
      if (tBadge) head.append(tBadge);
      if (pBadge) head.append(pBadge);
      children.push(
        el('h2', {}, fields.summary || '(no summary)'),
        metaList([
          ['Assignee', fields.assignee?.displayName || 'Unassigned'],
          ['Reporter', fields.reporter?.displayName],
          ['Updated', fmtDate(fields.updated)],
        ]),
        snippet(typeof fields.description === 'string' ? fields.description : '')
      );
    } else {
      children.push(el('h2', {}, 'Jira issue'));
      if (error) children.push(el('div', { class: 'error' }, error));
    }

    children.push(openLink(url, 'Open in Jira ↗'));
    setCard(el('div', { class: 'card' }, children));
  }

  function renderGithub(match, issue, pull, error) {
    const ref = `${match.owner}/${match.repo}#${match.number}`;
    const url = pull?.html_url || issue?.html_url || match.url;

    const head = el('div', { class: 'card-head' }, [
      el('a', { class: 'ref', href: url, target: '_blank', rel: 'noreferrer' }, ref),
    ]);

    const children = [head];

    if (issue || pull) {
      const data = pull || issue;
      let state = data.state; // open | closed
      let variant = state;
      if (pull) {
        if (pull.merged_at) { state = 'merged'; variant = 'merged'; }
        else if (pull.draft && state === 'open') { state = 'draft'; variant = ''; }
      }
      head.append(badge(state, variant));
      head.append(
        pull || issue?.pull_request
          ? badge('Pull request', 't-purple')
          : badge('Issue', 't-teal')
      );

      const labels = (data.labels || [])
        .map((l) => (typeof l === 'string' ? { name: l } : l))
        .filter((l) => l.name);

      children.push(
        el('h2', {}, data.title || '(no title)'),
        metaList([
          ['Author', data.user?.login],
          ['Assignee', (data.assignees || []).map((a) => a.login).join(', ') || null],
          ['Branch', pull ? `${pull.head?.label} → ${pull.base?.label}` : null],
          ['Comments', data.comments != null ? String(data.comments) : null],
          ['Updated', fmtDate(data.updated_at)],
        ]),
        labels.length
          ? el('div', { class: 'labels' }, labels.map((l) => coloredLabelChip(l.name, l.color)))
          : null,
        snippet(data.body || '')
      );
    } else {
      children.push(el('h2', {}, 'GitHub reference'));
      if (error) children.push(el('div', { class: 'error' }, error));
    }

    children.push(openLink(url, 'Open on GitHub ↗'));
    setCard(el('div', { class: 'card' }, children));
  }

  function renderUrl(match) {
    let host = '';
    try { host = new URL(match.url).hostname; } catch { /* ignore */ }
    setCard(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [badge('link', ''), host]),
      openLink(match.url),
    ]));
  }

  /* ------------------------------ fetchers ------------------------------- */

  async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? ' (check the credentials in config.json)'
        : '';
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    return res.json();
  }

  async function showJira(match, seq) {
    const base = (config?.jira?.baseUrl || '').replace(/\/+$/, '');
    if (!base || base.includes('jira.example.com')) {
      renderJira(match, null, 'Set jira.baseUrl in config.json to fetch details.');
      return;
    }
    renderJira(match, null, null);
    try {
      const issue = await fetchJson(
        `${base}/rest/api/2/issue/${encodeURIComponent(match.key)}`,
        jiraAuthHeaders()
      );
      if (seq === requestSeq) renderJira(match, issue, null);
    } catch (e) {
      if (seq === requestSeq) renderJira(match, null, `Could not fetch issue: ${e.message}`);
    }
  }

  async function showGithub(match, seq) {
    renderGithub(match, null, null, null);
    const apiBase = `https://api.github.com/repos/${match.owner}/${match.repo}`;
    try {
      // The issues endpoint answers for both issues and PRs.
      const issue = await fetchJson(`${apiBase}/issues/${match.number}`, githubAuthHeaders());
      let pull = null;
      if (issue.pull_request) {
        try {
          pull = await fetchJson(`${apiBase}/pulls/${match.number}`, githubAuthHeaders());
        } catch { /* fall back to issue data */ }
      }
      if (seq === requestSeq) renderGithub(match, issue, pull, null);
    } catch (e) {
      if (seq === requestSeq) renderGithub(match, null, null, `Could not fetch: ${e.message}`);
    }
  }

  /* ----------------------------- match entry ----------------------------- */

  function allowedByProjectFilter(match) {
    if (match.kind !== 'jira') return true;
    const allowed = config?.jira?.projectKeys || [];
    return !allowed.length || allowed.includes(match.project);
  }

  function renderAlternates(activeRaw) {
    altsEl.replaceChildren();
    const others = currentAlternates.filter((m) => allowedByProjectFilter(m));
    altsEl.hidden = !others.length;
    if (!others.length) return;
    altsEl.append('Also detected: ');
    for (const alt of others) {
      const chip = el(
        'button',
        { class: `alt-chip${alt.raw === activeRaw ? ' active' : ''}`, type: 'button' },
        alt.raw
      );
      chip.addEventListener('click', () => showMatch(alt));
      altsEl.append(chip);
    }
  }

  function showMatch(match) {
    const seq = ++requestSeq;
    setStatus(`Detected ${match.raw}${match.at ? ` · ${new Date(match.at).toLocaleTimeString()}` : ''}`);
    renderAlternates(match.raw);

    if (match.kind === 'jira') showJira(match, seq);
    else if (match.kind === 'github') showGithub(match, seq);
    else renderUrl(match);
  }

  function handleMatch(match, { force = false } = {}) {
    if (!match) return;

    const alternates = (match.alternates || []).filter((m) => allowedByProjectFilter(m));
    let primary = match;
    if (!allowedByProjectFilter(primary)) {
      // Fall back to the first alternate that passes the project filter
      primary = alternates.shift();
      if (!primary) return;
    }

    const signature = [primary, ...alternates].map((m) => m.raw).join('|');
    if (!force && signature === currentSignature) return;
    currentSignature = signature;
    currentAlternates = alternates;

    showMatch({ ...primary, at: primary.at ?? match.at });
  }

  /* -------------------------------- init --------------------------------- */

  async function init() {
    try {
      config = await loadConfig();
    } catch (e) {
      setStatus(`Failed to load config.json: ${e.message}`);
      config = {};
    }

    const stored = await api.storage.local.get({ following: true, lastMatch: null });
    following = stored.following;
    renderToggle();
    if (stored.lastMatch) handleMatch(stored.lastMatch);

    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.following) {
        following = changes.following.newValue;
        renderToggle();
      }
      if (changes.lastMatch?.newValue && following) {
        handleMatch(changes.lastMatch.newValue);
      }
    });

    toggleBtn.addEventListener('click', () => {
      api.storage.local.set({ following: !following });
    });

    tryForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const [primary, ...rest] = findAllMatches(tryInput.value.trim());
      if (primary) {
        const alternates = rest.filter((m) => m.kind === 'jira' || m.kind === 'github');
        handleMatch({ ...primary, alternates }, { force: true });
      } else {
        setStatus('No Jira key, GitHub reference, or URL found in input.');
      }
    });
  }

  init();
})();
