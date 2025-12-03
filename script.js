
const searchInput = document.getElementById('searchInput');
const resultsTableBody = document.querySelector('#resultsTable tbody');
const languageFilter = document.getElementById('languageFilter');
// filter state for single-value category/period (toggle by clicking table cells)
let selectedCategory = '';
let selectedPeriod = '';
const searchField = document.getElementById('searchField');
const showMoreBtn = document.getElementById('showMoreBtn');
const unpinAllBtn = document.getElementById('unpinAllBtn');

let data = [];
const MAX_RESULTS = 30;
let currentLimit = MAX_RESULTS;
let lastFilteredRows = [];
// highlight state for rendering
let currentSearchRaw = '';
let currentHasWildcard = false;
let highlightRegex = null; // global regex with 'gi' for highlighting
// pinned IDs (strings)
let pinnedIds = [];
// drag state for pinned ordering
let dragState = { draggingId: null };

function loadPins(){
    try{
        const raw = localStorage.getItem('cappelli_pins');
        if (raw) pinnedIds = JSON.parse(raw) || [];
    }catch(e){ pinnedIds = []; }
}

function savePins(){
    try{ localStorage.setItem('cappelli_pins', JSON.stringify(pinnedIds)); }catch(e){}
}

function togglePin(id){
    id = String(id);
    const i = pinnedIds.indexOf(id);
    if (i === -1) {
        // add to end (new pins appear below existing pinned items)
        pinnedIds.push(id);
    } else {
        pinnedIds.splice(i,1);
    }
    savePins();
    // re-render current filtered list; keep currentLimit
    displayData(lastFilteredRows);
}

function getPinnedRows(){
    // map pinnedIds to rows in full data in the stored order
    const map = new Map(data.map(r => [String(r.id), r]));
    return pinnedIds.map(id => map.get(String(id))).filter(Boolean);
}

async function loadData() {
    const response = await fetch('source/cappelli.csv');
    const text = await response.text();
    data = parseCSV(text);
    loadPins();
    populateFilters(data);
    lastFilteredRows = data;
    currentLimit = MAX_RESULTS;
    displayData(data);
    // initialize the humorous Cappelli CAPTCHA once data is ready
    initCaptcha();
}

function parseCSV(text) {
    // Robust simple CSV parser for semicolon-separated file
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
    if (lines.length === 0) return [];
    const headers = lines[0].split(';').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(';');
        // if there are fewer columns, pad with empty strings
        while (values.length < headers.length) values.push('');
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = (values[j] || '').trim();
        }
        rows.push(row);
    }
    return rows;
}

