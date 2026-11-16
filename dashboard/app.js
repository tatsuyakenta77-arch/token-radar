/* Token Radar: a working page, not a picture of one.
 *
 * The page recomputes everything from the snapshot figures in data.js: the
 * calibration medians from the live-token ratios, every protocol's implied
 * value from its TVL, category multiple, growth, tenure and breadth, and
 * every farm plan from the protocol's category, chains, TVL and age. The
 * numbers it shows are the numbers it derives; the detail view checks each
 * recomputed value against the board the program wrote. No network, no
 * framework, no imports: the page runs from the files alone.
 */
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('board');
  if (!DATA) {
    main.textContent = 'The radar data did not load. This page needs data.js beside dashboard/.';
    main.setAttribute('aria-busy', 'false');
    return;
  }

  var MODEL = DATA.model;

  /* ---------- the model, as the program runs it ---------- */

  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function round4(x) { return Math.round(x * 10000) / 10000; }

  /** Median market-cap-per-TVL per category, from the live-token ratios. */
  function calibrate(liveRatios) {
    var byCategory = new Map();
    var allRatios = [];
    liveRatios.forEach(function (r) {
      allRatios.push(r.ratio);
      if (r.category !== null) {
        var list = byCategory.get(r.category) || [];
        list.push(r.ratio);
        byCategory.set(r.category, list);
      }
    });
    var clamp = function (n) {
      return round4(Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, n)));
    };
    var global = allRatios.length > 0 ? clamp(median(allRatios)) : MODEL.multiple_floor;
    var rankedCategories = [];
    DATA.rows.forEach(function (row) {
      var key = row.category === null ? 'Uncategorised' : row.category;
      if (rankedCategories.indexOf(key) === -1) rankedCategories.push(key);
    });
    rankedCategories.sort();
    var entries = rankedCategories.map(function (category) {
      var comps = byCategory.get(category) || [];
      if (comps.length >= MODEL.min_category_comps) {
        return { category: category, multiple: clamp(median(comps)), comps: comps.length, source: 'category' };
      }
      return { category: category, multiple: global, comps: comps.length, source: 'global' };
    });
    return { global_multiple: global, global_comps: allRatios.length, entries: entries };
  }

  var CALIBRATION = calibrate(DATA.live_ratios);

  function multipleFor(category) {
    var key = category === null ? 'Uncategorised' : category;
    for (var i = 0; i < CALIBRATION.entries.length; i++) {
      var e = CALIBRATION.entries[i];
      if (e.category === key) return { multiple: e.multiple, comps: e.comps, source: e.source };
    }
    return { multiple: CALIBRATION.global_multiple, comps: CALIBRATION.global_comps, source: 'global' };
  }

  function growthMultiplier(row) {
    var change = typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0;
    var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, change));
    return 1 + (growthPct / 100) * MODEL.growth_weight;
  }
  function tenureMultiplier(row) {
    var age = row.age_days === null ? MODEL.unknown_age_days : row.age_days;
    return MODEL.tenure_floor + (Math.min(Math.max(age, 0), MODEL.tenure_days) / MODEL.tenure_days) * MODEL.tenure_range;
  }
  function breadthMultiplier(row) {
    return 1 + Math.min(Math.max(row.chains.length - 1, 0) * MODEL.breadth_per_chain, MODEL.breadth_cap);
  }
  function factors(row) {
    var m = multipleFor(row.category);
    var growth = growthMultiplier(row);
    var tenure = tenureMultiplier(row);
    var breadth = breadthMultiplier(row);
    return {
      multiple: m.multiple,
      multiple_comps: m.comps,
      multiple_source: m.source,
      growth: growth,
      tenure: tenure,
      breadth: breadth,
      implied: Math.max(1, Math.round(row.tvl_usd * m.multiple * growth * tenure * breadth)),
    };
  }

  /* ---------- farm plans, as the program writes them ---------- */

  function chainOf(row) {
    return row.chains.length > 0 ? row.chains[0] : 'its main chain';
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 12;
    if (chain === 'Bitcoin') return 8;
    if (chain === 'its main chain') return 5;
    return 2;
  }
  function capitalFor(row) {
    if (row.tvl_usd >= 1000000000) return 200;
    if (row.tvl_usd >= 250000000) return 150;
    if (row.tvl_usd >= 50000000) return 100;
    return 50;
  }
  function holdDaysFor(ageDays) {
    if (ageDays === null) return 30;
    if (ageDays < 90) return 90;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('liquid staking') !== -1 || c.indexOf('liquid restaking') !== -1 || c.indexOf('restaked') !== -1) return "Stake $" + capital + " of the chain's staking asset through " + name + " on " + chain + " and hold the receipt token.";
    if (c.indexOf('restaking') !== -1 || c.indexOf('staking') !== -1) return "Stake $" + capital + " through " + name + " on " + chain + " and hold the receipt token.";
    if (c.indexOf('risk curator') !== -1) return "Deposit $" + capital + " of USDC into a " + name + " curated vault on " + chain + " and hold the vault shares.";
    if (c.indexOf('onchain capital allocator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('liquidity manager') !== -1) return "Deposit $" + capital + " of USDC into a " + name + " vault on " + chain + " and hold the shares.";
    if (c.indexOf('canonical bridge') !== -1 || c.indexOf('cross chain bridge') !== -1 || c.indexOf('bridge') !== -1) return "Bridge $" + capital + " of USDC to " + chain + " through " + name + " and use the bridged funds in the destination app.";
    if (c.indexOf('dex') !== -1 || c.indexOf('leveraged farm') !== -1 || c.indexOf('farm') !== -1) return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + " and keep the position open.";
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1) return "Supply $" + capital + " of USDC to " + name + " on " + chain + " and keep the position open.";
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('basis trading') !== -1 || c.indexOf('options') !== -1) return "Deposit $" + capital + " of USDC as margin on " + name + " and open one small hedged position.";
    if (c.indexOf('rwa') !== -1) return "Mint $" + capital + " of " + name + "'s yield asset on " + chain + " and hold it.";
    if (c.indexOf('yield aggregator') !== -1 || c.indexOf('yield') !== -1) return "Deposit $" + capital + " of USDC into " + name + "'s highest-TVL strategy on " + chain + " and hold the receipt.";
    if (c.indexOf('prediction') !== -1) return "Fund $" + capital + " on " + name + " and place one small market position.";
    if (c.indexOf('stablecoin') !== -1 || c.indexOf('stable') !== -1 || c.indexOf('dual-token') !== -1) return "Mint or hold $" + capital + " of the stable asset through " + name + " on " + chain + ".";
    if (c.indexOf('insurance') !== -1) return "Buy $" + capital + " of cover from " + name + " on " + chain + " and keep the policy active.";
    if (c.indexOf('payment') !== -1 || c.indexOf('card') !== -1) return "Hold $" + capital + " in " + name + " on " + chain + " and make one real payment through it.";
    if (c.indexOf('governance') !== -1) return "Deposit $" + capital + " through " + name + " on " + chain + " and vote once with the position.";
    if (c.indexOf('chain') !== -1) return "Bridge $" + capital + " of USDC to the " + name + " chain and use two of its core apps.";
    if (c.indexOf('index') !== -1) return "Buy $" + capital + " of the " + name + " index token on " + chain + " and hold it.";
    if (c.indexOf('otc') !== -1) return "Place one $" + capital + " order through " + name + " on " + chain + " and complete it.";
    if (c.indexOf('btc') !== -1) return "Mint $" + capital + " of the BTC-backed asset through " + name + " on " + chain + " and hold it.";
    if (c.indexOf('cedefi') !== -1) return "Deposit $" + capital + " of USDC into " + name + " on " + chain + " and hold the vault receipt.";
    return "Deposit $" + capital + " of USDC into " + name + " on " + chain + " and keep the position open.";
  }
  function secondActionFor(row) {
    var c = (row.category || '').toLowerCase();
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1) return 'Borrow a small amount against the supply, then repay half of it, so the position shows both sides of the market.';
    if (c.indexOf('dex') !== -1 || c.indexOf('yield') !== -1 || c.indexOf('farm') !== -1) return 'Swap a small amount through the pool on a different day, so the activity is not a single transaction.';
    if (c.indexOf('bridge') !== -1) return 'Bridge a second, smaller amount back the other way, so the record shows repeated use.';
    if (c.indexOf('stak') !== -1 || c.indexOf('restak') !== -1) return 'Top up the stake once more and confirm the receipt token balance in the wallet.';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('basis') !== -1 || c.indexOf('options') !== -1) return 'Close the first position, then open a fresh one at a smaller size.';
    if (c.indexOf('rwa') !== -1 || c.indexOf('stable') !== -1 || c.indexOf('index') !== -1) return 'Add a second, smaller mint on a different day and hold both positions.';
    return 'Repeat the core action a second time, on a different day, with a smaller amount.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = gasFor(chain);
    return [
      stepText({ text: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline, never in a screenshot or a chat.', cost: 'nothing to create the wallet', time: '5 minutes' }),
      stepText({ text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' }),
      stepText({ text: secondActionFor(row), cost: 'about $' + gas + ' of gas', time: '10 minutes' }),
      stepText({ text: 'Do one qualifying action every week, a deposit, a borrow, a swap, a stake or a vote, and vary the day you do it.', cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' }),
      stepText({ text: 'Keep the position open for at least ' + hold + ' days so the activity lands in more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' }),
      stepText({ text: "Check the protocol's own points or rewards page from the link on its official site, and claim only there; never pay a fee to claim and never connect a wallet from a link in a direct message.", cost: 'no fee to check', time: '10 minutes' }),
      stepText({ text: 'Keep a farm log with the wallet, the dates and every transaction hash, and when you exit, unwind in reverse order and check the withdrawal window and fee first.', cost: 'about $' + gas + ' of gas to exit', time: '15 minutes' }),
    ];
  }

  /* ---------- formatting (locale-free: the same bytes everywhere) ---------- */

  function trim2(v) { return (Math.round(v * 100) / 100).toString(); }
  function usd(x) {
    if (x >= 1e9) return '$' + trim2(x / 1e9) + 'B';
    if (x >= 1e6) return '$' + trim2(x / 1e6) + 'M';
    if (x >= 1e3) return '$' + trim2(x / 1e3) + 'K';
    return '$' + Math.round(x);
  }
  function usdFull(x) {
    return '$' + String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(x) {
    if (x === null) return '—';
    return (x > 0 ? '+' : '') + (Math.round(x * 10) / 10) + '%';
  }
  function ageShort(x) { return x === null ? '—' : x + 'd'; }
  function ageLong(x) {
    if (x === null) return 'Unknown';
    return x === 1 ? '1 day' : x + ' days';
  }
  function mult(x) { return x.toFixed(3) + '×'; }

  /* ---------- tiny DOM helpers: text only, never markup injection ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function numCell(text, cls) {
    return el('td', { className: 'num' + (cls ? ' ' + cls : ''), text: text });
  }

  /* ---------- state: the address bar holds the whole view ---------- */

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, minTvl: 0, tab: 'board', sort: 'rank', dir: 'asc', p: null };
  var DEFAULTS = { q: '', category: 'all', chain: 'all', watchlist: false, minTvl: 0, tab: 'board', sort: 'rank', dir: 'asc', p: null };

  function readHash() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    state.q = params.get('q') || '';
    state.category = params.get('category') || 'all';
    state.chain = params.get('chain') || 'all';
    state.watchlist = params.get('watchlist') === '1';
    state.minTvl = Number(params.get('minTvl') || 0) || 0;
    var tab = params.get('tab') || 'board';
    state.tab = tab === 'live' || tab === 'model' ? tab : 'board';
    var sort = params.get('sort') || 'rank';
    state.sort = ['rank', 'name', 'tvl', 'change', 'age', 'multiple', 'implied'].indexOf(sort) !== -1 ? sort : 'rank';
    state.dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
    state.p = params.get('p') || null;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 'asc') params.set('dir', state.dir);
    if (state.p) params.set('p', state.p);
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
  }

  /* ---------- filtering and sorting ---------- */

  var ROWS = DATA.rows.map(function (row) {
    var f = factors(row);
    return {
      row: row,
      multiple: f.multiple, multiple_comps: f.multiple_comps, multiple_source: f.multiple_source,
      growth: f.growth, tenure: f.tenure, breadth: f.breadth, implied: f.implied,
    };
  });
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.row.slug] = r; });

  function matches(entry) {
    var row = entry.row;
    if (state.watchlist && !row.on_watchlist) return false;
    if (row.tvl_usd < state.minTvl) return false;
    if (state.category !== 'all' && (row.category || 'Uncategorised') !== state.category) return false;
    if (state.chain !== 'all' && row.chains.indexOf(state.chain) === -1) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }
  function compare(a, b) {
    var key = state.sort;
    var av, bv;
    if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
    else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
    else if (key === 'change') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
    else if (key === 'age') { av = a.row.age_days === null ? -1 : a.row.age_days; bv = b.row.age_days === null ? -1 : b.row.age_days; }
    else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
    else if (key === 'implied') { av = a.implied; bv = b.implied; }
    else { av = a.row.rank; bv = b.row.rank; }
    var cmp = av < bv ? -1 : av > bv ? 1 : (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    return state.dir === 'asc' ? cmp : -cmp;
  }
  function visibleRows() { return ROWS.filter(matches).sort(compare); }

  /* ---------- the board table ---------- */

  var MAX_IMPLIED = Math.max.apply(null, ROWS.map(function (r) { return r.implied; }));
  var SORT_COLUMNS = [
    { key: 'rank', label: 'Rank' },
    { key: 'name', label: 'Protocol' },
    { key: 'tvl', label: 'TVL' },
    { key: 'change', label: '7d change' },
    { key: 'age', label: 'Age' },
    { key: 'multiple', label: 'Multiple' },
    { key: 'implied', label: 'Implied value' },
  ];

  function sortButton(col, th) {
    var btn = el('button', { type: 'button', text: col.label });
    if (state.sort === col.key) {
      btn.appendChild(el('span', { className: 'arrow', text: state.dir === 'asc' ? ' ▲' : ' ▼', 'aria-hidden': 'true' }));
      th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
    }
    btn.addEventListener('click', function () {
      if (state.sort === col.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = col.key; state.dir = col.key === 'name' ? 'asc' : 'desc'; }
      writeHash();
      renderBoard();
    });
    return btn;
  }

  var boardBody, boardCount, boardPanel, livePanel, modelPanel, boardCaption;

  function renderBoard() {
    var rows = visibleRows();
    boardCount.textContent = '';
    boardCount.appendChild(el('b', { text: String(rows.length) }));
    boardCount.appendChild(document.createTextNode(' of ' + DATA.board_size + ' protocols'));
    boardCaption.textContent = 'Pre-token protocols, ranked by calibrated implied value. Click a row for the model breakdown and the farm plan.';

    var head = boardPanel.querySelector('thead tr');
    head.textContent = '';
    SORT_COLUMNS.forEach(function (col) {
      var th = el('th', { scope: 'col' });
      if (col.key === 'tvl' || col.key === 'change' || col.key === 'age' || col.key === 'multiple' || col.key === 'implied') th.className = 'num';
      th.appendChild(sortButton(col, th));
      head.appendChild(th);
    });
    head.appendChild(el('th', { scope: 'col', text: 'Status' }));

    boardBody.textContent = '';
    if (rows.length === 0) {
      var empty = el('div', { className: 'empty' });
      empty.appendChild(el('h2', { text: 'No protocol matches those filters' }));
      empty.appendChild(el('p', { text: 'Loosen the search or clear a filter to see the board again.' }));
      var reset = el('button', { className: 'button', type: 'button', text: 'Clear all filters' });
      reset.addEventListener('click', clearFilters);
      empty.appendChild(reset);
      boardBody.appendChild(el('tr')).appendChild(el('td', { colspan: '8' })).appendChild(empty);
      return;
    }
    rows.forEach(function (entry) {
      var row = entry.row;
      var tr = el('tr', { tabindex: '0', 'data-slug': row.slug });
      if (state.p === row.slug) tr.setAttribute('data-selected', 'true');
      var open = function () { openDetail(row.slug); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
      tr.appendChild(numCell(String(row.rank)));
      var nameCell = el('td');
      var nameBox = el('span', { className: 'name' });
      nameBox.appendChild(el('b', { text: row.name }));
      nameBox.appendChild(el('span', { className: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.slice(0, 3).join(', ') + (row.chains.length > 3 ? ' +' + (row.chains.length - 3) : '') : 'no chain listed') }));
      nameCell.appendChild(nameBox);
      tr.appendChild(nameCell);
      tr.appendChild(numCell(usd(row.tvl_usd)));
      var changeCell = numCell(pct(row.change_7d), row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg');
      tr.appendChild(changeCell);
      tr.appendChild(numCell(ageShort(row.age_days)));
      tr.appendChild(numCell(mult(entry.multiple)));
      var impliedCell = el('td', { className: 'num' });
      var wrap = el('span', { className: 'implied' });
      var bar = el('span', { className: 'bar', 'aria-hidden': 'true' });
      bar.appendChild(el('i', {}));
      bar.firstChild.style.width = Math.max(2, Math.round((entry.implied / MAX_IMPLIED) * 100)) + '%';
      wrap.appendChild(bar);
      wrap.appendChild(el('b', { text: usd(entry.implied) }));
      impliedCell.appendChild(wrap);
      tr.appendChild(impliedCell);
      var statusCell = el('td');
      statusCell.appendChild(el('span', { className: 'badge' + (row.on_watchlist ? ' watch' : ''), text: row.on_watchlist ? 'Watchlist' : 'Early find' }));
      tr.appendChild(statusCell);
      boardBody.appendChild(tr);
    });
  }

  /* ---------- the live-token table ---------- */

  function renderLive() {
    var body = livePanel.querySelector('tbody');
    body.textContent = '';
    var q = state.q.toLowerCase();
    var list = DATA.live.filter(function (row) {
      if (state.category !== 'all' && (row.category || 'Uncategorised') !== state.category) return false;
      if (q && (row.name + ' ' + row.slug + ' ' + (row.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.forEach(function (row, i) {
      var tr = el('tr');
      tr.appendChild(numCell(String(i + 1)));
      var nameCell = el('td');
      var nameBox = el('span', { className: 'name' });
      nameBox.appendChild(el('b', { text: row.name }));
      nameBox.appendChild(el('span', { className: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.slice(0, 2).join(', ') : 'no chain listed') }));
      nameCell.appendChild(nameBox);
      tr.appendChild(nameCell);
      tr.appendChild(numCell(usd(row.tvl_usd)));
      tr.appendChild(numCell(row.mcap_usd === null ? '—' : usd(row.mcap_usd)));
      tr.appendChild(numCell(row.mcap_usd === null || row.tvl_usd <= 0 ? '—' : mult(row.mcap_usd / row.tvl_usd)));
      var statusCell = el('td');
      statusCell.appendChild(el('span', { className: 'badge live', text: 'Live token' }));
      tr.appendChild(statusCell);
      body.appendChild(tr);
    });
    if (list.length === 0) {
      body.appendChild(el('tr')).appendChild(el('td', { colspan: '6', text: 'No live-token protocol matches those filters.' }));
    }
  }

  /* ---------- tabs ---------- */

  function showTab() {
    boardPanel.style.display = state.tab === 'board' ? '' : 'none';
    livePanel.style.display = state.tab === 'live' ? '' : 'none';
    modelPanel.style.display = state.tab === 'model' ? '' : 'none';
    var buttons = document.querySelectorAll('.tabs button');
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-tab') === state.tab ? 'true' : 'false');
    });
    if (state.tab === 'board') renderBoard();
    if (state.tab === 'live') renderLive();
  }

  /* ---------- the detail drawer ---------- */

  var dialog = el('dialog', { className: 'detail', 'aria-labelledby': 'detail-title' });
  document.body.appendChild(dialog);
  dialog.addEventListener('close', function () {
    if (state.p) { state.p = null; writeHash(); renderBoard(); }
  });
  dialog.addEventListener('click', function (ev) {
    var rect = dialog.getBoundingClientRect();
    if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) dialog.close();
  });

  function openDetail(slug) {
    var entry = BY_SLUG[slug];
    if (!entry) return;
    var row = entry.row;
    state.p = slug;
    writeHash();
    dialog.textContent = '';
    var inner = el('div', { className: 'detail-inner' });
    var head = el('div', { className: 'detail-head' });
    var titleBox = el('div');
    titleBox.appendChild(el('p', { className: 'kicker', text: 'Rank #' + row.rank + ' · ' + (row.on_watchlist ? 'Watchlist' : 'Early find') }));
    titleBox.appendChild(el('h2', { id: 'detail-title', text: row.name }));
    titleBox.appendChild(el('p', { className: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.join(', ') : 'no chain listed') + ' · ' + row.slug }));
    head.appendChild(titleBox);
    var closeBtn = el('button', { className: 'close', type: 'button', text: 'Close ✕' });
    closeBtn.addEventListener('click', function () { dialog.close(); });
    head.appendChild(closeBtn);
    inner.appendChild(head);

    var modelSection = el('section', { className: 'detail-section' });
    modelSection.appendChild(el('h3', { text: 'Why this value' }));
    var factorsBox = el('div', { className: 'factors' });
    function factor(label, value) {
      var f = el('div', { className: 'factor' });
      f.appendChild(el('span', { text: label }));
      f.appendChild(el('b', { text: value }));
      factorsBox.appendChild(f);
    }
    factor('Total value locked', usdFull(row.tvl_usd));
    var multLabel = entry.multiple_source === 'category'
      ? 'Category multiple — median of ' + entry.multiple_comps + ' live comps in ' + (row.category || 'this category')
      : 'Category multiple — global median of ' + CALIBRATION.global_comps + ' live comps (only ' + entry.multiple_comps + ' in this category)';
    factor(multLabel, mult(entry.multiple));
    factor('Growth — 7-day change ' + pct(row.change_7d) + (row.change_7d === null ? ' (no figure recorded, neutral)' : ''), '×' + entry.growth.toFixed(3));
    factor('Tenure — listed ' + ageLong(row.age_days) + (row.age_days === null ? ' (assumed 365 days)' : ''), '×' + entry.tenure.toFixed(3));
    factor('Breadth — ' + row.chains.length + (row.chains.length === 1 ? ' chain' : ' chains'), '×' + entry.breadth.toFixed(3));
    var total = el('div', { className: 'factor total' });
    total.appendChild(el('span', { text: 'Implied value' }));
    total.appendChild(el('b', { text: usdFull(entry.implied) }));
    factorsBox.appendChild(total);
    modelSection.appendChild(factorsBox);
    var check = el('p', { className: 'checkline' });
    if (entry.implied === row.implied_value_usd) {
      check.appendChild(document.createTextNode('This page recomputed '));
      check.appendChild(el('b', { text: usdFull(entry.implied) }));
      check.appendChild(document.createTextNode(' from the snapshot figures — it matches the ranked board exactly.'));
    } else {
      check.appendChild(document.createTextNode('Recomputed ' + usdFull(entry.implied) + ' — the board says ' + usdFull(row.implied_value_usd) + '. The two disagree; trust neither until the model is fixed.'));
      check.style.color = 'var(--negative)';
    }
    modelSection.appendChild(check);
    inner.appendChild(modelSection);

    var planSection = el('section', { className: 'detail-section' });
    planSection.appendChild(el('h3', { text: 'Farm plan — seven steps' }));
    var steps = el('ol', { className: 'steps' });
    farmSteps(row).forEach(function (step) {
      var li = el('li');
      var cut = step.lastIndexOf(' Cost: ');
      if (cut !== -1) {
        li.appendChild(el('span', { text: step.slice(0, cut) }));
        li.appendChild(el('span', { className: 'cost', text: step.slice(cut + 1) }));
      } else {
        li.appendChild(el('span', { text: step }));
      }
      steps.appendChild(li);
    });
    planSection.appendChild(steps);
    inner.appendChild(planSection);

    var noteSection = el('section', { className: 'detail-section' });
    var note = el('p', { className: 'note' });
    note.appendChild(el('b', { text: 'Honest wording: ' }));
    note.appendChild(document.createTextNode(row.name + ' records no token in this snapshot. That is not proof it has none, and this plan is not a prediction that it will launch one.'));
    noteSection.appendChild(note);
    inner.appendChild(noteSection);

    dialog.appendChild(inner);
    if (!dialog.open) dialog.showModal();
    closeBtn.focus();
    renderBoard();
  }

  /* ---------- controls ---------- */

  function clearFilters() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; state.minTvl = 0;
    syncControls();
    writeHash();
    renderBoard();
    if (state.tab === 'live') renderLive();
  }

  var searchInput, categorySelect, chainSelect, watchlistInput, minTvlSelect;
  function syncControls() {
    searchInput.value = state.q;
    categorySelect.value = state.category;
    chainSelect.value = state.chain;
    watchlistInput.checked = state.watchlist;
    minTvlSelect.value = String(state.minTvl);
  }

  /* ---------- build the page ---------- */

  function buildPage() {
    var shell = el('div', { className: 'shell' });

    var top = el('header', { className: 'top' });
    var brand = el('div', { className: 'brand' });
    brand.appendChild(el('span', { className: 'radar-mark', 'aria-hidden': 'true' }));
    var brandName = el('span', { className: 'brand-name' });
    brandName.appendChild(document.createTextNode('Token '));
    brandName.appendChild(el('span', { text: 'Radar' }));
    brand.appendChild(brandName);
    top.appendChild(brand);
    var meta = el('p', { className: 'top-meta' });
    meta.appendChild(el('span', { text: 'Snapshot ' }));
    meta.appendChild(el('b', { text: DATA.as_of }));
    meta.appendChild(el('span', { text: 'Model ' }));
    meta.appendChild(el('b', { text: DATA.model_version }));
    meta.appendChild(el('span', { text: 'Floor ' }));
    meta.appendChild(el('b', { text: usd(DATA.floor_usd) }));
    top.appendChild(meta);
    shell.appendChild(top);

    var lede = el('section', { className: 'lede' });
    var intro = el('div');
    intro.appendChild(el('h1', { text: 'Which protocol without a token is worth farming first?' }));
    var p1 = el('p');
    p1.appendChild(document.createTextNode('Every protocol in the snapshot that records no token is ranked by an '));
    p1.appendChild(el('b', { text: 'implied value' }));
    p1.appendChild(document.createTextNode(' calibrated on live-token market caps — not by a list of names, and not by TVL alone. The watchlist is covered in full, and ' + DATA.early_size + ' more pre-token protocols below the floor are ranked beside it, so the next launch is not missed because it is small.'));
    intro.appendChild(p1);
    var p2 = el('p');
    p2.appendChild(document.createTextNode('Open any protocol for the model breakdown and a seven-step farm plan with costs and times. The page recomputes every number from the snapshot figures, in the open.'));
    intro.appendChild(p2);
    lede.appendChild(intro);
    var stats = el('div', { className: 'stats' });
    function stat(label, value, wide) {
      var s = el('div', { className: 'stat' + (wide ? ' wide' : '') });
      s.appendChild(el('span', { text: label }));
      s.appendChild(el('b', { text: value }));
      return s;
    }
    stats.appendChild(stat('Watchlist covered', DATA.watchlist_size + ' of ' + DATA.watchlist_size));
    stats.appendChild(stat('Protocols ranked', String(DATA.board_size)));
    stats.appendChild(stat('Early finds below the floor', String(DATA.early_size)));
    stats.appendChild(stat('Live protocols calibrating the model', String(DATA.live_ratios.length)));
    stats.appendChild(stat('Pre-token records set aside', String(DATA.set_aside)));
    stats.appendChild(stat('Categories with a live multiple', String(CALIBRATION.entries.filter(function (e) { return e.source === 'category'; }).length)));
    stats.appendChild(stat('Total implied value across the board', usd(DATA.total_implied_usd), true));
    lede.appendChild(stats);
    shell.appendChild(lede);

    var controls = el('div', { className: 'controls' });
    var searchField = el('div', { className: 'field' });
    searchField.appendChild(el('label', { for: 'q', text: 'Search' }));
    searchInput = el('input', { id: 'q', type: 'search', placeholder: 'Name, slug or category…', autocomplete: 'off' });
    searchInput.addEventListener('input', function () { state.q = searchInput.value; writeHash(); renderBoard(); if (state.tab === 'live') renderLive(); });
    searchField.appendChild(searchInput);
    controls.appendChild(searchField);

    var categories = [];
    ROWS.forEach(function (e) { var c = e.row.category || 'Uncategorised'; if (categories.indexOf(c) === -1) categories.push(c); });
    categories.sort();
    var catField = el('div', { className: 'field' });
    catField.appendChild(el('label', { for: 'category', text: 'Category' }));
    categorySelect = el('select', { id: 'category' });
    categorySelect.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { categorySelect.appendChild(el('option', { value: c, text: c })); });
    categorySelect.addEventListener('change', function () { state.category = categorySelect.value; writeHash(); renderBoard(); if (state.tab === 'live') renderLive(); });
    catField.appendChild(categorySelect);
    controls.appendChild(catField);

    var chains = [];
    ROWS.forEach(function (e) { e.row.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); }); });
    chains.sort();
    var chainField = el('div', { className: 'field' });
    chainField.appendChild(el('label', { for: 'chain', text: 'Chain' }));
    chainSelect = el('select', { id: 'chain' });
    chainSelect.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (ch) { chainSelect.appendChild(el('option', { value: ch, text: ch })); });
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); renderBoard(); });
    chainField.appendChild(chainSelect);
    controls.appendChild(chainField);

    var watchField = el('div', { className: 'field' });
    watchField.appendChild(el('span', { className: 'label', id: 'watchlist-label', text: 'Scope' }));
    var check = el('label', { className: 'check' });
    watchlistInput = el('input', { type: 'checkbox', 'aria-labelledby': 'watchlist-label' });
    watchlistInput.addEventListener('change', function () { state.watchlist = watchlistInput.checked; writeHash(); renderBoard(); });
    check.appendChild(watchlistInput);
    check.appendChild(document.createTextNode('Watchlist only'));
    watchField.appendChild(check);
    controls.appendChild(watchField);

    var tvlField = el('div', { className: 'field' });
    tvlField.appendChild(el('label', { for: 'minTvl', text: 'Minimum TVL' }));
    minTvlSelect = el('select', { id: 'minTvl' });
    [['0', 'Any TVL'], ['50000000', '$50M and up'], ['100000000', '$100M and up'], ['500000000', '$500M and up'], ['1000000000', '$1B and up']].forEach(function (pair) {
      minTvlSelect.appendChild(el('option', { value: pair[0], text: pair[1] }));
    });
    minTvlSelect.addEventListener('change', function () { state.minTvl = Number(minTvlSelect.value); writeHash(); renderBoard(); });
    tvlField.appendChild(minTvlSelect);
    controls.appendChild(tvlField);

    var tabs = el('div', { className: 'tabs', role: 'group', 'aria-label': 'View' });
    [['board', 'Pre-token board'], ['live', 'Live tokens'], ['model', 'Model & calibration']].forEach(function (pair) {
      var btn = el('button', { type: 'button', 'data-tab': pair[0], 'aria-pressed': 'false', text: pair[1] });
      btn.addEventListener('click', function () { state.tab = pair[0]; writeHash(); showTab(); });
      tabs.appendChild(btn);
    });
    controls.appendChild(tabs);
    boardCount = el('p', { className: 'count' });
    controls.appendChild(boardCount);
    shell.appendChild(controls);

    boardPanel = el('section', { className: 'panel', 'aria-label': 'Pre-token board' });
    var boardWrap = el('div', { className: 'table-wrap' });
    var boardTable = el('table');
    boardCaption = el('caption');
    boardTable.appendChild(boardCaption);
    boardTable.appendChild(el('thead')).appendChild(el('tr'));
    boardBody = el('tbody');
    boardTable.appendChild(boardBody);
    boardWrap.appendChild(boardTable);
    boardPanel.appendChild(boardWrap);
    shell.appendChild(boardPanel);

    livePanel = el('section', { className: 'panel', 'aria-label': 'Live tokens' });
    var liveWrap = el('div', { className: 'table-wrap' });
    var liveTable = el('table');
    liveTable.appendChild(el('caption', { text: 'The 24 largest live-token protocols by market cap, kept apart from the pre-token board. The calibration uses all ' + DATA.live_ratios.length + ' live-token protocols with a market cap and TVL above zero.' }));
    var liveHead = el('thead').appendChild(el('tr'));
    ['#', 'Protocol', 'TVL', 'Market cap', 'Mcap / TVL', 'Status'].forEach(function (label, i) {
      var th = el('th', { scope: 'col', text: label });
      if (i >= 2 && i <= 4) th.className = 'num';
      liveHead.appendChild(th);
    });
    liveTable.appendChild(liveHead.parentNode);
    liveTable.appendChild(el('tbody'));
    liveWrap.appendChild(liveTable);
    livePanel.appendChild(liveWrap);
    shell.appendChild(livePanel);

    modelPanel = buildModelPanel();
    shell.appendChild(modelPanel);

    var foot = el('footer', { className: 'foot' });
    var f1 = el('p');
    f1.appendChild(el('b', { text: 'Source: ' }));
    f1.appendChild(document.createTextNode(DATA.source + '.'));
    foot.appendChild(f1);
    var f2 = el('p');
    f2.appendChild(el('b', { text: 'What this radar is: ' }));
    f2.appendChild(document.createTextNode('an entry’s own model over a sealed snapshot. Implied values are estimates from live-token multiples, not predictions and not financial advice. A protocol “records no token” in this snapshot; that is not proof it has none, and no farm plan here promises a launch.'));
    foot.appendChild(f2);
    shell.appendChild(foot);

    main.textContent = '';
    main.appendChild(shell);
    main.setAttribute('aria-busy', 'false');
  }

  function buildModelPanel() {
    var panel = el('section', { className: 'panel model', 'aria-label': 'Model and calibration' });
    panel.appendChild(el('h2', { text: 'How the radar scores' }));
    var formula = el('p', { className: 'formula' });
    formula.appendChild(document.createTextNode('implied value = TVL × category multiple × growth × tenure × breadth'));
    formula.appendChild(el('br'));
    formula.appendChild(document.createTextNode('multiple = median market-cap-per-TVL of live-token protocols in the category (3 or more comps), else the global median; clamped 0.050–1.500'));
    formula.appendChild(el('br'));
    formula.appendChild(document.createTextNode('growth = 1 + clamp(7-day change, −60%, +120%) × 0.5 · tenure = 0.6 + 0.4 × min(age, 730 days) / 730 · breadth = 1 + 1% per extra chain, capped at +10%'));
    panel.appendChild(formula);

    var grid = el('div', { className: 'model-grid' });
    var left = el('div');
    left.appendChild(el('h3', { text: 'What each factor does' }));
    var bullets = el('ul');
    [
      'The multiple is the market’s own pricing: how much market cap a dollar of TVL carries in this category, taken from protocols that already have a token.',
      'Growth rewards momentum without letting one wild week dominate: the 7-day change is clamped and weighted at half strength.',
      'Tenure rewards protocols that have run a long time with no token recorded — the longer the runway, the larger the overhang.',
      'Breadth rewards a presence on more than one chain, capped so a long chain list cannot swamp the rest.',
      'Ties break by slug, so the ranking is the same on every run. Ranks are 1 to ' + DATA.board_size + ' with no gaps.',
    ].forEach(function (text) { bullets.appendChild(el('li', { text: text })); });
    left.appendChild(bullets);
    left.appendChild(el('h3', { text: 'Who is ranked, and who is set aside' }));
    var aside = el('ul');
    [
      DATA.watchlist_size + ' watchlist protocols, all covered — the floor, never the ceiling.',
      DATA.early_size + ' further pre-token protocols below the floor, ranked beside the watchlist.',
      DATA.set_aside + ' pre-token records set aside by the watchlist’s own rule, applied at every TVL: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, names ending in a version marker, names carrying a whole word wrapped, staked or staking, and names beginning with an exchange’s name. Each is a wrapped, staked or bridged product of a token that already trades, not a protocol still to launch one.',
      'Live-token protocols never appear on the board. The 24 largest are shown on the Live tokens tab, with their market values.',
    ].forEach(function (text) { aside.appendChild(el('li', { text: text })); });
    left.appendChild(aside);
    grid.appendChild(left);

    var right = el('div');
    right.appendChild(el('h3', { text: 'Calibration — recomputed in this page' }));
    var calibNote = el('p', { text: 'Medians from ' + DATA.live_ratios.length + ' live-token protocols. Categories with fewer than 3 comps fall back to the global median.' });
    right.appendChild(calibNote);
    var table = el('table', { className: 'calib' });
    var head = el('tr');
    head.appendChild(el('th', { scope: 'col', text: 'Category' }));
    head.appendChild(el('th', { scope: 'col', className: 'num', text: 'Multiple' }));
    head.appendChild(el('th', { scope: 'col', className: 'num', text: 'Comps' }));
    head.appendChild(el('th', { scope: 'col', text: 'Source' }));
    table.appendChild(el('thead')).appendChild(head);
    var body = el('tbody');
    var entries = CALIBRATION.entries.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    entries.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: e.category === null ? 'Uncategorised' : e.category }));
      tr.appendChild(el('td', { className: 'num', text: mult(e.multiple) }));
      tr.appendChild(el('td', { className: 'num', text: String(e.comps) }));
      tr.appendChild(el('td', { text: e.source === 'category' ? 'Category median' : 'Global median' }));
      body.appendChild(tr);
    });
    var globalRow = el('tr');
    globalRow.appendChild(el('td', { text: 'All live-token protocols' }));
    globalRow.appendChild(el('td', { className: 'num', text: mult(CALIBRATION.global_multiple) }));
    globalRow.appendChild(el('td', { className: 'num', text: String(CALIBRATION.global_comps) }));
    globalRow.appendChild(el('td', { text: 'Global median' }));
    body.appendChild(globalRow);
    table.appendChild(body);
    right.appendChild(table);
    grid.appendChild(right);
    panel.appendChild(grid);

    var note = el('p', { className: 'note' });
    note.appendChild(el('b', { text: 'A note on honesty: ' }));
    note.appendChild(document.createTextNode('the snapshot records which protocols have a token on file. This radar says a protocol “records no token” — never that it has none — and its farm plans never promise a launch, an airdrop, or a return.'));
    panel.appendChild(note);
    return panel;
  }

  /* ---------- go ---------- */

  readHash();
  buildPage();
  syncControls();
  showTab();
  window.addEventListener('hashchange', function () {
    var wasP = state.p;
    readHash();
    syncControls();
    showTab();
    if (state.p && state.p !== wasP) openDetail(state.p);
    if (!state.p && dialog.open) dialog.close();
  });
  if (state.p) openDetail(state.p);
})();
