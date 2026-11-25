/* Token Launch Radar — the page's logic. Reads window.RADAR_DATA (written beside this
   page by the entry's program from the same board the gate reads), renders a sortable,
   filterable board, a per-protocol detail view, and the already-trading comparison set.
   Hash routes: #/ board, #/f/<category> board filtered, #/p/<slug> one protocol. */
(function () {
  'use strict';
  var D = window.RADAR_DATA;
  var app = document.getElementById('app');
  var stamp = document.getElementById('stamp');
  if (!D || !app) return;

  var state = { sort: 'rank', dir: 1, q: '', category: '', chain: '', status: 'all', minTvl: 0 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(v) {
    if (v == null) return '<span class="chains">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return days + 'd';
  }

  stamp.innerHTML =
    'snapshot <b>' + esc(D.as_of) + '</b> · ' + D.protocol_count + ' protocols · ' +
    '<b>' + D.rows.length + '</b> pre-token ranked · global multiple <b>' + D.global_multiple.toFixed(2) + 'x</b>';

  var categories = [];
  var chainsSeen = {};
  D.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
    r.chains.forEach(function (c) { chainsSeen[c] = true; });
  });
  categories.sort();
  var chainNames = Object.keys(chainsSeen).sort();

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.status === 'watch' && !r.watchlist) return false;
      if (state.status === 'beyond' && r.watchlist) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    implied: function (r) { return r.implied_value_usd; }
  };

  function sortedRows(rows) {
    var key = SORTS[state.sort] || SORTS.rank;
    return rows.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x < y) return -state.dir;
      if (x > y) return state.dir;
      return a.rank - b.rank;
    });
  }

  function headerCell(label, key, cls) {
    var arrow = state.sort === key ? ' <span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }

  function controlsHTML() {
    var catOpts = '<option value="">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="">All chains</option>' + chainNames.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var tvlOpts = [[0, 'Any TVL'], [1e7, '$10M+'], [5e7, '$50M+'], [1e8, '$100M+'], [5e8, '$500M+']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.minTvl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<label>Search<input id="f-q" type="search" placeholder="name or slug" value="' + esc(state.q) + '"></label>' +
      '<label>Category<select id="f-cat">' + catOpts + '</select></label>' +
      '<label>Chain<select id="f-chain">' + chainOpts + '</select></label>' +
      '<label>Set<select id="f-status">' +
        '<option value="all"' + (state.status === 'all' ? ' selected' : '') + '>All ranked</option>' +
        '<option value="watch"' + (state.status === 'watch' ? ' selected' : '') + '>Watchlist only</option>' +
        '<option value="beyond"' + (state.status === 'beyond' ? ' selected' : '') + '>Beyond the watchlist</option>' +
      '</select></label>' +
      '<label>Min TVL<select id="f-tvl">' + tvlOpts + '</select></label>' +
      '<span class="count" id="f-count"></span></div>';
  }

  function boardHTML() {
    var rows = sortedRows(filtered());
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) +
          (r.watchlist ? '<span class="badge watch">watchlist</span>' : '<span class="badge">pre-token</span>') +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains hideable">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num hideable">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    return controlsHTML() +
      '<table class="board"><thead><tr>' +
      headerCell('#', 'rank', 'num') + headerCell('Protocol', 'name') +
      '<th>Category</th><th class="hideable">Chains</th>' +
      headerCell('TVL', 'tvl', 'num') + headerCell('7d', 'change', 'num') +
      headerCell('Age', 'age', 'num hideable') + headerCell('Implied value', 'implied', 'num') +
      '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<p class="count" style="margin-top:8px">Select a row for the protocol\'s model breakdown and farm plan.</p>' +
      liveHTML();
  }

  function liveHTML() {
    if (!D.live || !D.live.length) return '';
    var body = D.live.map(function (r) {
      return '<tr><td class="name">' + esc(r.name) + (r.symbol ? ' <span class="slug">' + esc(r.symbol) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + r.mcap_tvl.toFixed(2) + 'x</td></tr>';
    }).join('');
    return '<section class="live"><h2>Already trading — the comparison set</h2>' +
      '<p class="note">These protocols\' tokens already exist, so they are not ranked. Their market-cap / TVL ratios are the raw material the board\'s category multiples are medians of: the radar prices a pre-token protocol the way the snapshot\'s own market already prices its tokenized peers.</p>' +
      '<table class="live-table"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">MCap / TVL</th></tr></thead><tbody>' +
      body + '</tbody></table></section>';
  }

  function detailHTML(r) {
    var facts =
      '<dl class="facts">' +
      '<dt>Category</dt><dd>' + esc(r.category || 'uncategorised') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + ' (' + r.tvl_usd.toLocaleString('en-US') + ' USD)</dd>' +
      '<dt>7-day change</dt><dd>' + (r.change_7d == null ? 'unreported' : r.change_7d.toFixed(2) + '%') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || 'unknown') + (r.age_days != null ? ' (' + r.age_days + ' days)' : '') + '</dd>' +
      '<dt>Token</dt><dd>none recorded in the snapshot</dd>' +
      '<dt>Set</dt><dd>' + (r.watchlist ? 'snapshot watchlist (TVL at or above the $50M floor)' : 'beyond the watchlist — found by the radar') + '</dd></dl>';
    var multWhy = r.multiple_source === 'category'
      ? 'median of ' + r.multiple_samples + ' tokenized ' + esc(r.category) + ' protocols in this snapshot'
      : r.multiple_source === 'family'
        ? 'family median, ' + r.multiple_samples + ' tokenized samples (this category has too few of its own)'
        : 'global median, ' + r.multiple_samples + ' tokenized samples across the snapshot';
    var breakdown =
      '<table class="breakdown">' +
      '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple<span class="why">' + multWhy + '</span></td><td>&times; ' + r.multiple.toFixed(3) + '</td></tr>' +
      '<tr><td>Momentum<span class="why">7-day change ' + (r.change_7d == null ? 'unreported, counted neutral' : r.change_7d.toFixed(1) + '%, clamped') + '</span></td><td>&times; ' + r.momentum_factor.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity<span class="why">' + (r.age_days == null ? 'listing date unknown, counted neutral' : r.age_days + ' days tracked with no token') + '</span></td><td>&times; ' + r.maturity_factor.toFixed(3) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr></table>';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<div class="detail"><a class="backlink" href="#/">&larr; Back to the board</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="badge' + (r.watchlist ? ' watch' : '') + '">' + (r.watchlist ? 'watchlist' : 'pre-token') + '</span>' +
      '<span class="chains">rank #' + r.rank + ' of ' + D.rows.length + ' · ' + esc(r.slug) + '</span></div>' +
      '<div class="detail-grid">' +
      '<div class="card"><h3>The record</h3>' + facts + '</div>' +
      '<div class="card"><h3>How the value is derived</h3>' + breakdown + '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol></div></div>';
  }

  function wire() {
    var q = document.getElementById('f-q');
    if (!q) return;
    q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    document.getElementById('f-cat').addEventListener('change', function (e) { state.category = e.target.value; refreshTable(); });
    document.getElementById('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; refreshTable(); });
    document.getElementById('f-status').addEventListener('change', function (e) { state.status = e.target.value; refreshTable(); });
    document.getElementById('f-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); refreshTable(); });
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; if (key === 'rank') state.dir = 1; }
        render();
      });
    });
    app.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
  }

  function refreshTable() {
    render();
    var q = document.getElementById('f-q');
    if (q && state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function render() {
    var hash = location.hash || '#/';
    var detail = hash.match(/^#\/p\/(.+)$/);
    if (detail) {
      var slug = decodeURIComponent(detail[1]);
      var row = null;
      D.rows.forEach(function (r) { if (r.slug === slug) row = r; });
      if (row) {
        app.innerHTML = detailHTML(row);
        app.setAttribute('aria-busy', 'false');
        window.scrollTo(0, 0);
        return;
      }
    }
    var f = hash.match(/^#\/f\/(.+)$/);
    if (f) state.category = decodeURIComponent(f[1]);
    app.innerHTML = '<div class="main-wrap">' + boardHTML() + '</div>';
    var count = document.getElementById('f-count');
    if (count) count.innerHTML = 'showing <b>' + filtered().length + '</b> of ' + D.rows.length;
    app.setAttribute('aria-busy', 'false');
    wire();
  }

  window.addEventListener('hashchange', render);
  render();
})();
