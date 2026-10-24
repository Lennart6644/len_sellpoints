const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'len_sellpoints';
const $ = (id) => document.getElementById(id);
const app = $('app');
const receiptRoot = $('receiptRoot');

const state = {
    open: false,
    T: {},
    lang: 'de',
    currency: '$',
    limit: 500,
    items: [],
    offer: {},
    view: 'all',
    search: '',
    sort: 'price_asc',
    pay: 'all',
    earned: 0,
    refreshLeft: 0,
    refreshing: false,
    refreshTimer: null,
    busy: false,
    modal: null,
    modalQty: 1,
    successTimer: null
};

const SORTERS = {
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    name: (a, b) => a.label.localeCompare(b.label, state.lang),
    stock: (a, b) => b.count - a.count
};

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const fmt = (n) => new Intl.NumberFormat(state.lang === 'de' ? 'de-DE' : 'en-US').format(Math.round(n));
const money = (n) => state.currency + fmt(n);
const t = (key, vars) => {
    let s = state.T[key] || key;
    if (vars) {
        for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    }
    return s;
};
const itemByName = (name) => state.items.find((i) => i.name === name);
const imgPath = (name) => `nui://ox_inventory/web/images/${name}.png`;
const ratioOf = (it) => Math.max(0, Math.min(1, (it.price - it.min) / Math.max(1, it.max - it.min)));
const capOf = (it) => Math.max(0, Math.min(it.count, state.limit));
const available = (it) => Math.max(0, capOf(it) - (state.offer[it.name] || 0));

