/* =====================================================================
   BAHETI - Aluminium Material Sorting Tracker
   Front-end logic. Data is stored in Supabase (see supabase/schema.sql).
   ===================================================================== */

// ---------------------------------------------------------------------
// 1. Configuration & global state
// ---------------------------------------------------------------------
const CFG = window.BAHETI_CONFIG || {};
const IS_CONFIGURED =
    !!CFG.SUPABASE_URL && !!CFG.SUPABASE_ANON_KEY &&
    !CFG.SUPABASE_URL.includes('YOUR-PROJECT-ID') &&
    !CFG.SUPABASE_ANON_KEY.startsWith('YOUR-');

let sb = null;                 // Supabase client
let appUserId = null;          // id of the logged-in user (null = logged out)
let realtimeChannel = null;
let refreshTimer = null;
let currentActiveSelect = null;

// Dropdown master data (loaded from the master_options table)
const dropdownData = {
    materialType: [],
    vendorName: [],
    contractorName: [],
    issuedOn: []
};

const SELECT_PLACEHOLDERS = {
    materialType: 'Select Material',
    vendorName: 'Select Vendor',
    contractorName: 'Select Contractor',
    issuedOn: 'Select Location'
};

// All sorting records (camelCase view of the sorting_logs table)
let sortingLogs = [];

const now = new Date();
const currentYear = now.getFullYear();
const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');

// ---------------------------------------------------------------------
// 2. Small helpers
// ---------------------------------------------------------------------
// Escape text before putting it into innerHTML (prevents broken layout / XSS)
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ISO timestamp from the database -> "YYYY-MM-DDTHH:mm" in the user's local time
function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromRow(r) {
    return {
        id: r.id,
        heatNo: r.heat_no,
        dateTime: toLocalInput(r.entry_datetime),
        materialType: r.material_type,
        vendorName: r.vendor_name,
        contractorName: r.contractor_name,
        workers: Number(r.workers),
        workHours: Number(r.work_hours),
        sortedQty: Number(r.sorted_qty),
        issuedOn: r.issued_on
    };
}

function toast(message, type = 'info') {
    const colors = {
        success: 'bg-emerald-600',
        error: 'bg-rose-600',
        info: 'bg-slate-800'
    };
    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        info: 'fa-circle-info'
    };
    const el = document.createElement('div');
    el.className = `toast-enter ${colors[type] || colors.info} text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 max-w-sm`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}

function setSync(state) {
    const el = document.getElementById('syncStatus');
    const map = {
        loading: ['text-amber-500', 'Syncing'],
        online:  ['text-emerald-500', 'Live'],
        error:   ['text-rose-500', 'Offline']
    };
    const [color, label] = map[state] || map.loading;
    el.innerHTML = `<i class="fa-solid fa-circle text-[7px] ${color}"></i> ${label}`;
}

function friendlyError(error) {
    if (!error) return 'Something went wrong.';
    if (error.code === '42P01') return 'Database tables not found. Run supabase/schema.sql first.';
    if (error.code === '42501') return 'Permission denied. Make sure you are signed in.';
    return error.message || 'Something went wrong.';
}

// ---------------------------------------------------------------------
// 3. Start-up and authentication
// ---------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', init);

async function init() {
    document.getElementById('footerYear').textContent = new Date().getFullYear();
    setCurrentDateTime();
    startLiveClock();
    document.getElementById('monthlyFilterPicker').value = `${currentYear}-${currentMonthStr}`;

    // Modal keyboard shortcuts
    document.getElementById('customOptionInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveCustomOption(); }
        if (e.key === 'Escape') closeModal();
    });

    if (!IS_CONFIGURED) {
        document.getElementById('setupScreen').classList.remove('hidden');
        return;
    }
    if (typeof supabase === 'undefined') {
        toast('Could not load the Supabase library. Check your internet connection.', 'error');
        setSync('error');
        return;
    }

    sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // Do not await Supabase calls directly inside this callback (can deadlock) - hence setTimeout
    sb.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => handleSession(session), 0);
    });

    const { data } = await sb.auth.getSession();
    handleSession(data.session);
}