function displayData(rows) {
    resultsTableBody.innerHTML = '';
    // pinned rows (always shown on top)
    const pinnedRows = getPinnedRows();
    // non-pinned rows are the filtered rows excluding pinned ones
    const nonPinnedRows = rows.filter(r => !pinnedIds.includes(String(r.id)));
    const totalNonPinned = nonPinnedRows.length;
    const toShowNonPinned = nonPinnedRows.slice(0, currentLimit);
    const toShow = pinnedRows.concat(toShowNonPinned);

    for (const row of toShow) {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', String(row.id));
        const imgPath = `source/img_abbr/${row.id}.jpg`;
        const isPinned = pinnedIds.indexOf(String(row.id)) !== -1;
        const periodText = row.period || '';
        const periodColors = colorForPeriod(periodText);
        const periodHtml = periodText ? `<span class="period-tag" style="background:${periodColors.bg};color:${periodColors.fg}" title="${escapeHtml(periodText)}">${escapeHtml(periodText)}</span>` : '';
        tr.innerHTML = `
            <td><input type="checkbox" class="pin-checkbox" data-id="${row.id}" ${isPinned ? 'checked' : ''} title="${isPinned ? 'Unpin this abbreviation' : 'Pin this abbreviation'}"></td>
            <td><img src="${imgPath}" alt="${row.characters}" onerror="this.style.opacity=0.4;this.style.filter='grayscale(1)';"></td>
            <td class="chars">${highlightHtml(row.characters)}</td>
            <td>${highlightHtml(row.transcription)}</td>
            <td class="cell-filter" data-filter-type="category" data-filter-value="${escapeHtml(row.category)}">${escapeHtml(row.category)}</td>
            <td class="cell-filter" data-filter-type="period" data-filter-value="${escapeHtml(row.period)}">${periodHtml}</td>
            <td class="cell-filter" data-filter-type="language" data-filter-value="${escapeHtml(row.language)}">${escapeHtml(row.language)}</td>
        `;
        // wire pin toggle
        resultsTableBody.appendChild(tr);
        const chk = tr.querySelector('.pin-checkbox');
        if (chk) {
            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = chk.getAttribute('data-id');
                togglePin(id);
            });
        }
        // drag & drop handlers for pinned rows: enable reordering
        if (isPinned) {
            tr.draggable = true;
            tr.classList.add('pinned-row');
            tr.addEventListener('dragstart', (ev) => {
                dragState.draggingId = String(row.id);
                tr.classList.add('dragging');
                try { ev.dataTransfer.setData('text/plain', String(row.id)); ev.dataTransfer.effectAllowed = 'move'; } catch(e){}
            });
            tr.addEventListener('dragend', (ev) => {
                dragState.draggingId = null;
                tr.classList.remove('dragging');
                // cleanup any drag-over classes
                document.querySelectorAll('tr.drag-over').forEach(x => x.classList.remove('drag-over'));
            });
            tr.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                // only show drag-over on pinned rows
                if (!tr.classList.contains('drag-over')) {
                    document.querySelectorAll('tr.drag-over').forEach(x => x.classList.remove('drag-over'));
                    tr.classList.add('drag-over');
                }
            });
            tr.addEventListener('dragleave', (ev) => {
                tr.classList.remove('drag-over');
            });
            tr.addEventListener('drop', (ev) => {
                ev.preventDefault();
                const sourceId = (ev.dataTransfer && ev.dataTransfer.getData) ? ev.dataTransfer.getData('text/plain') : dragState.draggingId;
                const targetId = String(row.id);
                if (!sourceId || sourceId === targetId) return;
                // reorder pinnedIds: move source before target
                const sIndex = pinnedIds.indexOf(String(sourceId));
                if (sIndex === -1) return;
                // remove source
                pinnedIds.splice(sIndex, 1);
                const tIndex = pinnedIds.indexOf(String(targetId));
                if (tIndex === -1) {
                    // append at end
                    pinnedIds.push(String(sourceId));
                } else {
                    pinnedIds.splice(tIndex, 0, String(sourceId));
                }
                savePins();
                // re-render to reflect new ordering
                displayData(lastFilteredRows);
            });
        }
        // add pinned-row class for visual highlight
    }

    // Show/hide the Show more button (only counts non-pinned rows)
    if (totalNonPinned > currentLimit) {
        showMoreBtn.style.display = 'inline-block';
        const remaining = totalNonPinned - currentLimit;
        showMoreBtn.textContent = `Show more (${Math.min(remaining, MAX_RESULTS)} more)`;
    } else {
        showMoreBtn.style.display = 'none';
    }
    // Update header button emoji and tooltip depending on whether any pins exist
    try {
        if (unpinAllBtn) {
            if (pinnedIds && pinnedIds.length) {
                unpinAllBtn.textContent = '✖';
                unpinAllBtn.title = 'Unpin all saved abbreviations';
                unpinAllBtn.setAttribute('aria-label', 'Unpin all abbreviations');
            } else {
                unpinAllBtn.textContent = '📌';
                unpinAllBtn.title = 'No pinned abbreviations';
                unpinAllBtn.setAttribute('aria-label', 'No pinned abbreviations');
            }
        }
    } catch (e) { /* ignore */ }
}