function colorFor(ratio) {
    const red = [231, 76, 60];
    const yellow = [241, 196, 15];
    const green = [46, 204, 113];
    let a, b, k;
    if (ratio < 0.5) {
        a = red; b = yellow; k = ratio * 2;
    } else {
        a = yellow; b = green; k = (ratio - 0.5) * 2;
    }
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function tierKey(r) {
    if (r < 0.25) return 'tier_low';
    if (r < 0.5) return 'tier_fair';
    if (r < 0.8) return 'tier_good';
    return 'tier_top';
}

function trendOf(it) {
    const diff = it.price - it.prev;
    const pct = it.prev ? Math.round((Math.abs(diff) / it.prev) * 100) : 0;
    if (diff > 0) return { dir: 'up', icon: '▲', label: t('trend_up'), pct };
    if (diff < 0) return { dir: 'down', icon: '▼', label: t('trend_down'), pct };
    return { dir: 'same', icon: '■', label: t('trend_same'), pct: 0 };
}

async function post(endpoint, body) {
    try {
        const r = await fetch(`https://${RES}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        return await r.json();
    } catch (e) {
        return { error: 'err_sell' };
    }
}

function toast(text, type) {
    const el = document.createElement('div');
    el.className = `toast ${type || 'info'}`;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 300);
    }, 2800);
}

function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
}

function applyLocale(msg) {
    state.T = msg.strings || {};
    state.lang = msg.locale || 'de';
    state.currency = msg.currency || '$';
    if (msg.limit) state.limit = msg.limit;
    applyStatic();
    Object.values(dropdowns).forEach(paintDropdown);
}

const dropdowns = {};

function createDropdown(id, options, onChange) {
    const root = $(id);
    root.innerHTML = `
        <button class="dd-btn" type="button">
            <span class="dd-label"></span>
            <svg class="dd-chev" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="dd-menu"></div>`;
    const dd = { id, root, options, value: options[0].value, onChange };
    root.querySelector('.dd-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !root.classList.contains('open');
        closeDropdowns();
        if (willOpen) root.classList.add('open');
    });
    root.querySelector('.dd-menu').addEventListener('click', (e) => {
        const item = e.target.closest('.dd-item');
        if (!item) return;
        e.stopPropagation();
        dd.value = item.dataset.value;
        paintDropdown(dd);
        closeDropdowns();
        dd.onChange(dd.value);
    });
    dropdowns[id] = dd;
    paintDropdown(dd);
    return dd;
}

function paintDropdown(dd) {
    const cur = dd.options.find((o) => o.value === dd.value) || dd.options[0];
    dd.root.querySelector('.dd-label').textContent = t(cur.key);
    dd.root.querySelector('.dd-menu').innerHTML = dd.options.map((o) => {
        const active = o.value === dd.value;
        return `<div class="dd-item${active ? ' active' : ''}" data-value="${esc(o.value)}">
            <span>${t(o.key)}</span>${active ? '<span class="dd-check">✓</span>' : ''}
        </div>`;
    }).join('');
}

function closeDropdowns() {
    Object.values(dropdowns).forEach((d) => d.root.classList.remove('open'));
}

document.addEventListener('click', closeDropdowns);

createDropdown('ddSort', [
    { value: 'price_asc', key: 'sort_price_asc' },
    { value: 'price_desc', key: 'sort_price_desc' },
    { value: 'name', key: 'sort_name' },
    { value: 'stock', key: 'sort_stock' }
], (v) => {
    state.sort = v;
    renderGrid();
});

createDropdown('ddPay', [
    { value: 'all', key: 'pay_all' },
    { value: 'clean', key: 'filter_clean' },
    { value: 'dirty', key: 'filter_dirty' }
], (v) => {
    state.pay = v;
    renderGrid();
});

function cardHTML(it) {
    const r = ratioOf(it);
    const color = colorFor(r);
    const tr = trendOf(it);
    const unowned = it.count <= 0;
    const inList = state.offer[it.name] ? ' in-list' : '';
    return `
    <div class="card${unowned ? ' unowned' : ''}${inList}" data-name="${esc(it.name)}" style="--accent:${color}">
        <button class="chip-max" data-max="${esc(it.name)}" ${available(it) <= 0 ? 'disabled' : ''}>${t('max_btn')}</button>
        <span class="stock">${it.count}×</span>
        <div class="thumb"><img src="${imgPath(it.name)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <div class="label">${esc(it.label)}</div>
        <div class="price" style="color:${color}">${money(it.price)}</div>
        <div class="gauge"><span style="width:${(r * 100).toFixed(1)}%"></span></div>
        <div class="meta">
            <span class="pay-badge ${it.black ? 'dirty' : 'clean'}">${t(it.black ? 'pay_dirty' : 'pay_cash')}</span>
            <span class="trend ${tr.dir}">${tr.icon}${tr.pct ? ' ' + tr.pct + '%' : ''}</span>
        </div>
    </div>`;
}

function renderGrid() {
    const q = state.search.trim().toLowerCase();
    const list = state.items
        .filter((it) => state.view === 'all' || it.count > 0)
        .filter((it) => state.pay === 'all' || (state.pay === 'dirty') === it.black)
        .filter((it) => !q || it.label.toLowerCase().includes(q))
        .sort(SORTERS[state.sort]);

    $('grid').innerHTML = list.length
        ? list.map(cardHTML).join('')
        : `<div class="empty">${t(state.view === 'owned' ? 'empty_owned' : 'empty_market')}</div>`;
}

function offerRows() {
    return Object.entries(state.offer)
        .map(([name, amt]) => [itemByName(name), amt])
        .filter(([it]) => it);
}

function offerRowHTML(it, amt) {
    const cap = Math.max(1, capOf(it));
    const pct = cap > 1 ? ((amt - 1) / (cap - 1)) * 100 : 100;
    return `
    <div class="offer-row" data-name="${esc(it.name)}">
        <div class="o-top">
            <div class="o-img"><img src="${imgPath(it.name)}" alt="" onerror="this.style.visibility='hidden'"></div>
            <div class="o-info">
                <div class="o-name">${esc(it.label)}</div>
                <div class="o-unit">${money(it.price)} · ${t('piece')}</div>
            </div>
            <button class="o-remove" data-act="remove">✕</button>
        </div>
        <div class="o-slider">
            <input type="range" min="1" max="${cap}" value="${amt}" data-act="range" style="--p:${pct.toFixed(1)}%">
            <button class="o-max" data-act="max" ${it.count <= 0 ? 'disabled' : ''}>${t('max_btn')}</button>
        </div>
        <div class="o-foot">
            <span class="o-amt">${amt}<small> / ${cap}</small></span>
            <strong>${money(it.price * amt)}</strong>
        </div>
    </div>`;
}

function renderOffer() {
    const rows = offerRows();
    $('offerList').innerHTML = rows.length
        ? rows.map(([it, amt]) => offerRowHTML(it, amt)).join('')
        : `<div class="empty small">${t('offer_empty')}</div>`;
    renderOfferFooter();
}

function renderOfferFooter() {
    const rows = offerRows();
    let total = 0;
    let count = 0;
    rows.forEach(([it, amt]) => {
        total += it.price * amt;
        count += amt;
    });
    $('offerTotal').textContent = money(total);
    $('offerCount').textContent = t('offer_items', { count });
    $('sellBtn').textContent = `${t('sell')} · ${money(total)}`;
    $('sellBtn').disabled = state.busy || count === 0;
    $('clearBtn').disabled = state.busy || count === 0;
    $('allBtn').disabled = state.busy || !state.items.some((i) => capOf(i) > 0 && available(i) > 0);
}

function updateOfferRow(name) {
    const row = document.querySelector(`.offer-row[data-name="${CSS.escape(name)}"]`);
    const it = itemByName(name);
    const amt = state.offer[name];
    if (!row || !it || !amt) return;
    const cap = Math.max(1, capOf(it));
    const pct = cap > 1 ? ((amt - 1) / (cap - 1)) * 100 : 100;
    row.querySelector('input[type=range]').style.setProperty('--p', `${pct.toFixed(1)}%`);
    row.querySelector('.o-amt').innerHTML = `${amt}<small> / ${cap}</small>`;
    row.querySelector('.o-foot strong').textContent = money(it.price * amt);
}

function setOffer(name, value) {
    const it = itemByName(name);
    if (!it) return;
    const cap = capOf(it);
    const v = Math.max(0, Math.min(cap, Math.floor(Number(value)) || 0));
    if (v > 0) state.offer[name] = v;
    else delete state.offer[name];
    renderAll();
}

function addToOffer(name, qty) {
    const it = itemByName(name);
    if (!it) return;
    const avail = available(it);
    if (avail <= 0) {
        if (state.limit < it.count) toast(t('err_limit', { max: state.limit }), 'warn');
        return;
    }
    const add = Math.min(avail, Math.max(1, Math.floor(Number(qty)) || 1));
    state.offer[name] = (state.offer[name] || 0) + add;
    renderAll();
}

function updateEarned() {
    $('earned').textContent = money(state.earned);
}

function renderAll() {
    renderGrid();
    renderOffer();
    updateEarned();
    if (state.modal) paintModal(true);
}

function modalItem() {
    return state.modal ? itemByName(state.modal) : null;
}

function clampModalQty(it, v) {
    const max = available(it);
    if (max <= 0) return 0;
    return Math.max(1, Math.min(max, Math.floor(Number(v)) || 1));
}

function paintModal(writeInput) {
    const it = modalItem();
    if (!it) return;

    const r = ratioOf(it);
    const color = colorFor(r);
    const tr = trendOf(it);
    const avail = available(it);
    const owned = it.count > 0;
    const qty = avail > 0 ? clampModalQty(it, $('mQty').value) : 0;
    const total = it.price * qty;
    const pct = it.ref ? ((it.price - it.ref) / it.ref) * 100 : 0;
    const dec = state.lang === 'de' ? ',' : '.';
    const inOffer = state.offer[it.name] || 0;
    const canAdd = avail > 0 && !state.busy;

    $('mImg').src = imgPath(it.name);
    $('mLabel').textContent = it.label;
    $('mPay').textContent = t(it.black ? 'pay_dirty' : 'pay_cash');
    $('mPay').className = `pay-badge ${it.black ? 'dirty' : 'clean'}`;
    $('mPrice').textContent = money(it.price);
    $('mPrice').style.color = color;
    $('mRef').textContent = money(it.ref);
    $('mDelta').textContent = `${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', dec)}%`;
    $('mDelta').className = `delta ${pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'same'}`;
    $('mMarker').style.left = `${Math.max(4, Math.min(96, r * 100)).toFixed(1)}%`;
    $('mMarkerLabel').textContent = money(it.price);
    $('mMinV').textContent = money(it.min);
    $('mMaxV').textContent = money(it.max);
    $('mTier').textContent = t(tierKey(r));
    $('mTier').style.color = color;
    $('mTrend').innerHTML = `<span class="trend ${tr.dir}">${tr.icon} ${tr.label}${tr.pct ? ' · ' + tr.pct + '%' : ''}</span>`;
    $('mOwned').textContent = String(it.count);
    $('mInOffer').textContent = inOffer ? `${t('offer_in')}: ${inOffer}` : (owned ? '' : t('not_owned'));

    if (writeInput) $('mQty').value = qty || 1;
    $('mQty').max = Math.max(1, avail);
    $('mQty').disabled = !canAdd;
    $('mUnit').textContent = money(it.price);
    $('mTotal').textContent = avail > 0 ? money(total) : '—';
    $('mAdd').textContent = avail > 0
        ? `${t('offer_add')} · ${money(total)}`
        : t(owned ? 'offer_full' : 'not_owned');
    $('mAdd').disabled = !canAdd || qty <= 0;
    $('mMaxBtn').disabled = !canAdd;
    $('mMinus').disabled = !canAdd || qty <= 1;
    $('mPlus').disabled = !canAdd || qty >= avail;
}

function openModal(name, qty) {
    const it = itemByName(name);
    if (!it) return;
    state.modal = name;
    $('mQty').value = clampModalQty(it, qty || 1) || 1;
    paintModal(true);
    $('modal').classList.remove('hidden');
}

function closeModal() {
    state.modal = null;
    $('modal').classList.add('hidden');
}

function stepQty(delta) {
    const it = modalItem();
    if (!it || available(it) <= 0) return;
    $('mQty').value = clampModalQty(it, (Math.floor(Number($('mQty').value)) || 1) + delta);
    paintModal(true);
}

function showSuccess(res) {
    const el = $('success');
    $('sSub').textContent = t('sold_total', { count: res.sold, money: money(res.earned) });
    $('sRec').textContent = res.receiptNo ? t('receipt_saved', { number: res.receiptNo }) : '';
    el.classList.remove('hidden', 'play');
    void el.offsetWidth;
    el.classList.add('play');
    clearTimeout(state.successTimer);
    state.successTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

async function runSale(list) {
    if (state.busy || !list.length) return;
    state.busy = true;
    renderAll();

    const res = await post('sell', { cart: list });

    state.busy = false;
    if (res.data) applyData(res.data);

    if (res.ok) {
        state.earned += res.earned;
        state.offer = {};
        closeModal();
        showSuccess(res);
    } else if (res.error) {
        toast(t(res.error, res.vars), 'error');
    }
    renderAll();
}

function paintRefresh() {
    const m = Math.floor(state.refreshLeft / 60);
    const s = state.refreshLeft % 60;
    $('refreshTimer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startRefresh(seconds) {
    state.refreshLeft = Math.max(0, seconds | 0);
    paintRefresh();
    if (!state.refreshTimer) {
        state.refreshTimer = setInterval(tickRefresh, 1000);
    }
}

async function tickRefresh() {
    if (!state.open) return;
    if (state.refreshLeft > 0) {
        state.refreshLeft--;
        paintRefresh();
        return;
    }
    if (state.refreshing) return;
    state.refreshing = true;
    const res = await post('refresh');
    state.refreshing = false;
    if (res.data) {
        applyData(res.data);
        toast(t('refreshed'), 'info');
    } else {
        state.refreshLeft = 30;
        paintRefresh();
    }
}

function applyData(data) {
    state.items = data.items || [];
    $('shopName').textContent = data.shop.name;
    startRefresh(data.nextRefresh);

    for (const name of Object.keys(state.offer)) {
        const it = itemByName(name);
        if (!it || capOf(it) <= 0) {
            delete state.offer[name];
        } else {
            state.offer[name] = Math.min(state.offer[name], capOf(it));
        }
    }

    if (state.modal && !modalItem()) closeModal();
}

function barcodeHTML(seed) {
    const s = String(seed || '0');
    let out = '';
    for (const ch of s) {
        const c = ch.charCodeAt(0);
        out += `<i style="width:${1 + (c % 3)}px"></i><i style="width:${1 + ((c >> 1) % 2)}px;background:transparent"></i>`;
    }
    return out;
}

function showReceipt(msg) {
    applyLocale(msg);
    const r = msg.receipt || {};
    const lines = Array.isArray(r.lines) ? r.lines : [];
    const hasData = lines.length > 0 || !!r.number;
    const units = Number(r.units) || lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const total = Number(r.total) || lines.reduce((s, l) => s + (Number(l.total) || 0), 0);

    const rows = lines.map((l, i) => `
            <div class="r-row" style="--i:${i}">
                <span class="r-row-name">${esc(l.label || '—')}</span>
                <span class="r-row-sum">${money(l.total || 0)}</span>
                <span class="r-row-calc">${esc(l.amount || 0)} × ${money(l.unit || 0)}</span>
            </div>`).join('');

    const body = hasData
        ? `<div class="r-list">${rows}</div>`
        : `<div class="r-empty"><div class="r-empty-icon">!</div>${t('receipt_empty')}</div>`;

    receiptRoot.innerHTML = `
        <div class="r-wrap">
            <div class="paper">
                <header class="r-head">
                    <div class="r-logo">◆</div>
                    <div class="r-shop">${esc(r.shop || '—')}</div>
                    <div class="r-tag">${t('receipt_title')}</div>
                </header>
                <div class="r-info">
                    <div><span>${t('receipt_number')}</span><strong>${esc(r.number || '—')}</strong></div>
                    <div><span>${t('receipt_date')}</span><strong>${esc(r.date || '—')}</strong></div>
                    <div><span>${t('receipt_payment')}</span><strong>${t('pay_cash')}</strong></div>
                </div>
                <div class="r-sep"></div>
                ${hasData ? `<div class="r-intro">${t('receipt_intro')}</div>
                <div class="r-cols"><span>${t('receipt_item')}</span><span>${t('receipt_sum')}</span></div>` : ''}
                ${body}
                <div class="r-sep double"></div>
                <div class="r-count"><span>${t('offer_items', { count: units })}</span></div>
                <div class="r-total"><span>${t('receipt_total')}</span><strong>${money(total)}</strong></div>
                <div class="r-sep"></div>
                <div class="r-barcode">${barcodeHTML(r.number)}</div>
                <div class="r-barcode-num">${esc(r.number || '')}</div>
                <div class="r-thanks">${t('receipt_thanks')}</div>
                <button class="btn r-close">${t('receipt_close')}</button>
            </div>
        </div>`;

    receiptRoot.classList.remove('hidden');
}

function closeReceipt() {
    if (receiptRoot.classList.contains('hidden')) return;
    receiptRoot.classList.add('hidden');
    post('closeReceipt');
}

receiptRoot.addEventListener('click', (e) => {
    if (e.target === receiptRoot || e.target.closest('.r-close')) closeReceipt();
});

function openUI(msg) {
    applyLocale(msg);
    state.open = true;
    state.offer = {};
    state.search = '';
    $('search').value = '';
    app.classList.remove('hidden');
    applyData(msg.data);
    renderAll();
}

function hideUI() {
    state.open = false;
    state.offer = {};
    state.modal = null;
    $('modal').classList.add('hidden');
    $('success').classList.add('hidden');
    app.classList.add('hidden');
}

function closeUI() {
    if (!state.open) return;
    hideUI();
    post('close');
}

window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.action === 'open') openUI(d);
    else if (d.action === 'close') hideUI();
    else if (d.action === 'receipt') showReceipt(d);
});

$('grid').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-max');
    if (chip) {
        const it = itemByName(chip.dataset.max);
        if (it) addToOffer(it.name, available(it));
        return;
    }
    const card = e.target.closest('.card');
    if (card) openModal(card.dataset.name, 1);
});

$('offerList').addEventListener('click', (e) => {
    const info = e.target.closest('.o-img, .o-name, .o-unit');
    if (info) {
        const infoRow = info.closest('.offer-row');
        if (infoRow) openModal(infoRow.dataset.name, state.offer[infoRow.dataset.name]);
        return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.offer-row');
    if (!row) return;
    const name = row.dataset.name;
    const it = itemByName(name);
    if (!it) return;
    if (btn.dataset.act === 'remove') setOffer(name, 0);
    if (btn.dataset.act === 'max') setOffer(name, capOf(it));
});

$('offerList').addEventListener('input', (e) => {
    if (e.target.dataset.act !== 'range') return;
    const name = e.target.closest('.offer-row').dataset.name;
    state.offer[name] = Math.max(1, Math.min(capOf(itemByName(name)), parseInt(e.target.value, 10) || 1));
    updateOfferRow(name);
    renderOfferFooter();
});

$('offerList').addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'range') return;
    const name = e.target.closest('.offer-row').dataset.name;
    setOffer(name, parseInt(e.target.value, 10));
});