async function handleSession(session) {
    if (session && session.user) {
        if (appUserId === session.user.id) return; // already running (e.g. token refresh)
        appUserId = session.user.id;
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('userEmailLabel').textContent = session.user.email || 'Sign out';
        await startApp();
    } else {
        appUserId = null;
        stopApp();
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('loginPassword').value = '';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errBox = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Signing in...';

    const { error } = await sb.auth.signInWithPassword({ email, password });

    btn.disabled = false;
    btn.querySelector('span').textContent = 'Sign In';

    if (error) {
        errBox.textContent = error.message.toLowerCase().includes('invalid login')
            ? 'Incorrect email or password.'
            : error.message;
        errBox.classList.remove('hidden');
    }
}

async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
}

async function startApp() {
    setSync('loading');
    document.getElementById('loadingState').classList.remove('hidden');
    try {
        await refreshData();
        subscribeRealtime();
    } catch (err) {
        console.error(err);
        setSync('error');
        toast(friendlyError(err), 'error');
    } finally {
        document.getElementById('loadingState').classList.add('hidden');
    }
}

function stopApp() {
    if (realtimeChannel && sb) {
        sb.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    sortingLogs = [];
    Object.keys(dropdownData).forEach(k => dropdownData[k] = []);
    renderAll();
}

// ---------------------------------------------------------------------
// 4. Loading data from Supabase
// ---------------------------------------------------------------------
async function refreshData() {
    const [options, logs] = await Promise.all([fetchOptions(), fetchAllLogs()]);

    dropdownData.materialType = options.materialType;
    dropdownData.vendorName = options.vendorName;
    dropdownData.contractorName = options.contractorName;
    dropdownData.issuedOn = options.issuedOn;
    sortingLogs = logs.map(fromRow);

    renderAll();
    setSync('online');
}

async function fetchOptions() {
    const { data, error } = await sb
        .from('master_options')
        .select('category, value')
        .order('sort_order', { ascending: true })
        .order('value', { ascending: true });
    if (error) throw error;

    const result = { materialType: [], vendorName: [], contractorName: [], issuedOn: [] };
    data.forEach(row => { if (result[row.category]) result[row.category].push(row.value); });
    return result;
}

// Supabase returns max 1000 rows per request, so we page through them
async function fetchAllLogs() {
    const pageSize = 1000;
    let from = 0;
    let all = [];
    while (true) {
        const { data, error } = await sb
            .from('sorting_logs')
            .select('*')
            .order('entry_datetime', { ascending: false })
            .order('id', { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

function subscribeRealtime() {
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb
        .channel('baheti-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sorting_logs' }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'master_options' }, scheduleRefresh)
        .subscribe();
}

// Several changes can arrive at once - wait a moment, then reload once
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
        if (!appUserId) return;
        try { await refreshData(); } catch (err) { console.error(err); setSync('error'); }
    }, 400);
}

window.addEventListener('online', () => { if (appUserId) scheduleRefresh(); });
window.addEventListener('offline', () => setSync('error'));

// ---------------------------------------------------------------------
// 5. Rendering everything
// ---------------------------------------------------------------------
function renderAll() {
    populateAllDropdowns();
    renderTable();
    updateGlobalKPIs();
    renderMonthlyAnalytics();
}

function startLiveClock() {
    const tick = () => {
        const clockNow = new Date();
        document.getElementById('liveClock').innerHTML =
            `<i class="fa-regular fa-clock mr-1.5 text-sky-600"></i>${clockNow.toLocaleDateString()} ${clockNow.toLocaleTimeString()}`;
    };
    tick();
    setInterval(tick, 1000);
}

