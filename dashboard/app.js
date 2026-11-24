'use strict';
/* Token Radar dashboard: the board, the detail view and the live-token view.
   All data comes from window.RADAR (data.js, written by main.ts). No network. */

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const MODEL = R.model;

/* ---------- formatting ---------- */
function money(v) {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function moneyFull(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function pct(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- state ---------- */
const state = {
  tab: 'board',
  q: '',
  cat: '',
  chain: '',
  watch: false,
  sort: 'rank',
  detail: null,
  sb: { scale: 1, growth: MODEL.growth_weight, mat: 1, on: false },
};
const watchSet = new Set(R.rows.filter((r) => r.on_watchlist).map((r) => r.slug));

/* ---------- sandbox recompute ---------- */
function growthPctOf(row) {
  return ((row.growth_multiplier - 1) / MODEL.growth_weight) * 100;
}
function sandboxed(row) {
  if (!state.sb.on) return { implied: row.implied_value_usd, rank: row.rank };
  const gp = growthPctOf(row);
  const g = 1 + (gp / 100) * state.sb.growth;
  const m = 1 + (row.maturity_multiplier - 1) * state.sb.mat;
  const implied = Math.max(1, Math.round(row.tvl_usd * row.comps_ratio * state.sb.scale * g * m * row.chain_multiplier));
  return { implied, rank: 0 };
}
function rankedRows() {
  const rows = R.rows.map((r) => {
    const s = sandboxed(r);
    return { row: r, implied: s.implied, rank: s.rank };
  });
  if (state.sb.on) {
    rows.sort((a, b) => b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1));
    rows.forEach((x, i) => { x.rank = i + 1; });
  }
  return rows;
}

/* ---------- filtering & sorting ---------- */
function filtered() {
  let list = rankedRows();
  if (state.watch) list = list.filter((x) => watchSet.has(x.row.slug));
  if (state.cat) list = list.filter((x) => x.row.category === state.cat);
  if (state.chain) list = list.filter((x) => x.row.chains.includes(state.chain));
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((x) => x.row.name.toLowerCase().includes(q) || x.row.slug.includes(q));
  }
  const k = state.sort;
  const by = {
    rank: (a, b) => a.rank - b.rank,
    name: (a, b) => (a.row.name < b.row.name ? -1 : 1),
    category: (a, b) => String(a.row.category || '') < String(b.row.category || '') ? -1 : 1,
    tvl: (a, b) => b.row.tvl_usd - a.row.tvl_usd,
    change: (a, b) => (b.row.change_7d ?? -1e9) - (a.row.change_7d ?? -1e9),
    age: (a, b) => (b.row.age_days ?? -1) - (a.row.age_days ?? -1),
    implied: (a, b) => b.implied - a.implied,
    confidence: (a, b) => b.row.confidence - a.row.confidence,
  }[k] || ((a, b) => a.rank - b.rank);
  return [...list].sort(by);
}

/* ---------- renders ---------- */
function renderStats() {
  $('stats').innerHTML =
    '<div><b>' + R.board_size + '</b><span>ranked</span></div>' +
    '<div><b>' + R.watchlist_size + '</b><span>watchlist</span></div>' +
    '<div><b>' + R.live_size + '</b><span>live tokens</span></div>' +
    '<div><b>' + esc(R.as_of) + '</b><span>snapshot</span></div>';
  $('subtitle').textContent =
    R.board_size + ' pre-token protocols ranked by implied launch value · snapshot ' + R.as_of + ' · floor $' + (R.floor_usd / 1e6) + 'M TVL';
}

function renderModelText() {
  $('model-text').innerHTML =
    'Implied value = TVL × <code>category comps</code> × growth × maturity × chains. ' +
    'The comps ratio is the median market-cap-to-TVL of the live-token protocols in the same category ' +
    '(at least ' + MODEL.comps_min_n + ' of them, else the global median of ' + R.global_ratio.toFixed(2) + ', clamped to [' +
    MODEL.comps_ratio_min + ', ' + MODEL.comps_ratio_max + ']). Growth is the 7-day TVL change clamped to [' +
    MODEL.growth_floor + '%, ' + MODEL.growth_cap + '%] with weight ' + MODEL.growth_weight + '. ' +
    'Maturity rises from ' + MODEL.maturity_floor + ' to ' + (MODEL.maturity_floor + MODEL.maturity_range) + ' over ' +
    MODEL.maturity_days + ' days of running with no token. Multi-chain protocols earn up to +' +
    Math.round(MODEL.chain_max_bonus * 100) + '%. No protocol name is ever special-cased.';
}

function renderFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
}

function renderChart() {
  /* Top ten of the current filtered view, by implied value. */
  const top = filtered().slice().sort((a, b) => b.implied - a.implied).slice(0, 10);
  const max = top.length ? top[0].implied : 1;
  $('topchart').innerHTML = '<h3>Top ten by implied value</h3>' + top.map((x) =>
    '<div class="bar"><span class="lbl">' + x.rank + '. ' + esc(x.row.name) + '</span>' +
    '<span class="fill" style="width:' + Math.max(2, Math.round((x.implied / max) * 100)) + '%"></span>' +
    '<span class="val">' + money(x.implied) + '</span></div>').join('');
}