function escapeHtml(s){
    if (!s) return '';
    return s.replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helpers for choosing a background color for a period tag
function hexToRgb(hex) {
    const h = hex.replace('#','');
    return {
        r: parseInt(h.substring(0,2),16),
        g: parseInt(h.substring(2,4),16),
        b: parseInt(h.substring(4,6),16)
    };
}

function colorForPeriod(period){
    const p = String(period || '').trim();
    if (!p) return { bg: '#eeeeee', fg: '#000' };
    const palette = ['#fff59d','#aed581','#81d4fa','#ce93d8','#ffcc80','#b0bec5','#f48fb1','#a5d6a7','#ffe082','#4dd0e1'];
    let sum = 0;
    for (let i = 0; i < p.length; i++) sum += p.charCodeAt(i);
    const idx = sum % palette.length;
    const bg = palette[idx];
    const rgb = hexToRgb(bg);
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const fg = lum > 0.6 ? '#000' : '#fff';
    return { bg, fg };
}

function highlightHtml(text) {
    if (!text) return '';
    const s = String(text);
    if (!highlightRegex) return escapeHtml(s);
    // run global highlighting using highlightRegex (should have 'g' and 'i')
    const re = highlightRegex;
    let result = '';
    let lastIndex = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        result += escapeHtml(s.slice(lastIndex, start));
        result += '<mark class="match">' + escapeHtml(s.slice(start, end)) + '</mark>';
        lastIndex = end;
        // avoid infinite loop for zero-length matches
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    result += escapeHtml(s.slice(lastIndex));
    return result;
}

function populateFilters(rows){
    const langs = new Set();
    rows.forEach(r => { if (r.language) langs.add(r.language); });

    Array.from(langs).sort().forEach(l => {
        const o = document.createElement('option'); o.value = l; o.textContent = l; languageFilter.appendChild(o);
    });
}

function showDetails(row){
    // details removed — function deprecated
}

searchInput.addEventListener('input', () => applyFilters());
languageFilter.addEventListener('change', applyFilters);
searchField.addEventListener('change', applyFilters);
showMoreBtn.addEventListener('click', () => {
    currentLimit += MAX_RESULTS;
    displayData(lastFilteredRows);
});
if (unpinAllBtn) {
    unpinAllBtn.addEventListener('click', () => {
        if (pinnedIds && pinnedIds.length) {
            pinnedIds = [];
            savePins();
            displayData(lastFilteredRows);
        } else {
            // no-op when there are no pins; briefly update title for feedback
            unpinAllBtn.title = 'No pinned abbreviations';
            setTimeout(() => { if (unpinAllBtn) unpinAllBtn.title = 'Pin header'; }, 900);
        }
    });
}
// clicking a category/period/language cell toggles single-value category/period filters or sets language
resultsTableBody.addEventListener('click', (e) => {
    const td = e.target.closest('td.cell-filter');
    if (!td) return;
    const type = td.getAttribute('data-filter-type');
    const val = td.getAttribute('data-filter-value') || '';
    if (type === 'category') {
        // toggle category filter (single value)
        selectedCategory = (selectedCategory === val) ? '' : val;
        applyFilters();
    } else if (type === 'language') {
        languageFilter.value = val;
        applyFilters();
    } else if (type === 'period') {
        selectedPeriod = (selectedPeriod === val) ? '' : val;
        applyFilters();
    }
});
// no pin icon selector — single nicer icon used

function applyFilters(){
    const searchTerm = searchInput.value.toLowerCase();
    const lang = languageFilter.value;
    // single-value selectedCategory / selectedPeriod filters (toggle by clicking table cells)
    const baseFiltered = data.filter(row => {
        const matchesLang = !lang || row.language === lang;
        const matchesCat = !selectedCategory || row.category === selectedCategory;
        const matchesPeriod = !selectedPeriod || row.period === selectedPeriod;
        return matchesLang && matchesCat && matchesPeriod;
    });

    if (!searchTerm) {
        lastFilteredRows = baseFiltered;
        currentLimit = MAX_RESULTS;
        displayData(baseFiltered);
        return;
    }

    // split into exact, prefix and substring matches (priority)
    const field = (searchField && searchField.value) || '';
    const exactMatches = [];
    const prefixMatches = [];
    const substringMatches = [];

    // detect quoted (strict) searches and wildcard usage; coreTerm is term without surrounding quotes
    const rawTerm = searchInput.value;
    const isQuoted = rawTerm.length >= 2 && rawTerm[0] === '"' && rawTerm[rawTerm.length-1] === '"';
    const coreTerm = isQuoted ? rawTerm.slice(1, -1) : rawTerm;
    const hasWildcard = coreTerm.indexOf('*') !== -1 || coreTerm.indexOf('.') !== -1;
    currentSearchRaw = rawTerm;
    currentHasWildcard = hasWildcard;
    highlightRegex = null;
    // regex and prefixRegex used only for matching logic below
    let regex = null;
    let prefixRegex = null;
    let fullRegex = null;
    if (hasWildcard) {
        // escape regex special chars except '*' and '.'
        const escaped = coreTerm.replace(/[\\\^$+?{}()|[\]\]]/g, '\\$&');
        const converted = escaped.replace(/\*/g, '.*');
        regex = new RegExp(converted, 'i');
        if (!coreTerm.startsWith('*')) prefixRegex = new RegExp('^' + converted, 'i');
        fullRegex = new RegExp('^' + converted + '$', 'i');
        // highlighting: global, case-insensitive
        try { highlightRegex = new RegExp(converted, 'gi'); } catch (e) { highlightRegex = null; }
    } else {
        // no wildcard: simple literal match, case-insensitive
        const esc = escapeRegExp(coreTerm);
        regex = new RegExp(esc, 'i');
        prefixRegex = new RegExp('^' + esc, 'i');
        fullRegex = new RegExp('^' + esc + '$', 'i');
        highlightRegex = new RegExp(esc, 'gi');
    }

    for (const row of baseFiltered) {
        const chars = (row.characters || '');
        const trans = (row.transcription || '');
        let matchedExact = false;
        let matchedPrefix = false;
        let matchedSub = false;

        if (isQuoted) {
            // strict (quoted) search: only full matches count (still allow wildcards via fullRegex)
            if (field === 'characters') {
                if (fullRegex && fullRegex.test(chars)) matchedExact = true;
            } else if (field === 'transcription') {
                if (fullRegex && fullRegex.test(trans)) matchedExact = true;
            } else {
                if (fullRegex && (fullRegex.test(chars) || fullRegex.test(trans))) matchedExact = true;
            }
        } else if (hasWildcard) {
            // use regex tests with wildcard support
            if (field === 'characters') {
                if (fullRegex && fullRegex.test(chars)) matchedExact = true;
                else if (prefixRegex && prefixRegex.test(chars)) matchedPrefix = true;
                else if (regex.test(chars)) matchedSub = true;
            } else if (field === 'transcription') {
                if (fullRegex && fullRegex.test(trans)) matchedExact = true;
                else if (prefixRegex && prefixRegex.test(trans)) matchedPrefix = true;
                else if (regex.test(trans)) matchedSub = true;
            } else {
                if (fullRegex && (fullRegex.test(chars) || fullRegex.test(trans))) matchedExact = true;
                else if (prefixRegex && (prefixRegex.test(chars) || prefixRegex.test(trans))) matchedPrefix = true;
                else if (regex.test(chars) || regex.test(trans)) matchedSub = true;
            }
        } else {
            // no wildcards, non-quoted: use exact / startsWith / includes (case-insensitive)
            const lchars = chars.toLowerCase();
            const ltrans = trans.toLowerCase();
            if (field === 'characters') {
                if (lchars === coreTerm.toLowerCase()) matchedExact = true;
                else if (lchars.startsWith(searchTerm)) matchedPrefix = true;
                else if (lchars.includes(searchTerm)) matchedSub = true;
            } else if (field === 'transcription') {
                if (ltrans === coreTerm.toLowerCase()) matchedExact = true;
                else if (ltrans.startsWith(searchTerm)) matchedPrefix = true;
                else if (ltrans.includes(searchTerm)) matchedSub = true;
            } else {
                if (lchars === coreTerm.toLowerCase() || ltrans === coreTerm.toLowerCase()) matchedExact = true;
                else if (lchars.startsWith(searchTerm) || ltrans.startsWith(searchTerm)) matchedPrefix = true;
                else if (lchars.includes(searchTerm) || ltrans.includes(searchTerm)) matchedSub = true;
            }
        }

        if (matchedExact) exactMatches.push(row);
        else if (matchedPrefix) prefixMatches.push(row);
        else if (matchedSub) substringMatches.push(row);
    }

    const filtered = exactMatches.concat(prefixMatches, substringMatches);
    lastFilteredRows = filtered;
    currentLimit = MAX_RESULTS;
    displayData(filtered);
}