function setCurrentDateTime() {
    const dtNow = new Date();
    dtNow.setMinutes(dtNow.getMinutes() - dtNow.getTimezoneOffset());
    document.getElementById('entryDateTime').value = dtNow.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------
// 6. Dropdowns
// ---------------------------------------------------------------------
function populateAllDropdowns() {
    populateSelect('materialType', dropdownData.materialType);
    populateSelect('vendorName', dropdownData.vendorName);
    populateSelect('contractorName', dropdownData.contractorName);
    populateSelect('issuedOn', dropdownData.issuedOn);

    populateFilterOptions('filterMaterial', dropdownData.materialType);
    populateFilterOptions('filterContractor', dropdownData.contractorName);
}

function populateSelect(elementId, items) {
    const select = document.getElementById(elementId);
    const currentSelected = select.value;
    select.innerHTML = `<option value="" disabled selected>${esc(SELECT_PLACEHOLDERS[elementId] || 'Select Option')}</option>`;

    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
    });

    const addNewOpt = document.createElement('option');
    addNewOpt.value = '__ADD_NEW__';
    addNewOpt.textContent = '+ Add New...';
    addNewOpt.className = 'font-semibold text-sky-600 bg-sky-50';
    select.appendChild(addNewOpt);

    if (currentSelected && items.includes(currentSelected)) {
        select.value = currentSelected;
    }
}

function populateFilterOptions(elementId, items) {
    const select = document.getElementById(elementId);
    const currentSelected = select.value;
    const firstOptionText = select.options[0].text;
    select.innerHTML = `<option value="">${esc(firstOptionText)}</option>`;
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
    });
    if (currentSelected && items.includes(currentSelected)) select.value = currentSelected;
}

function checkCustomOption(selectElement, title) {
    if (selectElement.value === '__ADD_NEW__') {
        currentActiveSelect = selectElement;
        document.getElementById('modalTitle').textContent = `Add New ${title}`;
        document.getElementById('modalLabel').textContent = `Enter Custom ${title} Name`;
        document.getElementById('customOptionInput').value = '';
        document.getElementById('customOptionModal').classList.remove('hidden');
        document.getElementById('customOptionInput').focus();
    }
}

function closeModal() {
    if (currentActiveSelect) {
        currentActiveSelect.value = '';
    }
    document.getElementById('customOptionModal').classList.add('hidden');
    currentActiveSelect = null;
}

async function saveCustomOption() {
    const inputVal = document.getElementById('customOptionInput').value.trim();
    if (!inputVal) {
        toast('Please enter a valid value.', 'error');
        return;
    }
    if (!currentActiveSelect) return;

    const key = currentActiveSelect.id;
    const list = dropdownData[key];
    const btn = document.getElementById('saveOptionBtn');

    // Already exists (ignoring upper/lower case)? Just select it.
    const existing = list.find(v => v.toLowerCase() === inputVal.toLowerCase());
    let finalValue = existing || inputVal;

    if (!existing) {
        btn.disabled = true;
        const { error } = await sb.from('master_options').insert({
            category: key,
            value: inputVal,
            sort_order: list.length + 1
        });
        btn.disabled = false;

        if (error && error.code !== '23505') {   // 23505 = already exists, fine
            toast(friendlyError(error), 'error');
            return;
        }
        if (!list.includes(inputVal)) list.push(inputVal);
        populateAllDropdowns();
        toast(`"${inputVal}" added.`, 'success');
    }

    currentActiveSelect.value = finalValue;
    document.getElementById('customOptionModal').classList.add('hidden');
    currentActiveSelect = null;
}