function rowHtml(x) {
  const r = x.row;
  const ch = r.change_7d === null ? '<span>—</span>' :
    '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
  return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.detail === r.slug ? 'sel' : '') + '">' +
    '<td class="num">' + x.rank + '</td>' +
    '<td><b>' + esc(r.name) + '</b> ' + (watchSet.has(r.slug) ? '<span class="pill watch">watchlist</span>' : '') + '<br><span class="muted">' + esc(r.slug) + '</span></td>' +
    '<td>' + esc(r.category || '—') + '</td>' +
    '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
    '<td class="num">' + money(r.tvl_usd) + '</td>' +
    '<td class="num">' + ch + '</td>' +
    '<td class="num">' + ageText(r.age_days) + '</td>' +
    '<td class="num"><b>' + money(x.implied) + '</b></td>' +
    '<td class="num"><span class="conf"><i style="width:' + r.confidence + '%"></i></span> ' + r.confidence + '</td>' +
    '</tr>';
}

function renderBoard() {
  const list = filtered();
  $('rows').innerHTML = list.map(rowHtml).join('');
  $('count').textContent = list.length + ' of ' + R.board_size + ' protocols shown' + (state.sb.on ? ' · sandbox values' : '');
  document.querySelectorAll('#rows tr').forEach((tr) => {
    tr.addEventListener('click', () => selectDetail(tr.getAttribute('data-slug')));
  });
}

function renderLive() {
  $('livetable').innerHTML = '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">7d</th></tr></thead><tbody>' +
    R.live.map((p) =>
      '<tr><td><b>' + esc(p.name) + '</b><br><span class="muted">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—') + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>').join('') +
    '</tbody></table><p class="count">These already trade: the market’s own values, shown as the benchmarks behind the board’s comps ratios — never mixed into the ranking.</p>';
}

function renderDetail(slug) {
  const box = $('detail');
  const found = rankedRows().find((x) => x.row.slug === slug);
  if (!found) {
    box.innerHTML = '<p class="muted">Click a row to see its model breakdown, its comparable protocols and its farm plan.</p>';
    return;
  }
  const r = found.row;
  const comps = R.live.filter((p) => p.category === r.category).slice(0, 3);
  const compLine = r.comps_n > 0
    ? 'Category benchmark: median mcap/TVL ' + r.comps_ratio.toFixed(2) + '× over ' + r.comps_n + ' live ' + esc(r.category || '') + ' protocols.'
    : 'No category benchmark with enough live protocols: the global median mcap/TVL of ' + R.global_ratio.toFixed(2) + '× is used.';
  box.innerHTML =
    '<h2>#' + found.rank + ' — ' + esc(r.name) + ' <span class="pill">' + esc(r.category || 'no category') + '</span> ' +
    (watchSet.has(r.slug) ? '<span class="pill watch">watchlist</span>' : '') + '</h2>' +
    '<p class="muted">Records no token — the snapshot carries no market cap, CoinGecko id or symbol for it. ' + compLine + '</p>' +
    '<div class="detail-grid"><div><h3>The record</h3><dl class="kv">' +
    '<dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>' +
    '<dt>7-day change</dt><dd>' + pct(r.change_7d) + '</dd>' +
    '<dt>Age (tracked since)</dt><dd>' + ageText(r.age_days) + (r.listed_at ? ' · since ' + esc(r.listed_at) : ' · date unreported') + '</dd>' +
    '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
    '<dt>Confidence</dt><dd>' + r.confidence + ' / 100</dd>' +
    '</dl><h3>Comparable protocols</h3>' +
    (comps.length ? '<dl class="kv">' + comps.map((p) =>
      '<dt>' + esc(p.name) + '</dt><dd>' + money(p.mcap_usd) + ' mcap · ' + (p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '× TVL' : '') + '</dd>').join('') + '</dl>'
      : '<p class="muted">No live protocol in this category sits in the top ' + R.live_size + ' by market cap.</p>') +
    '</div><div><h3>How the value is built</h3>' +
    '<div class="math">' + money(r.tvl_usd) + ' TVL × <b>' + r.comps_ratio.toFixed(2) + '</b> comps' +
    ' × <b>' + r.growth_multiplier.toFixed(2) + '</b> growth' +
    ' × <b>' + r.maturity_multiplier.toFixed(2) + '</b> maturity' +
    ' × <b>' + r.chain_multiplier.toFixed(2) + '</b> chains<br>= <b>' + moneyFull(found.implied) + '</b> implied value</div>' +
    '<h3>Farm plan</h3><ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '</div></div>' +
    '<p class="note">This board states what a token would be worth if the protocol’s record stayed as it is. It does not predict whether or when a token is issued.</p>';
}