loadData();

// --- Cappelli CAPTCHA implementation (fun little joke) ---
const captchaModal = document.getElementById('cappelliCaptcha');
const captchaGrid = document.getElementById('captchaGrid');
const captchaPrompt = document.getElementById('captchaPrompt');
const captchaInstruction = document.getElementById('captchaInstruction');
const captchaFeedback = document.getElementById('captchaFeedback');
const verifyBtn = document.getElementById('verifyCaptcha');
const regenBtn = document.getElementById('regenCaptcha');

const captchaState = { challenge: null, shownRows: [], selected: new Set() };

function initCaptcha(){
    if (!captchaModal) return;
    // prepare buttons
    verifyBtn.addEventListener('click', verifyCaptcha);
    regenBtn.addEventListener('click', () => { buildCaptcha(); });
    // If there are any pinned items currently, clear them so the CAPTCHA's
    // pinned results will be the ones shown after success.
    if (pinnedIds && pinnedIds.length) {
        pinnedIds = [];
        savePins();
        displayData(lastFilteredRows);
    }
    // Build first challenge
    buildCaptcha();
    // Show modal on page open (funny CAPTCHA welcome)
    showCaptcha(true);
}

function showCaptcha(show){
    if (!captchaModal) return;
    captchaModal.style.display = show ? 'flex' : 'none';
    captchaModal.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function buildCaptcha(){
    // choose a random challenge type
    // choose a random challenge; ensure it yields at least one matching Latin row
    let ch = pickRandomChallenge();
    let dataset = data.filter(r => (r.language || '').toLowerCase() === 'latin');
    let matches = dataset.filter(ch.matcher);
    let nonMatches = dataset.filter(r => !ch.matcher(r));
    let attempts = 0;
    // keep trying different challenges until we find at least two matches
    while ((matches.length < 2) && attempts < 10) {
        ch = pickRandomChallenge();
        dataset = data.filter(r => (r.language || '').toLowerCase() === 'latin');
        matches = dataset.filter(ch.matcher);
        nonMatches = dataset.filter(r => !ch.matcher(r));
        attempts++;
    }
    captchaState.challenge = ch;
    // Keep the static prompt text in the HTML and show the dynamic selection instruction
    // in the separate `captchaInstruction` element below it.
    if (captchaInstruction) captchaInstruction.textContent = ch.prompt || '';
    captchaFeedback.textContent = '';
    // ensure we have enough images; fall back gracefully
    const need = 9;
    const chosen = [];
    // choose up to 5 matches (min 2 if available)
    const matchCount = Math.min(Math.max(2, Math.floor(Math.random()*3)+2), matches.length);
    shuffleArray(matches);
    shuffleArray(nonMatches);
    for (let i=0;i<matchCount && chosen.length<need;i++) chosen.push(matches[i]);
    for (let i=0; chosen.length<need && i<nonMatches.length;i++) chosen.push(nonMatches[i]);
    // if still not enough (very small dataset), duplicate random rows
    while (chosen.length < need && data.length>0) chosen.push(data[Math.floor(Math.random()*data.length)]);
    // shuffle final
    shuffleArray(chosen);
    // store shown rows and reset selection
    captchaState.shownRows = chosen;
    captchaState.selected = new Set();
    renderCaptchaGrid();
}

function renderCaptchaGrid(){
    captchaGrid.innerHTML = '';
    captchaState.shownRows.forEach((row, idx) => {
        const card = document.createElement('div');
        card.className = 'captcha-card';
        card.setAttribute('data-idx', idx);
        const img = document.createElement('img');
        img.src = `source/img_abbr/${row.id}.jpg`;
        img.alt = row.characters || row.transcription || `abbr ${row.id}`;
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.textContent = 'Selected';
        card.appendChild(img);
        card.appendChild(overlay);
        card.addEventListener('click', () => toggleCaptchaSelection(idx, card));
        captchaGrid.appendChild(card);
    });
}

function toggleCaptchaSelection(idx, card){
    if (captchaState.selected.has(idx)) {
        captchaState.selected.delete(idx);
        card.classList.remove('selected');
    } else {
        captchaState.selected.add(idx);
        card.classList.add('selected');
    }
}

function verifyCaptcha(){
    const correctIdx = new Set();
    captchaState.shownRows.forEach((r,i) => { if (captchaState.challenge.matcher(r)) correctIdx.add(i); });
    const selected = captchaState.selected;
    // check that selected equals correctIdx
    let ok = true;
    // any selected that are not correct -> fail
    for (const s of selected) if (!correctIdx.has(s)) ok = false;
    // any correct not selected -> fail
    for (const c of correctIdx) if (!selected.has(c)) ok = false;

    if (ok) {
        captchaFeedback.className = 'captcha-feedback success';
        captchaFeedback.textContent = "Nice! You're a Cappelli connoisseur — CAPTCHA passed.";
        // Pin all abbreviations that were shown in this CAPTCHA so the user
        // can inspect their meanings in the main table.
        try {
            captchaState.shownRows.forEach(r => {
                const id = String(r.id);
                if (!pinnedIds.includes(id)) pinnedIds.push(id);
            });
            savePins();
            // re-render table so pinned items appear at the top
            displayData(lastFilteredRows);
        } catch (e) {
            // non-fatal — continue to hide modal
            console.error('Error pinning captcha rows:', e);
        }
        // hide modal after brief pause
        setTimeout(() => showCaptcha(false), 1100);
    } else {
        captchaFeedback.className = 'captcha-feedback fail';
        // give a helpful hint: show count of correct
        captchaFeedback.textContent = `Not quite — there are ${correctIdx.size} correct image(s). Try again or skip.`;
    }
}

function pickRandomChallenge(){
    // Simplified challenge: choose a token from the `transcription` field
    // and only use Latin abbreviations. Prefer tokens that occur at least
    // twice to ensure the CAPTCHA has multiple correct items.
    const latinRows = data.filter(r => (r.language || '').toLowerCase() === 'latin' && (r.transcription || '').trim());
    // build token frequency map across Latin transcriptions
    const tokenCounts = new Map();
    for (const r of latinRows) {
        const parts = String(r.transcription || '').split(/[^A-Za-zÀ-ž0-9]+/).filter(p => p.length > 2);
        for (const p of parts) {
            const key = p.toLowerCase();
            tokenCounts.set(key, (tokenCounts.get(key) || 0) + 1);
        }
    }
    // choose tokens that appear at least twice
    const frequentTokens = Array.from(tokenCounts.entries()).filter(([t,c]) => c >= 2).map(([t]) => t);
    if (frequentTokens.length > 0) {
        const token = frequentTokens[Math.floor(Math.random() * frequentTokens.length)];
        const displayToken = token;
        const lower = displayToken.toLowerCase();
        return {
            type: 'transcription-contains',
            prompt: `Select all Latin abbreviations whose transcription contains letters "${displayToken}"`,
            matcher: (r) => (r.transcription||'').toLowerCase().includes(lower) && (r.language||'').toLowerCase() === 'latin'
        };
    }

    // Fallback: pick a random Latin row and extract a token (may be single occurrence)
    if (latinRows.length === 0) {
        const anyToken = (data[0] && (data[0].transcription || 'quod')) || 'quod';
        const lowerAny = anyToken.toLowerCase();
        return {
            type: 'transcription-contains',
            prompt: `Select all Latin abbreviations whose transcription contains letters "${anyToken}"`,
            matcher: (r) => (r.transcription||'').toLowerCase().includes(lowerAny) && (r.language||'').toLowerCase() === 'latin'
        };
    }

    shuffleArray(latinRows);
    const row = latinRows[Math.floor(Math.random()*latinRows.length)];
    const parts = String(row.transcription || '').split(/[^A-Za-zÀ-ž0-9]+/).filter(p => p.length > 2);
    let token = parts.length ? parts[Math.floor(Math.random()*parts.length)] : String(row.transcription || '').trim();
    if (!token) token = 'quod';
    const displayToken = token.replace(/\[|\]/g, '').trim();
    const lower = displayToken.toLowerCase();
        return {
            type: 'transcription-contains',
            prompt: `Select all Latin abbreviations whose transcription contains letters "${displayToken}"`,
            matcher: (r) => (r.transcription||'').toLowerCase().includes(lower) && (r.language||'').toLowerCase() === 'latin'
        };
}

function shuffleArray(arr){
    for (let i=arr.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        const t = arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
    return arr;
}