// ---------------------------------------------------------------------
// 7. The entry form
// ---------------------------------------------------------------------
function calculateLiveProductivity() {
    const workHours = parseFloat(document.getElementById('workHours').value) || 0;
    const sortedQty = parseFloat(document.getElementById('sortedQty').value) || 0;
    const productivity = workHours > 0 ? sortedQty / workHours : 0;
    document.getElementById('liveProductivity').innerHTML =
        `${productivity.toFixed(2)} <span class="text-[10px] font-normal text-slate-500">Kg/Hr</span>`;
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const heatNo = document.getElementById('heatNo').value.trim();
    const dateTime = document.getElementById('entryDateTime').value;
    const materialType = document.getElementById('materialType').value;
    const vendorName = document.getElementById('vendorName').value;
    const contractorName = document.getElementById('contractorName').value;
    const workers = parseInt(document.getElementById('workers').value, 10);
    const workHours = parseFloat(document.getElementById('workHours').value);
    const sortedQty = parseFloat(document.getElementById('sortedQty').value);
    const issuedOn = document.getElementById('issuedOn').value;

    if (!materialType || !vendorName || !contractorName || !issuedOn ||
        [materialType, vendorName, contractorName, issuedOn].includes('__ADD_NEW__')) {
        toast('Please select options for all dropdown fields.', 'error');
        return;
    }
    if (!dateTime || isNaN(new Date(dateTime).getTime())) {
        toast('Please enter a valid date and time.', 'error');
        return;
    }

    const btn = document.getElementById('saveBtn');
    const btnLabel = btn.querySelector('span');
    btn.disabled = true;
    btnLabel.textContent = 'Saving...';

    const { error } = await sb.from('sorting_logs').insert({
        heat_no: heatNo,
        entry_datetime: new Date(dateTime).toISOString(),
        material_type: materialType,
        vendor_name: vendorName,
        contractor_name: contractorName,
        workers,
        work_hours: workHours,
        sorted_qty: sortedQty,
        issued_on: issuedOn
    });

    btn.disabled = false;
    btnLabel.textContent = 'Save Sorting Entry';

    if (error) {
        console.error(error);
        toast(friendlyError(error), 'error');
        return;
    }

    toast('Entry saved.', 'success');
    resetForm();
    try { await refreshData(); } catch (err) { console.error(err); }
}

function resetForm() {
    document.getElementById('sortingForm').reset();
    setCurrentDateTime();
    calculateLiveProductivity();
}

async function deleteEntry(id) {
    if (!confirm('Delete this entry permanently?')) return;

    const { error } = await sb.from('sorting_logs').delete().eq('id', id);
    if (error) {
        toast(friendlyError(error), 'error');
        return;
    }
    sortingLogs = sortingLogs.filter(log => log.id !== id);
    renderAll();
    toast('Entry deleted.', 'success');
}