function renderMethod() {
  $('method').innerHTML =
    '<h2>Method &amp; notes</h2>' +
    '<p>Data: ' + esc(R.source) + '. The snapshot is frozen; nothing here fetches live data, and the page makes no network requests at all.</p>' +
    '<p>The watchlist is a floor, never a ceiling: it holds the ' + R.watchlist_size + ' protocols at or above $' + (R.floor_usd / 1e6) + 'M TVL that record no token and are not a wrapped, staked or bridged product of one that trades. The board adds every other protocol that meets the same rule, ' + R.early_size + ' of them here.</p>' +
    '<p>A protocol is described as recording no token, never as having none: its DefiLlama record may simply not carry one. Farm plans are generic steps fitted to the protocol’s category, chains, size and age — check the protocol’s own pages before moving funds, and never pay to claim anything.</p>' +
    '<p>Model ' + esc(R.model_version) + ' · confidence counts a reported 7-day change, a listing date, more than one chain, and a category with enough live comparables (25 points each).</p>';
}

/* ---------- tabs & selection ---------- */
function setTab(tab) {
  state.tab = tab;
  $('tab-board').classList.toggle('active', tab === 'board');
  $('tab-live').classList.toggle('active', tab === 'live');
  const boardOn = tab === 'board';
  document.querySelector('.tablewrap').style.display = boardOn ? '' : 'none';
  $('topchart').style.display = boardOn ? '' : 'none';
  document.querySelector('.controls').style.display = boardOn ? '' : 'none';
  $('count').style.display = boardOn ? '' : 'none';
  $('livetable').hidden = boardOn;
  if (!boardOn) renderLive();
}
function selectDetail(slug) {
  state.detail = slug;
  renderBoard();
  renderDetail(slug);
  try { history.replaceState(null, '', '#detail=' + encodeURIComponent(slug)); } catch (e) { /* file:// */ }
  $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- sandbox ---------- */
function syncSandboxUI() {
  $('sb-scale').value = state.sb.scale;
  $('sb-growth').value = state.sb.growth;
  $('sb-mat').value = state.sb.mat;
  $('sb-scale-v').textContent = state.sb.scale.toFixed(2) + '×';
  $('sb-growth-v').textContent = state.sb.growth.toFixed(2);
  $('sb-mat-v').textContent = state.sb.mat.toFixed(2);
  $('sb-badge').hidden = !state.sb.on;
}
function sandboxChanged() {
  state.sb.scale = parseFloat($('sb-scale').value);
  state.sb.growth = parseFloat($('sb-growth').value);
  state.sb.mat = parseFloat($('sb-mat').value);
  state.sb.on = state.sb.scale !== 1 || state.sb.growth !== MODEL.growth_weight || state.sb.mat !== 1;
  syncSandboxUI();
  renderChart();
  renderBoard();
  if (state.detail) renderDetail(state.detail);
}

/* ---------- hash deep links ---------- */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('detail')) state.detail = h.get('detail');
  if (h.get('cat')) { state.cat = h.get('cat'); $('cat').value = state.cat; }
  if (h.get('chain')) { state.chain = h.get('chain'); $('chain').value = state.chain; }
  if (h.get('watch') === '1') { state.watch = true; $('watch').checked = true; }
  if (h.get('tab') === 'live') setTab('live');
}

/* Re-apply deep links when the hash changes without a reload. */
window.addEventListener('hashchange', () => {
  state.detail = null;
  state.cat = 'All'; state.chain = 'All'; state.watch = false;
  $('cat').value = 'All'; $('chain').value = 'All'; $('watch').checked = false;
  readHash();
  renderChart();
  renderBoard();
  renderDetail(state.detail);
});

/* ---------- wire up ---------- */
$('q').addEventListener('input', () => { state.q = $('q').value; renderBoard(); });
$('cat').addEventListener('change', () => { state.cat = $('cat').value; renderBoard(); });
$('chain').addEventListener('change', () => { state.chain = $('chain').value; renderBoard(); });
$('watch').addEventListener('change', () => { state.watch = $('watch').checked; renderBoard(); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; renderBoard(); });
$('tab-board').addEventListener('click', () => setTab('board'));
$('tab-live').addEventListener('click', () => setTab('live'));
document.querySelectorAll('#board thead th').forEach((th) => {
  th.addEventListener('click', () => {
    const k = th.getAttribute('data-k');
    if (!k) return;
    state.sort = k === 'name' ? 'name' : k === 'category' ? 'category' : k === 'chains' ? 'tvl' : k;
    $('sort').value = state.sort;
    renderBoard();
  });
});
['sb-scale', 'sb-growth', 'sb-mat'].forEach((id) => $(id).addEventListener('input', sandboxChanged));
$('sb-reset').addEventListener('click', () => {
  state.sb = { scale: 1, growth: MODEL.growth_weight, mat: 1, on: false };
  syncSandboxUI();
  renderChart();
  renderBoard();
  if (state.detail) renderDetail(state.detail);
});

renderStats();
renderModelText();
renderFilters();
readHash();
renderChart();
renderBoard();
renderDetail(state.detail);
renderMethod();