document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderGrid();
    });
});

$('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
});

$('closeBtn').addEventListener('click', closeUI);
$('mClose').addEventListener('click', closeModal);
$('mCancel').addEventListener('click', closeModal);
$('mMinus').addEventListener('click', () => stepQty(-1));
$('mPlus').addEventListener('click', () => stepQty(1));
$('mMaxBtn').addEventListener('click', () => {
    const it = modalItem();
    if (!it) return;
    $('mQty').value = available(it);
    paintModal(true);
});
$('mQty').addEventListener('input', () => paintModal(false));
$('mQty').addEventListener('blur', () => paintModal(true));

$('mAdd').addEventListener('click', () => {
    const it = modalItem();
    if (!it) return;
    const qty = clampModalQty(it, $('mQty').value);
    addToOffer(it.name, qty);
    closeModal();
});

$('clearBtn').addEventListener('click', () => {
    state.offer = {};
    renderAll();
});

$('allBtn').addEventListener('click', () => {
    state.items.forEach((it) => {
        const cap = capOf(it);
        if (cap > 0) state.offer[it.name] = cap;
    });
    renderAll();
});

$('sellBtn').addEventListener('click', () => {
    const list = offerRows().map(([it, amt]) => ({ name: it.name, amount: amt }));
    runSale(list);
});

document.addEventListener('keyup', (e) => {
    if (e.key !== 'Escape') return;
    if (!receiptRoot.classList.contains('hidden')) closeReceipt();
    else if (state.modal) closeModal();
    else closeUI();
});

paintRefresh();