// ---------------------------------------------------------------------
// 8. Records table & KPIs
// ---------------------------------------------------------------------
function renderTable() {
    const tbody = document.getElementById('dataTableBody');
    const searchVal = document.getElementById('searchInput').value.toLowerCase();
    const filterMat = document.getElementById('filterMaterial').value;
    const filterCon = document.getElementById('filterContractor').value;

    tbody.innerHTML = '';

    const filteredLogs = sortingLogs.filter(log => {
        const matchesSearch =
            (log.heatNo && log.heatNo.toLowerCase().includes(searchVal)) ||
            log.materialType.toLowerCase().includes(searchVal) ||
            log.vendorName.toLowerCase().includes(searchVal) ||
            log.contractorName.toLowerCase().includes(searchVal) ||
            log.issuedOn.toLowerCase().includes(searchVal);

        const matchesMaterial = filterMat === '' || log.materialType === filterMat;
        const matchesContractor = filterCon === '' || log.contractorName === filterCon;

        return matchesSearch && matchesMaterial && matchesContractor;
    });

    document.getElementById('emptyState').classList.toggle('hidden', filteredLogs.length !== 0);

    filteredLogs.forEach(log => {
        const productivity = log.workHours > 0 ? (log.sortedQty / log.workHours).toFixed(2) : '0.00';
        const formattedDate = new Date(log.dateTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';
        tr.innerHTML = `
            <td class="py-2.5 px-3 font-mono font-bold text-sky-700">${esc(log.heatNo || 'N/A')}</td>
            <td class="py-2.5 px-3 font-mono text-slate-500">${esc(formattedDate)}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(log.materialType)}</td>
            <td class="py-2.5 px-3">${esc(log.vendorName)}</td>
            <td class="py-2.5 px-3">${esc(log.contractorName)}</td>
            <td class="py-2.5 px-3 text-center">${log.workers}</td>
            <td class="py-2.5 px-3 text-center">${log.workHours}</td>
            <td class="py-2.5 px-3 text-right font-medium text-slate-900">${log.sortedQty.toLocaleString()}</td>
            <td class="py-2.5 px-3">
                <span class="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                    ${esc(log.issuedOn)}
                </span>
            </td>
            <td class="py-2.5 px-3 text-right font-bold text-sky-700">${productivity} <span class="text-[10px] text-slate-400 font-normal">Kg/Hr</span></td>
            <td class="py-2.5 px-3 text-center">
                <button onclick="deleteEntry('${esc(log.id)}')" class="text-rose-500 hover:text-rose-700 p-1 rounded transition" title="Delete entry" aria-label="Delete entry">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function applyFilters() {
    renderTable();
}

function updateGlobalKPIs() {
    const totalEntries = sortingLogs.length;
    const totalWeight = sortingLogs.reduce((acc, log) => acc + log.sortedQty, 0);
    const totalWorkHours = sortingLogs.reduce((acc, log) => acc + log.workHours, 0);
    const avgProductivity = totalWorkHours > 0 ? (totalWeight / totalWorkHours) : 0;
    const uniqueHeats = new Set(sortingLogs.map(l => l.heatNo).filter(Boolean)).size;

    document.getElementById('kpiTotalWeight').innerHTML = `${totalWeight.toLocaleString()} <span class="text-xs font-normal text-slate-500">Kg</span>`;
    document.getElementById('kpiTotalHeats').textContent = uniqueHeats;
    document.getElementById('kpiTotalEntries').textContent = totalEntries;
    document.getElementById('kpiAvgProductivity').innerHTML = `${avgProductivity.toFixed(2)} <span class="text-xs font-normal text-slate-500">Kg/Hr</span>`;
}

// ---------------------------------------------------------------------
// 9. Monthly analytics drawer
// ---------------------------------------------------------------------
function toggleAnalyticsDrawer() {
    const drawer = document.getElementById('analyticsDrawer');
    const overlay = document.getElementById('analyticsOverlay');

    if (drawer.classList.contains('translate-x-full')) {
        drawer.classList.remove('translate-x-full');
        overlay.classList.remove('hidden');
        renderMonthlyAnalytics();
    } else {
        drawer.classList.add('translate-x-full');
        overlay.classList.add('hidden');
    }
}

function switchAnalyticsSubTab(tab) {
    const inactive = 'px-5 py-3 text-xs font-bold text-slate-600 hover:text-slate-900 border-b-2 border-transparent whitespace-nowrap';
    const active = 'px-5 py-3 text-xs font-bold border-b-2 border-sky-600 text-sky-700 bg-white whitespace-nowrap';

    ['subTabDaily', 'subTabContractor', 'subTabMatrix'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['tabBtn1', 'tabBtn2', 'tabBtn3'].forEach(id => document.getElementById(id).className = inactive);

    if (tab === 'daily') {
        document.getElementById('subTabDaily').classList.remove('hidden');
        document.getElementById('tabBtn1').className = active;
    } else if (tab === 'contractor') {
        document.getElementById('subTabContractor').classList.remove('hidden');
        document.getElementById('tabBtn2').className = active;
    } else if (tab === 'matrix') {
        document.getElementById('subTabMatrix').classList.remove('hidden');
        document.getElementById('tabBtn3').className = active;
    }
}

function renderMonthlyAnalytics() {
    const selectedMonthVal = document.getElementById('monthlyFilterPicker').value; // e.g. "2026-03"
    if (!selectedMonthVal) return;

    const [yearStr, monthStr] = selectedMonthVal.split('-');
    const selYear = parseInt(yearStr, 10);
    const selMonth = parseInt(monthStr, 10);

    const monthLogs = sortingLogs.filter(log => {
        const logDate = new Date(log.dateTime);
        return logDate.getFullYear() === selYear && (logDate.getMonth() + 1) === selMonth;
    });

    const monthTotalQty = monthLogs.reduce((a, b) => a + b.sortedQty, 0);
    const monthTotalWorkers = monthLogs.reduce((a, b) => a + b.workers, 0);
    const monthTotalHours = monthLogs.reduce((a, b) => a + b.workHours, 0);
    const monthAvgProd = monthTotalHours > 0 ? (monthTotalQty / monthTotalHours) : 0;

    document.getElementById('monthTotalQty').textContent = `${monthTotalQty.toLocaleString()} Kg`;
    document.getElementById('monthTotalQtyMT').textContent = `${(monthTotalQty / 1000).toFixed(2)} MT`;
    document.getElementById('monthTotalWorkers').textContent = `${monthTotalWorkers} Workers`;
    document.getElementById('monthTotalHours').textContent = `${monthTotalHours.toFixed(1)} Hours`;
    document.getElementById('monthAvgProductivity').textContent = `${monthAvgProd.toFixed(2)} Kg/Hr`;

    renderDailyBreakdownTable(selYear, selMonth, monthLogs);
    renderContractorSummaryTable(monthLogs);
    renderContractorMatrix(selYear, selMonth, monthLogs);
}

function renderDailyBreakdownTable(year, month, monthLogs) {
    const tbody = document.getElementById('dailyBreakdownBody');
    tbody.innerHTML = '';

    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
        const dayLogs = monthLogs.filter(log => new Date(log.dateTime).getDate() === day);

        const dayQty = dayLogs.reduce((a, b) => a + b.sortedQty, 0);
        const dayWorkers = dayLogs.reduce((a, b) => a + b.workers, 0);
        const dayHours = dayLogs.reduce((a, b) => a + b.workHours, 0);
        const dayProd = dayHours > 0 ? (dayQty / dayHours).toFixed(2) : '0.00';

        const dateObj = new Date(year, month - 1, day);
        const dateLabel = dateObj.toLocaleDateString([], { day: '2-digit', month: 'short' });

        const tr = document.createElement('tr');
        tr.className = dayQty > 0 ? 'hover:bg-slate-50 font-medium' : 'text-slate-300';
        tr.innerHTML = `
            <td class="py-2 px-3 font-mono">${esc(dateLabel)}</td>
            <td class="py-2 px-3 text-right font-semibold ${dayQty > 0 ? 'text-slate-800' : ''}">${dayQty.toLocaleString()}</td>
            <td class="py-2 px-3 text-center">${dayWorkers}</td>
            <td class="py-2 px-3 text-center">${dayHours.toFixed(1)}</td>
            <td class="py-2 px-3 text-right font-bold ${dayQty > 0 ? 'text-sky-700' : ''}">${dayProd}</td>
        `;
        tbody.appendChild(tr);
    }
}

function renderContractorSummaryTable(monthLogs) {
    const tbody = document.getElementById('contractorSummaryBody');
    tbody.innerHTML = '';

    const contractorMap = {};

    monthLogs.forEach(log => {
        if (!contractorMap[log.contractorName]) {
            contractorMap[log.contractorName] = {
                contractor: log.contractorName,
                datesWorked: new Set(),
                sortedQty: 0,
                workers: 0,
                workHours: 0,
                materials: {}
            };
        }

        const c = contractorMap[log.contractorName];
        c.datesWorked.add(new Date(log.dateTime).toDateString());
        c.sortedQty += log.sortedQty;
        c.workers += log.workers;
        c.workHours += log.workHours;
        c.materials[log.materialType] = (c.materials[log.materialType] || 0) + log.sortedQty;
    });

    const contractorList = Object.values(contractorMap);

    if (contractorList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">No contractor data recorded for this month.</td></tr>`;
        return;
    }

    contractorList.forEach(c => {
        const prod = c.workHours > 0 ? (c.sortedQty / c.workHours).toFixed(2) : '0.00';

        let topMat = '-';
        let maxQty = 0;
        Object.entries(c.materials).forEach(([mat, qty]) => {
            if (qty > maxQty) { maxQty = qty; topMat = mat; }
        });

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50';
        tr.innerHTML = `
            <td class="py-2.5 px-3 font-bold text-slate-800">${esc(c.contractor)}</td>
            <td class="py-2.5 px-3 text-center font-semibold text-slate-600">${c.datesWorked.size} Days</td>
            <td class="py-2.5 px-3 text-right font-bold text-slate-900">${c.sortedQty.toLocaleString()}</td>
            <td class="py-2.5 px-3 text-center">${c.workers}</td>
            <td class="py-2.5 px-3 text-center">${c.workHours.toFixed(1)}</td>
            <td class="py-2.5 px-3 text-right font-bold text-sky-600">${prod}</td>
            <td class="py-2.5 px-3 font-medium text-slate-600">${esc(topMat)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderContractorMatrix(year, month, monthLogs) {
    const headerRow = document.getElementById('matrixHeaderRow');
    const tbody = document.getElementById('matrixBody');

    headerRow.innerHTML = `<th class="py-2 px-2 sticky left-0 bg-slate-100 border-r text-slate-700 min-w-[120px]">Contractor</th>`;
    tbody.innerHTML = '';

    const daysInMonth = new Date(year, month, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
        const th = document.createElement('th');
        th.className = 'py-1.5 px-1.5 text-center border-b font-mono text-[10px] min-w-[36px]';
        th.textContent = d;
        headerRow.appendChild(th);
    }

    // Master list of contractors + anyone who appears in this month's records
    const contractors = Array.from(new Set([...dropdownData.contractorName, ...monthLogs.map(l => l.contractorName)]));

    contractors.forEach(con => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50';

        let rowHtml = `<td class="py-2 px-2 font-semibold sticky left-0 bg-white border-r text-slate-800">${esc(con)}</td>`;

        for (let d = 1; d <= daysInMonth; d++) {
            const dayLogs = monthLogs.filter(l => l.contractorName === con && new Date(l.dateTime).getDate() === d);

            const dayQty = dayLogs.reduce((a, b) => a + b.sortedQty, 0);
            const dayHours = dayLogs.reduce((a, b) => a + b.workHours, 0);
            const prod = dayHours > 0 ? Math.round(dayQty / dayHours) : 0;

            if (prod > 0) {
                rowHtml += `<td class="py-2 px-1 text-center font-mono font-bold bg-sky-50 text-sky-700 border text-[10px]" title="Qty: ${dayQty}kg, Hrs: ${dayHours}">${prod}</td>`;
            } else {
                rowHtml += `<td class="py-2 px-1 text-center font-mono text-slate-200 border text-[10px]">-</td>`;
            }
        }

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });
}

// ---------------------------------------------------------------------
// 10. CSV export
// ---------------------------------------------------------------------
function csvText(v) {
    let s = String(v ?? '');
    // Stop spreadsheet apps treating text as a formula
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
}

function exportToCSV() {
    if (sortingLogs.length === 0) {
        toast('No data available to export.', 'error');
        return;
    }

    const headers = ['Heat No.', 'Date & Time', 'Material Type', 'Vendor Name', 'Contractor Name', 'Workers', 'Total Work Hours', 'Sorted Qty (Kg)', 'Issued On', 'Productivity (Kg/Hr)'];
    const rows = sortingLogs.map(log => [
        csvText(log.heatNo),
        csvText(log.dateTime.replace('T', ' ')),
        csvText(log.materialType),
        csvText(log.vendorName),
        csvText(log.contractorName),
        log.workers,
        log.workHours,
        log.sortedQty,
        csvText(log.issuedOn),
        log.workHours > 0 ? (log.sortedQty / log.workHours).toFixed(2) : 0
    ]);

    // "\ufeff" (BOM) makes Excel open the file with correct characters
    const csv = '\ufeff' + [headers.map(csvText).join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `baheti_material_sorting_log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
