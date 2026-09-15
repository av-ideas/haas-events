/* Professional Events Tracker: cohort event dashboard.
   Data lives in Supabase (events, rsvps, feed_meta); without config it runs on example data. */
(() => {
  'use strict';

  const CFG = Object.assign(
    { supabaseUrl: '', supabaseAnonKey: '', cohortLabel: 'Berkeley Haas EWMBA' },
    window.WW_CONFIG || {}
  );
  const DEMO = !CFG.supabaseUrl || !CFG.supabaseAnonKey;
  const TZ = 'America/Los_Angeles';
  const DAY = 86400000;
  const HOUR = 3600000;

  // ---------- Taxonomies (must match what the daily refresh writes) ----------
  const SOURCES = {
    'bear-necessities': 'Bear Necessities',
    newsletter: 'Haas newsletters',
    slack: 'Slack',
    'campus-groups': 'Haas Campus Groups',
    'haas-alumni': 'Haas Alumni',
    'bay-area': 'Bay Area public',
  };
  const CATEGORIES = {
    academic: 'Academic',
    career: 'Career development',
    hiring: 'Hiring & recruiting',
    tour: 'Industry tours & treks',
    club: 'Clubs',
    speaker: 'Speakers & panels',
    networking: 'Networking',
    social: 'Social',
    startup: 'Startups & VC',
    conference: 'Conferences',
    community: 'Community & service',
    wellness: 'Wellness & sports',
    admin: 'Deadlines & admin',
  };
  const AUDIENCES = { ewmba: 'EWMBA only', haas: 'All Haas', berkeley: 'UC Berkeley', public: 'Open to public' };
  const TIMINGS = { weeknight: 'Weeknights, 5pm+', weekend: 'Weekends', daytime: 'Weekday daytime' };
  const FORMATS = { 'in-person': 'In person', virtual: 'Virtual', hybrid: 'Hybrid' };
  const REGIONS = {
    berkeley: 'Berkeley campus',
    'east-bay': 'East Bay',
    sf: 'San Francisco',
    peninsula: 'Peninsula',
    'south-bay': 'South Bay',
    'north-bay': 'North Bay',
    online: 'Online',
  };
  const WHEN = { week: 'Next 7 days', fortnight: 'Next 14 days', month: 'Next 30 days', upcoming: 'All upcoming', past: 'Past', custom: 'Custom' };
  const WHEN_DAYS = { week: 7, fortnight: 14, month: 30 };
  const APP_VERSION = '2026-09-12';

  // Keep the last few script errors so bug reports can include them.
  const recentErrors = [];
  const noteError = msg => { recentErrors.push(`${new Date().toISOString()} ${String(msg).slice(0, 300)}`); if (recentErrors.length > 5) recentErrors.shift(); };
  window.addEventListener('error', ev => noteError(`${ev.message} @ ${ev.filename}:${ev.lineno}`));
  window.addEventListener('unhandledrejection', ev => noteError(`unhandled: ${ev.reason && (ev.reason.message || ev.reason)}`));

  const FACETS = [
    { key: 'source', label: 'Source', options: SOURCES, get: e => e.source, swatch: true, open: true },
    { key: 'category', label: 'Category', options: CATEGORIES, get: e => e.category, open: true },
    { key: 'audience', label: 'Who it’s for', options: AUDIENCES, get: e => e.audience },
    { key: 'timing', label: 'When it happens', options: TIMINGS, get: e => e.timing, open: true },
    { key: 'region', label: 'Area', options: REGIONS, get: e => e.region },
    { key: 'format', label: 'Format', options: FORMATS, get: e => e.format },
  ];
  const TOGGLES = {
    mine: 'I’m going',
    cohort: 'Cohort mates going',
    free: 'Free',
    rsvp: 'RSVP required',
    deadline: 'RSVP closes within 3 days',
  };

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function pt(d) {
    const o = {};
    for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
    return { key: `${o.year}-${o.month}-${o.day}`, h: +o.hour % 24, min: +o.minute };
  }
  const keyToUTC = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (k, n) => { const d = keyToUTC(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekday = k => keyToUTC(k).getUTCDay();
  const todayKey = () => pt(new Date()).key;
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fmtTime = d => timeFmt.format(d).replace(':00', '').replace(' ', '\u202f');
  const fmtKey = (k, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(keyToUTC(k));
  const fmtDate = (d, opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(d);

  function initials(name) {
    const parts = String(name || '?').replace(/\(.*?\)/g, '').replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- State ----------
  const saved = store.get('ww-filters', {});
  const state = {
    q: '',
    when: WHEN[saved.when] ? saved.when : 'fortnight',
    from: saved.from || '',
    to: saved.to || '',
    facets: Object.fromEntries(FACETS.map(f => [f.key, new Set((saved.facets && saved.facets[f.key]) || [])])),
    toggles: new Set(saved.toggles || []),
    sort: saved.sort === 'popular' ? 'popular' : 'date',
  };
  function persist() {
    store.set('ww-filters', {
      when: state.when, from: state.from, to: state.to, sort: state.sort,
      toggles: [...state.toggles],
      facets: Object.fromEntries(FACETS.map(f => [f.key, [...state.facets[f.key]]])),
    });
  }

  let events = [];          // normalized
  let rsvps = new Map();    // event_id -> [{user_id, display_name}]
  let me = null;            // {id, name, email}
  let api = null;
  const expanded = new Set();

  // ---------- Normalization ----------
  function normalize(raw) {
    const start = new Date(raw.starts_at);
    if (isNaN(start)) return null;
    let end = raw.ends_at ? new Date(raw.ends_at) : null;
    if (!end || isNaN(end) || end < start) end = new Date(start.getTime() + (raw.all_day ? DAY - 60000 : HOUR));
    const p = pt(start);
    const wd = weekday(p.key);
    const timing = wd === 0 || wd === 6 ? 'weekend' : raw.all_day ? 'daytime' : p.h >= 17 ? 'weeknight' : 'daytime';
    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    return {
      ...raw, tags, start, end, timing,
      startKey: p.key,
      endKey: pt(new Date(end.getTime() - 1)).key,
      deadline: raw.rsvp_deadline ? new Date(raw.rsvp_deadline) : null,
      text: [raw.title, raw.description, raw.location, raw.source_detail, SOURCES[raw.source], CATEGORIES[raw.category], ...tags]
        .join(' ').toLowerCase(),
    };
  }

  // ---------- Filtering ----------
  const goingList = id => rsvps.get(id) || [];
  const iAmGoing = id => !!me && goingList(id).some(r => r.user_id === me.id);

  function passesWhen(e, now = Date.now()) {
    const today = todayKey();
    switch (state.when) {
      case 'past': return e.end.getTime() < now;
      case 'upcoming': return e.end.getTime() >= now;
      case 'custom': {
        if (state.from && e.endKey < state.from) return false;
        if (state.to && e.startKey > state.to) return false;
        return true;
      }
      default: return e.end.getTime() >= now && e.startKey <= addDays(today, WHEN_DAYS[state.when] - 1);
    }
  }

  function passes(e, { skipFacet = null, skipWhen = false } = {}) {
    if (!skipWhen && !passesWhen(e)) return false;
    const q = state.q.trim().toLowerCase();
    if (q && !q.split(/\s+/).every(w => e.text.includes(w))) return false;
    for (const f of FACETS) {
      if (f.key === skipFacet) continue;
      const sel = state.facets[f.key];
      if (sel.size && !sel.has(f.get(e))) return false;
    }
    const t = state.toggles;
    if (t.has('mine') && !iAmGoing(e.id)) return false;
    if (t.has('cohort') && !goingList(e.id).some(r => !me || r.user_id !== me.id)) return false;
    if (t.has('free') && !/^\s*free/i.test(e.cost || '')) return false;
    if (t.has('rsvp') && !e.rsvp_required) return false;
    if (t.has('deadline')) {
      const d = e.deadline;
      if (!d || d.getTime() < Date.now() || d.getTime() > Date.now() + 3 * DAY) return false;
    }
    return true;
  }

  // ---------- Rendering: filter rail ----------
  function buildRail() {
    $('#when').innerHTML = Object.entries(WHEN).map(([k, v]) =>
      `<label><input type="radio" name="when" value="${k}" ${state.when === k ? 'checked' : ''}>${esc(v)}</label>`).join('');
    $('#custom-range').hidden = state.when !== 'custom';
    $('#from').value = state.from;
    $('#to').value = state.to;

    $('#toggles').innerHTML = Object.entries(TOGGLES).map(([k, v]) =>
      `<label class="opt" data-toggle-row="${k}"><input type="checkbox" data-toggle="${k}" ${state.toggles.has(k) ? 'checked' : ''}><span class="sw none"></span><span class="name">${esc(v)}</span><span class="n"></span></label>`).join('');

    const openState = store.get('ww-open', {});
    $('#facets').innerHTML = FACETS.map(f => `
      <details class="facet" data-facet-box="${f.key}" ${(openState[f.key] ?? f.open) ? 'open' : ''}>
        <summary>${esc(f.label)}<span class="sel-n"></span></summary>
        <div class="opts">
          ${Object.entries(f.options).map(([k, v]) => `
            <label class="opt" data-row="${f.key}:${k}">
              <input type="checkbox" data-facet="${f.key}" value="${k}" ${state.facets[f.key].has(k) ? 'checked' : ''}>
              <span class="sw ${f.swatch ? 'src-' + k : 'none'}"></span>
              <span class="name">${esc(v)}</span>
              <span class="n"></span>
            </label>`).join('')}
        </div>
      </details>`).join('');
  }

  function updateRailCounts() {
    for (const f of FACETS) {
      const counts = {};
      const exists = new Set(events.map(f.get));
      for (const e of events) if (passes(e, { skipFacet: f.key })) { const v = f.get(e); counts[v] = (counts[v] || 0) + 1; }
      for (const k of Object.keys(f.options)) {
        const row = document.querySelector(`[data-row="${f.key}:${k}"]`);
        const n = counts[k] || 0;
        row.querySelector('.n').textContent = n;
        row.classList.toggle('zero', n === 0);
        // Hide options no event in the feed uses (e.g. Slack while it's unavailable), unless selected.
        row.hidden = !exists.has(k) && !state.facets[f.key].has(k);
      }
      const box = document.querySelector(`[data-facet-box="${f.key}"] .sel-n`);
      box.textContent = state.facets[f.key].size ? `${state.facets[f.key].size} selected` : '';
    }
    // Toggle counts: how many would remain if this toggle were switched on.
    for (const k of Object.keys(TOGGLES)) {
      const had = state.toggles.has(k);
      state.toggles.add(k);
      const n = events.filter(e => passes(e)).length;
      if (!had) state.toggles.delete(k);
      const row = document.querySelector(`[data-toggle-row="${k}"]`);
      row.querySelector('.n').textContent = n;
      row.classList.toggle('zero', n === 0);
    }
  }

  function activeFilterChips() {
    const chips = [];
    if (state.q.trim()) chips.push({ label: `“${state.q.trim()}”`, clear: () => { state.q = ''; $('#q').value = ''; } });
    if (state.when === 'custom' && (state.from || state.to)) {
      const f = state.from ? fmtKey(state.from, { month: 'short', day: 'numeric' }) : '…';
      const t = state.to ? fmtKey(state.to, { month: 'short', day: 'numeric' }) : '…';
      chips.push({ label: `${f} – ${t}`, clear: () => { state.when = 'fortnight'; state.from = state.to = ''; } });
    }
    for (const k of state.toggles) chips.push({ label: TOGGLES[k], clear: () => state.toggles.delete(k) });
    for (const f of FACETS) for (const v of state.facets[f.key]) chips.push({ label: f.options[v], clear: () => state.facets[f.key].delete(v) });
    return chips;
  }

  // ---------- Rendering: main ----------
  function render() {
    const now = Date.now();
    const list = events.filter(e => passes(e));
    if (state.sort === 'popular') {
      list.sort((a, b) => goingList(b.id).length - goingList(a.id).length || a.start - b.start);
    } else if (state.when === 'past') {
      list.sort((a, b) => b.start - a.start);
    } else {
      list.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    }

    // Result line
    const withCohort = list.filter(e => goingList(e.id).length).length;
    const rangeLabel = state.when === 'custom' ? 'in your date range' : WHEN[state.when].toLowerCase();
    $('#result-line').innerHTML =
      `<strong>${list.length}</strong> event${list.length === 1 ? '' : 's'} &middot; ${esc(rangeLabel)}` +
      (withCohort ? ` &middot; ${withCohort} with cohort mates going` : '');

    // Active chips
    const chips = activeFilterChips();
    const chipBox = $('#active-chips');
    chipBox.innerHTML = chips.map((c, i) => `<button type="button" class="achip" data-chip="${i}" aria-label="Remove filter ${esc(c.label)}">${esc(c.label)}<span aria-hidden="true">&times;</span></button>`).join('');
    chipBox._chips = chips;
    const nActive = chips.length;
    $('#filters-n').textContent = nActive ? `(${nActive})` : '';

    renderFortnight();
    updateRailCounts();

    const agenda = $('#agenda');
    if (!list.length) {
      const anyFilters = nActive > 0;
      agenda.innerHTML = `<div class="empty-state">
        <h3>${anyFilters ? 'Nothing matches those filters' : 'No events in this range yet'}</h3>
        <p>${anyFilters ? 'Try removing a filter or widening the date range.' : 'The feed refreshes every morning. Try “All upcoming” to look further ahead.'}</p>
        ${anyFilters ? '<button type="button" class="btn-quiet" data-action="clear">Clear all filters</button>' : '<button type="button" class="btn-quiet" data-action="all-upcoming">Show all upcoming</button>'}
      </div>`;
      return;
    }

    if (state.sort === 'popular') {
      agenda.innerHTML = `<section class="day"><div class="stamp"><span class="dow">Ranked</span><span class="dnum">&#8599;</span><span class="mon">by going</span></div><div class="day-list">${list.map(e => evHTML(e, true)).join('')}</div></section>`;
      return;
    }

    const groups = [];
    for (const e of list) {
      const k = state.when === 'past' ? e.startKey : (e.startKey < todayKey() && e.end.getTime() >= now ? todayKey() : e.startKey);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) groups.push(g = { key: k, items: [] });
      g.items.push(e);
    }
    const today = todayKey();
    agenda.innerHTML = groups.map(g => {
      const wd = weekday(g.key);
      const rel = g.key === today ? 'Today' : g.key === addDays(today, 1) ? 'Tomorrow' : '';
      return `<section class="day ${wd === 0 || wd === 6 ? 'wkend' : ''}" id="day-${g.key}">
        <div class="stamp">
          <span class="dow">${fmtKey(g.key, { weekday: 'short' })}</span>
          <span class="dnum">${fmtKey(g.key, { day: 'numeric' })}</span>
          <span class="mon">${fmtKey(g.key, { month: 'short' })}</span>
          ${rel ? `<span class="rel">${rel}</span>` : ''}
        </div>
        <div class="day-list">${g.items.map(e => evHTML(e, false)).join('')}</div>
      </section>`;
    }).join('');
  }

  function evHTML(e, showDate) {
    const going = goingList(e.id);
    const mine = iAmGoing(e.id);
    const others = going.filter(r => !me || r.user_id !== me.id);
    const ordered = mine ? [going.find(r => r.user_id === me.id), ...others] : others;

    let t1, t2 = '';
    if (e.all_day) {
      t1 = 'All day';
      if (e.endKey !== e.startKey) t2 = `through ${fmtKey(e.endKey, { month: 'short', day: 'numeric' })}`;
    } else {
      t1 = fmtTime(e.start);
      t2 = e.endKey !== e.startKey
        ? `to ${fmtDate(e.end, { month: 'short', day: 'numeric' })}`
        : `to ${fmtTime(e.end)}`;
    }
    const dateLine = showDate ? `<span class="when-date">${fmtKey(e.startKey, { weekday: 'short', month: 'short', day: 'numeric' })}</span>` : '';

    const where = [];
    if (e.location) where.push(esc(e.location));
    if (e.region && REGIONS[e.region] && !(e.location || '').toLowerCase().includes(REGIONS[e.region].toLowerCase())) where.push(esc(REGIONS[e.region]));
    if (e.format && e.format !== 'in-person' && !(e.format === 'virtual' && e.region === 'online')) where.push(esc(FORMATS[e.format] || e.format));
    if (e.cost) where.push(esc(e.cost));

    const tags = [`<span class="chip src src-${esc(e.source)}">${esc(SOURCES[e.source] || e.source)}</span>`];
    if (e.category && CATEGORIES[e.category]) tags.push(`<span class="chip">${esc(CATEGORIES[e.category])}</span>`);
    if (e.audience === 'ewmba') tags.push('<span class="chip aud-ewmba">EWMBA</span>');
    for (const t of e.tags.slice(0, 3)) tags.push(`<span class="chip tag">${esc(t)}</span>`);
    if (e.deadline && e.deadline.getTime() > Date.now()) {
      const soon = e.deadline.getTime() - Date.now() < 3 * DAY;
      tags.push(`<span class="chip ${soon ? 'warn' : ''}">RSVP by ${fmtDate(e.deadline, { month: 'short', day: 'numeric' })}</span>`);
    } else if (e.rsvp_required) {
      tags.push('<span class="chip">RSVP required</span>');
    }

    const avs = ordered.slice(0, 4).map(r => `<span class="av ${me && r.user_id === me.id ? 'me' : ''}" title="${esc(r.display_name)}">${esc(initials(r.display_name))}</span>`).join('');
    let gtxt;
    if (!going.length) gtxt = 'No one yet';
    else if (mine && !others.length) gtxt = 'Just you so far';
    else if (mine) gtxt = `You + ${others.length} cohort mate${others.length === 1 ? '' : 's'}`;
    else gtxt = `${going.length} going`;
    const names = going.map(r => r.display_name).join(', ');

    const titleInner = e.url
      ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>`
      : `<span>${esc(e.title)}</span>`;
    const open = expanded.has(e.id);

    return `<article class="ev ${mine ? 'is-going' : ''}" id="ev-${esc(e.id)}" data-id="${esc(e.id)}">
      <div class="ev-time">${dateLine}<span class="t1">${t1}</span>${t2 ? `<span class="t2">${t2}</span>` : ''}</div>
      <div class="ev-body">
        <div class="ev-tags">${tags.join('')}</div>
        <h3 class="ev-title">${titleInner}</h3>
        ${where.length ? `<p class="ev-where">${where.join('<span class="sep">/</span>')}</p>` : ''}
        <div class="ev-actions">
          <span class="going-stack ${going.length ? '' : 'none'}" ${names ? `title="${esc(names)}"` : ''}>
            ${avs ? `<span class="avs">${avs}</span>` : ''}<span class="gtxt">${gtxt}</span>
          </span>
          <button type="button" class="btn-going" data-action="going" aria-pressed="${mine}">${mine ? '&#10003; Going' : 'I’m going'}</button>
          <span class="act-links">
            ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Event page&nbsp;&#8599;</a>` : ''}
            <button type="button" data-action="ics" title="Download a calendar file for Apple Calendar, Outlook, or Google">.ics</button>
            <a href="${esc(gcalLink(e))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
            <button type="button" class="more" data-action="more" aria-expanded="${open}">${open ? 'Hide details' : 'Details'}</button>
          </span>
        </div>
        <div class="ev-more" ${open ? '' : 'hidden'}>
          ${e.description ? `<p>${esc(e.description)}</p>` : '<p class="kv">No description in the original announcement.</p>'}
          ${going.length ? `<div class="who">${ordered.map(r => `<span><span class="av ${me && r.user_id === me.id ? 'me' : ''}">${esc(initials(r.display_name))}</span>${esc(r.display_name)}</span>`).join('')}</div>` : ''}
          <p class="kv">From ${esc(SOURCES[e.source] || e.source)}${e.source_detail ? ` &middot; ${esc(e.source_detail)}` : ''}${e.audience && AUDIENCES[e.audience] ? ` &middot; ${esc(AUDIENCES[e.audience])}` : ''}</p>
          <p class="kv"><button type="button" class="link-btn" data-action="report">Report a problem with this event</button></p>
        </div>
      </div>
    </article>`;
  }

  function renderFortnight() {
    const today = todayKey();
    const now = Date.now();
    const pool = events.filter(e => e.end.getTime() >= now && passes(e, { skipWhen: true }));
    const cells = [];
    for (let i = 0; i < 14; i++) {
      const k = addDays(today, i);
      const dayEvents = pool.filter(e => e.startKey <= k && e.endKey >= k);
      const n = dayEvents.length;
      const goingN = dayEvents.filter(e => goingList(e.id).length).length;
      const bars = Array.from({ length: Math.min(n, 6) }, (_, j) => {
        const h = 6 + Math.round(10 * Math.min(1, (j + 1) / 6));
        return `<i class="${j < goingN ? 'going' : ''}" style="height:${h}px"></i>`;
      }).join('');
      const wd = weekday(k);
      cells.push(`<button type="button" class="fd ${wd === 0 || wd === 6 ? 'wkend' : ''} ${k === today ? 'today' : ''} ${n ? '' : 'empty'}" data-day="${k}"
        aria-label="${fmtKey(k, { weekday: 'long', month: 'long', day: 'numeric' })}: ${n} event${n === 1 ? '' : 's'}">
        <span class="dow">${k === today ? 'Today' : fmtKey(k, { weekday: 'short' })}</span>
        <span class="dnum">${fmtKey(k, { day: 'numeric' })}</span>
        <span class="bars">${bars}</span>
        <span class="cnt">${n ? n : '–'}</span>
      </button>`);
    }
    $('#fortnight').innerHTML = cells.join('');
  }

  // ---------- Calendar output ----------
  const icsStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const out = [];
    let s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
    out.push(s);
    return out.join('\r\n');
  }
  function eventDetails(e) {
    return [e.description, e.url, `Source: ${SOURCES[e.source] || e.source}${e.source_detail ? ' (' + e.source_detail + ')' : ''}`]
      .filter(Boolean).join('\n\n');
  }
  function buildICS(list) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Professional Events Tracker//Haas EWMBA//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const stamp = icsStamp(new Date());
    for (const e of list) {
      L.push('BEGIN:VEVENT', `UID:${e.id}@professional-events-tracker`, `DTSTAMP:${stamp}`);
      if (e.all_day) {
        L.push(`DTSTART;VALUE=DATE:${e.startKey.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(e.endKey, 1).replace(/-/g, '')}`);
      } else {
        L.push(`DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(e.end)}`);
      }
      L.push(`SUMMARY:${icsEsc(e.title)}`);
      if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
      L.push(`DESCRIPTION:${icsEsc(eventDetails(e))}`);
      if (e.url) L.push(`URL:${e.url}`);
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function downloadICS(list, name) {
    const blob = new Blob([buildICS(list)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function gcalLink(e) {
    const dates = e.all_day
      ? `${e.startKey.replace(/-/g, '')}/${addDays(e.endKey, 1).replace(/-/g, '')}`
      : `${icsStamp(e.start)}/${icsStamp(e.end)}`;
    const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: eventDetails(e), location: e.location || '' });
    return `https://calendar.google.com/calendar/render?${p}`;
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event';

  // ---------- Interactions ----------
  function rerender() { persist(); render(); }

  function wire() {
    let qTimer;
    $('#q').addEventListener('input', ev => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = ev.target.value; render(); }, 120);
    });
    $('#when').addEventListener('change', ev => {
      state.when = ev.target.value;
      $('#custom-range').hidden = state.when !== 'custom';
      if (state.when === 'custom' && !state.from) { state.from = todayKey(); $('#from').value = state.from; }
      rerender();
    });
    $('#from').addEventListener('change', ev => { state.from = ev.target.value; rerender(); });
    $('#to').addEventListener('change', ev => { state.to = ev.target.value; rerender(); });
    $('#toggles').addEventListener('change', ev => {
      const k = ev.target.dataset.toggle;
      ev.target.checked ? state.toggles.add(k) : state.toggles.delete(k);
      rerender();
    });
    $('#facets').addEventListener('change', ev => {
      const f = ev.target.dataset.facet;
      if (!f) return;
      ev.target.checked ? state.facets[f].add(ev.target.value) : state.facets[f].delete(ev.target.value);
      rerender();
    });
    $('#facets').addEventListener('toggle', ev => {
      const box = ev.target.closest('[data-facet-box]');
      if (!box) return;
      const o = store.get('ww-open', {});
      o[box.dataset.facetBox] = box.open;
      store.set('ww-open', o);
    }, true);
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', ev => { state.sort = ev.target.value; rerender(); });
    $('#clear-btn').addEventListener('click', clearAll);
    $('#active-chips').addEventListener('click', ev => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      $('#active-chips')._chips[+b.dataset.chip].clear();
      buildRail();
      rerender();
    });
    $('#export-btn').addEventListener('click', () => {
      const list = events.filter(e => passes(e)).sort((a, b) => a.start - b.start);
      if (!list.length) return toast('No events in this view to export.');
      downloadICS(list, `haas-events-${todayKey()}.ics`);
      toast(`Downloaded ${list.length} event${list.length === 1 ? '' : 's'} as one .ics file.`);
    });
    $('#fortnight').addEventListener('click', ev => {
      const b = ev.target.closest('[data-day]');
      if (!b) return;
      const k = b.dataset.day;
      if (!['fortnight', 'month', 'upcoming'].includes(state.when) || state.sort !== 'date') {
        state.when = 'fortnight'; state.sort = 'date'; $('#sort').value = 'date'; buildRail(); rerender();
      }
      const target = document.getElementById(`day-${k}`);
      if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      else toast(`Nothing on ${fmtKey(k, { weekday: 'long', month: 'short', day: 'numeric' })} with your current filters.`);
    });
    $('#agenda').addEventListener('click', onAgendaClick);

    // Mobile filter drawer
    const openRail = on => { $('#rail').classList.toggle('open', on); $('#scrim').hidden = !on; };
    $('#filters-btn').addEventListener('click', () => openRail(true));
    $('#rail-close').addEventListener('click', () => openRail(false));
    $('#scrim').addEventListener('click', () => openRail(false));
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { openRail(false); $('#user-pop').hidden = true; } });

    // User menu
    $('#user-btn').addEventListener('click', ev => {
      ev.stopPropagation();
      const pop = $('#user-pop');
      pop.hidden = !pop.hidden;
      $('#user-btn').setAttribute('aria-expanded', String(!pop.hidden));
    });
    document.addEventListener('click', ev => { if (!ev.target.closest('#usermenu')) $('#user-pop').hidden = true; });
    $('#rename-btn').addEventListener('click', () => {
      $('#user-pop').hidden = true;
      $('#rename-input').value = me ? me.name : '';
      $('#rename-dlg').showModal();
    });
    $('#rename-cancel').addEventListener('click', () => $('#rename-dlg').close());
    $('#rename-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const name = $('#rename-input').value.trim().slice(0, 40);
      if (!name) return;
      $('#rename-dlg').close();
      try {
        await api.rename(name);
        me.name = name;
        for (const list of rsvps.values()) for (const r of list) if (r.user_id === me.id) r.display_name = name;
        paintUser();
        render();
        toast('Display name saved.');
      } catch (err) {
        toast(`Couldn’t save your name: ${err.message || err}`);
      }
    });
    $('#signout-btn').addEventListener('click', () => api.signOut());

    // Bug reports
    $('#report-btn').addEventListener('click', () => openReport(null));
    $('#report-cancel').addEventListener('click', () => $('#report-dlg').close());
    $('#report-form').addEventListener('change', ev => {
      if (ev.target.name === 'kind') $('#report-event').hidden = ev.target.value !== 'event' || !reportEventId;
    });
    $('#report-form').addEventListener('submit', submitReport);
  }

  let reportEventId = null;
  function openReport(e) {
    reportEventId = e ? e.id : null;
    const form = $('#report-form');
    form.reset();
    form.querySelector(`input[name="kind"][value="${e ? 'event' : 'bug'}"]`).checked = true;
    $('#report-event').hidden = !e;
    $('#report-event').textContent = e ? `About: ${e.title} (${fmtKey(e.startKey, { month: 'short', day: 'numeric' })})` : '';
    $('#report-status').textContent = '';
    $('#report-dlg').showModal();
    $('#report-msg').focus();
  }

  async function submitReport(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const kind = form.querySelector('input[name="kind"]:checked').value;
    const message = $('#report-msg').value.trim();
    const status = $('#report-status');
    if (message.length < 5) { status.textContent = 'Add a few words about what happened.'; return; }
    const report = {
      kind,
      message: message.slice(0, 2000),
      event_id: kind === 'event' ? reportEventId : null,
      page_url: (location.origin + location.pathname).slice(0, 500),
      user_agent: navigator.userAgent.slice(0, 500),
      viewport: `${innerWidth}x${innerHeight}`,
      app_state: {
        version: APP_VERSION,
        filters: {
          q: state.q, when: state.when, from: state.from, to: state.to, sort: state.sort,
          toggles: [...state.toggles],
          facets: Object.fromEntries(FACETS.map(f => [f.key, [...state.facets[f.key]]])),
        },
        events_loaded: events.length,
        events_shown: events.filter(x => passes(x)).length,
        theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        recent_errors: recentErrors.slice(),
      },
    };
    const btn = $('#report-send');
    btn.disabled = true;
    status.textContent = 'Sending…';
    try {
      await api.report(report);
      $('#report-dlg').close();
      toast('Report sent. Thanks for flagging it.');
    } catch (err) {
      status.textContent = `Couldn’t send your report: ${err.message || err}`;
    } finally {
      btn.disabled = false;
    }
  }

  function clearAll() {
    state.q = ''; $('#q').value = '';
    state.when = 'fortnight'; state.from = state.to = '';
    state.toggles.clear();
    for (const f of FACETS) state.facets[f.key].clear();
    buildRail();
    rerender();
  }

  async function onAgendaClick(ev) {
    const actionEl = ev.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'clear') return clearAll();
    if (action === 'all-upcoming') { state.when = 'upcoming'; buildRail(); return rerender(); }
    const card = actionEl.closest('[data-id]');
    const e = card && events.find(x => x.id === card.dataset.id);
    if (!e) return;

    if (action === 'report') {
      openReport(e);
    } else if (action === 'more') {
      expanded.has(e.id) ? expanded.delete(e.id) : expanded.add(e.id);
      const more = card.querySelector('.ev-more');
      more.hidden = !expanded.has(e.id);
      actionEl.setAttribute('aria-expanded', String(expanded.has(e.id)));
      actionEl.textContent = expanded.has(e.id) ? 'Hide details' : 'Details';
    } else if (action === 'ics') {
      downloadICS([e], `${slug(e.title)}.ics`);
    } else if (action === 'going') {
      const on = !iAmGoing(e.id);
      const before = goingList(e.id).slice();
      // Optimistic update
      const next = before.filter(r => r.user_id !== me.id);
      if (on) next.push({ user_id: me.id, display_name: me.name });
      rsvps.set(e.id, next);
      render();
      try {
        await api.setGoing(e.id, on);
        toast(on ? `You’re going to “${e.title}”. Cohort mates can see it.` : 'Removed your RSVP.');
      } catch (err) {
        rsvps.set(e.id, before);
        render();
        toast(`Couldn’t update your RSVP: ${err.message || err}`);
      }
    }
  }

  function paintUser() {
    if (!me) return;
    $('#usermenu').hidden = false;
    $('#report-btn').hidden = false;
    $('#user-btn').innerHTML = `<span class="av me">${esc(initials(me.name))}</span>${esc(me.name.split(' ')[0])}`;
    $('#user-email').textContent = me.email || '';
  }

  function paintUpdated(meta) {
    const el = $('#updated');
    if (DEMO) { el.textContent = 'Example data'; return; }
    if (!meta || !meta.refreshed_at) { el.textContent = 'Waiting for first refresh'; return; }
    const d = new Date(meta.refreshed_at);
    const k = pt(d).key;
    const day = k === todayKey() ? 'today' : k === addDays(todayKey(), -1) ? 'yesterday' : fmtDate(d, { month: 'short', day: 'numeric' });
    el.textContent = `Updated ${day}, ${fmtTime(d)}`;
    if (meta.summary) el.title = meta.summary;
  }

  async function loadAll() {
    const [rawEvents, rows, meta] = await Promise.all([api.events(), api.rsvps(), api.meta()]);
    events = rawEvents.map(normalize).filter(Boolean);
    setRsvps(rows);
    paintUpdated(meta);
  }
  function setRsvps(rows) {
    rsvps = new Map();
    for (const r of rows) {
      if (!rsvps.has(r.event_id)) rsvps.set(r.event_id, []);
      rsvps.get(r.event_id).push({ user_id: r.user_id, display_name: r.display_name });
    }
  }

  // ---------- Data: example mode ----------
  function demoApi() {
    const KEY = 'ww-demo-going';
    let mine = new Set(store.get(KEY, []));
    let sample = null;
    const ensure = () => new Promise((resolve, reject) => {
      if (window.WW_SAMPLE) return resolve(window.WW_SAMPLE);
      const s = document.createElement('script');
      s.src = 'sample-events.js';
      s.onload = () => resolve(window.WW_SAMPLE);
      s.onerror = () => reject(new Error('sample-events.js missing'));
      document.head.appendChild(s);
    });
    // Sample rows use day offsets so the preview always looks current.
    const iso = (offset, hhmm) => {
      const k = addDays(todayKey(), offset);
      const [h, m] = (hhmm || '00:00').split(':').map(Number);
      const [y, mo, d] = k.split('-').map(Number);
      const offsetH = pt(new Date(Date.UTC(y, mo - 1, d, 12))).h - 12; // -7 in PDT, -8 in PST
      return new Date(Date.UTC(y, mo - 1, d, h, m) - offsetH * HOUR).toISOString();
    };
    return {
      async init() { return { id: 'you', name: 'You (preview)', email: 'Preview mode' }; },
      async events() {
        sample = await ensure();
        return sample.events.map(e => ({
          ...e,
          starts_at: iso(e.day, e.all_day ? '00:00' : e.start),
          ends_at: e.all_day ? (e.end_day != null ? iso(e.end_day + 1, '00:00') : null) : e.end ? iso(e.end_day ?? e.day, e.end) : null,
          rsvp_deadline: e.rsvp_day != null ? iso(e.rsvp_day, '23:59') : null,
        }));
      },
      async rsvps() {
        sample = await ensure();
        const rows = [];
        for (const [id, names] of Object.entries(sample.example_going || {})) names.forEach((n, i) => rows.push({ event_id: id, user_id: `ex-${id}-${i}`, display_name: n }));
        for (const id of mine) rows.push({ event_id: id, user_id: 'you', display_name: 'You (preview)' });
        return rows;
      },
      async meta() { return null; },
      async setGoing(id, on) { on ? mine.add(id) : mine.delete(id); store.set(KEY, [...mine]); },
      async rename() { throw new Error('names are fixed in preview mode'); },
      subscribe() {},
      async report() { throw new Error('reports aren’t sent in preview mode'); },
      async signOut() { toast('Preview mode has no account to sign out of.'); },
    };
  }

  // ---------- Data: Supabase ----------
  function supaApi() {
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const allowed = email => /@([a-z0-9-]+\.)*berkeley\.edu$/i.test(email || '');
    const redirectTo = location.origin + location.pathname;
    let user = null;

    const nameOf = u => {
      const m = u.user_metadata || {};
      return (m.display_name || m.full_name || m.name || (u.email || 'Cohort mate').split('@')[0]).trim();
    };

    return {
      sb,
      allowed,
      async currentUser() {
        const { data } = await sb.auth.getSession();
        return data.session ? data.session.user : null;
      },
      async init(u) {
        user = u;
        return { id: u.id, name: nameOf(u), email: u.email };
      },
      signInGoogle() {
        return sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, queryParams: { hd: 'berkeley.edu', prompt: 'select_account' } },
        });
      },
      signInEmail(email) {
        return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
      },
      async events() {
        const since = new Date(Date.now() - 60 * DAY).toISOString();
        const { data, error } = await sb.from('events').select('*').gte('starts_at', since).order('starts_at').limit(2000);
        if (error) throw error;
        return data;
      },
      async rsvps() {
        const { data, error } = await sb.from('rsvps').select('event_id,user_id,display_name').limit(10000);
        if (error) throw error;
        return data;
      },
      async meta() {
        const { data } = await sb.from('feed_meta').select('*').eq('id', 1).maybeSingle();
        return data;
      },
      async setGoing(id, on) {
        const q = on
          ? sb.from('rsvps').upsert({ event_id: id, user_id: user.id, display_name: me.name }, { onConflict: 'event_id,user_id' })
          : sb.from('rsvps').delete().eq('event_id', id).eq('user_id', user.id);
        const { error } = await q;
        if (error) throw error;
      },
      async rename(name) {
        const { error } = await sb.auth.updateUser({ data: { display_name: name } });
        if (error) throw error;
        const { error: e2 } = await sb.from('rsvps').update({ display_name: name }).eq('user_id', user.id);
        if (e2) throw e2;
      },
      subscribe(onRsvps, onEvents) {
        let t1, t2;
        sb.channel('ww-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps' }, () => { clearTimeout(t1); t1 = setTimeout(onRsvps, 400); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => { clearTimeout(t2); t2 = setTimeout(onEvents, 2000); })
          .subscribe();
      },
      async report(row) {
        const { error } = await sb.from('bug_reports').insert(row);
        if (error) throw error;
      },
      async signOut() { await sb.auth.signOut(); location.reload(); },
    };
  }

  // ---------- Boot ----------
  async function startApp() {
    $('#signin').hidden = true;
    $('#app').hidden = false;
    buildRail();
    wire();
    $('#agenda').innerHTML = '<p class="loading">Loading events…</p>';
    try {
      await loadAll();
    } catch (err) {
      $('#agenda').innerHTML = `<div class="empty-state"><h3>Couldn’t load events</h3><p>${esc(err.message || err)}. Reload the page to try again.</p></div>`;
      return;
    }
    render();
    api.subscribe(
      async () => { try { setRsvps(await api.rsvps()); render(); } catch { /* next change retries */ } },
      async () => { try { await loadAll(); render(); } catch { /* keep current view */ } },
    );
    // Catch up after the tab has been in the background (e.g. overnight refresh).
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 5 * 60000) { try { await loadAll(); render(); } catch { /* ignore */ } }
    });
  }

  function showSignIn(message, isError) {
    $('#app').hidden = true;
    $('#signin').hidden = false;
    const status = $('#signin-status');
    status.textContent = message || '';
    status.classList.toggle('err', !!isError);
  }

  async function boot() {
    if (CFG.cohortLabel) $('#tagline').textContent = `${CFG.cohortLabel} · school and Bay Area events`;

    if (DEMO) {
      $('#demo-banner').hidden = false;
      api = demoApi();
      me = await api.init();
      paintUser();
      return startApp();
    }

    if (!window.supabase) return showSignIn('Couldn’t load the sign-in library. Check your connection and reload.', true);
    api = supaApi();

    $('#google-btn').addEventListener('click', async () => {
      const { error } = await api.signInGoogle();
      if (error) showSignIn(error.message, true);
    });
    $('#email-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = $('#email-input').value.trim();
      if (!api.allowed(email)) return showSignIn('Use your @berkeley.edu address.', true);
      showSignIn('Sending…');
      const { error } = await api.signInEmail(email);
      if (error) showSignIn(error.message, true);
      else showSignIn(`Check ${email} for a sign-in link. Open it in this browser.`);
    });

    let started = false;
    const handle = async u => {
      if (started) return;
      if (!u) return showSignIn();
      if (!api.allowed(u.email)) {
        await api.sb.auth.signOut();
        return showSignIn(`${u.email} isn’t a Berkeley account. Sign in with your @berkeley.edu email.`, true);
      }
      started = true;
      me = await api.init(u);
      paintUser();
      startApp();
    };
    api.sb.auth.onAuthStateChange((evt, session) => {
      // Defer: Supabase warns against awaiting its own calls inside this callback.
      if (evt === 'SIGNED_OUT') return setTimeout(() => showSignIn(), 0);
      if (session) setTimeout(() => handle(session.user), 0);
    });
    handle(await api.currentUser());
  }

  boot();
})();
