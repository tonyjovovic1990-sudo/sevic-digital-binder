const SUPABASE_URL = "https://zkdufkfameiknsveumzo.supabase.co";
const SUPABASE_KEY = "sb_publishable_Jd1JmMRLbpsruJAm1Y2dUw_VpWOswUS";
const BUCKET = "truck-documents";
const ADMIN_PIN = "0250";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let isAdminLoggedIn = localStorage.getItem("ddb_admin") === "yes";
let allUnits = [];
let currentDocs = [];

function initAccessMode() {
  const params = new URLSearchParams(window.location.search);
  const adminMode = params.get("admin") === "1";
  document.getElementById('adminBtn').classList.toggle('hidden', !adminMode || isAdminLoggedIn);
  document.getElementById('adminDashBtn').classList.toggle('hidden', !isAdminLoggedIn);
  document.getElementById('logoutBtn').classList.toggle('hidden', !isAdminLoggedIn);
  if (isAdminLoggedIn && adminMode) showView('admin');
  else showView('driver');
}

function showAdminLogin() {
  document.getElementById('adminLogin').classList.remove('hidden');
  document.getElementById('admin').classList.add('hidden');
  document.getElementById('driver').classList.add('hidden');
}

function adminLogin() {
  const pin = document.getElementById('adminPin').value.trim();
  if (pin !== ADMIN_PIN) {
    document.getElementById('adminLoginMsg').textContent = 'Wrong admin PIN.';
    return;
  }
  localStorage.setItem("ddb_admin", "yes");
  isAdminLoggedIn = true;
  document.getElementById('adminLoginMsg').textContent = '';
  document.getElementById('adminBtn').classList.add('hidden');
  document.getElementById('adminDashBtn').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');
  showView('admin');
}

function adminLogout() {
  localStorage.removeItem("ddb_admin");
  isAdminLoggedIn = false;
  window.location.href = window.location.pathname;
}

function showView(view) {
  if (view === 'admin' && !isAdminLoggedIn) return showAdminLogin();
  document.getElementById('adminLogin').classList.add('hidden');
  document.getElementById('admin').classList.toggle('hidden', view !== 'admin');
  document.getElementById('driver').classList.toggle('hidden', view !== 'driver');
}

async function addUnit() {
  const unit_number = document.getElementById('unitNumber').value.trim();
  const pin = document.getElementById('unitPin').value.trim();
  if (!unit_number || !pin) return alert('Enter unit number and PIN');
  const { error } = await client.from('units').insert([{ unit_number, pin }]);
  if (error) return alert(error.message);
  document.getElementById('unitNumber').value = '';
  document.getElementById('unitPin').value = '';
  await loadUnits();
}

async function loadUnits() {
  const { data, error } = await client.from('units').select('*').order('unit_number');
  if (error) {
    document.getElementById('unitList').innerHTML = `<p class="warn">${error.message}</p>`;
    return;
  }
  allUnits = data || [];
  const select = document.getElementById('uploadUnit');
  select.innerHTML = '';
  allUnits.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `Unit ${u.unit_number}`;
    select.appendChild(opt);
  });
  renderUnits();
}

function renderUnits() {
  const q = (document.getElementById('unitSearch')?.value || '').trim().toLowerCase();
  const filtered = allUnits.filter(u => (u.unit_number || '').toLowerCase().includes(q));
  document.getElementById('unitList').innerHTML = filtered.map(u => `
    <div class="unit">
      <strong>Unit ${escapeHtml(u.unit_number)}</strong><br>
      <span class="small">PIN: ${escapeHtml(u.pin)}</span>
    </div>
  `).join('') || '<p>No units found.</p>';
}

async function uploadDocument() {
  const unit_id = document.getElementById('uploadUnit').value;
  const doc_type = document.getElementById('docType').value || 'Whole binder';
  const expiration_date = document.getElementById('expirationDate').value || null;
  const file = document.getElementById('pdfFile').files[0];
  if (!unit_id || !file) return alert('Select unit and choose PDF');

  const { data: unit, error: unitError } = await client.from('units').select('*').eq('id', unit_id).single();
  if (unitError) return alert(unitError.message);

  const cleanName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = `${unit.unit_number}/${Date.now()}-${cleanName}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) return alert(uploadError.message);

  const { data: publicData } = client.storage.from(BUCKET).getPublicUrl(path);
  const { error } = await client.from('documents').insert([{
    unit_id,
    doc_type,
    file_name: file.name,
    file_path: path,
    public_url: publicData.publicUrl,
    expiration_date
  }]);
  if (error) return alert(error.message);

  document.getElementById('expirationDate').value = '';
  document.getElementById('pdfFile').value = '';
  alert('Binder PDF uploaded.');
}

async function driverLogin() {
  const unit_number = document.getElementById('driverUnit').value.trim();
  const pin = document.getElementById('driverPin').value.trim();
  const container = document.getElementById('driverDocs');
  container.innerHTML = '<p>Loading...</p>';
  const normalizedUnit = unit_number.toLowerCase();

  const { data: matchingUnits, error } = await client.from('units').select('*').eq('pin', pin);
  if (error) return container.innerHTML = `<p class="warn">${error.message}</p>`;

  const units = (matchingUnits || []).filter(u => (u.unit_number || '').trim().toLowerCase() === normalizedUnit);
  if (!units.length) return container.innerHTML = '<p class="warn">Wrong unit number or PIN.</p>';

  const unitIds = units.map(u => u.id);
  const unit = units[0];
  const { data: docs, error: docError } = await client.from('documents').select('*').in('unit_id', unitIds).order('created_at', { ascending: false });
  if (docError) return container.innerHTML = `<p class="warn">${docError.message}</p>`;

  currentDocs = docs || [];
  await renderDriverDocs(unit, currentDocs);
}

async function renderDriverDocs(unit, docs) {
  const container = document.getElementById('driverDocs');
  if (!docs.length) {
    container.innerHTML = `<h3>Unit ${escapeHtml(unit.unit_number)} Documents</h3><p>No binder PDF uploaded for this unit.</p>`;
    return;
  }

  let html = `<h3>Unit ${escapeHtml(unit.unit_number)} Documents</h3>
    <button class="secondary" onclick="saveAllOffline()">Save All Offline</button>
    <p class="small">Use Save Offline while internet is working. After that, driver can open the saved copy even with no internet.</p>`;

  for (const d of docs) {
    const saved = await hasOfflineDoc(d.id);
    html += `
      <div class="doc" id="doc-${d.id}">
        <strong>${escapeHtml(d.doc_type || 'Whole binder')}</strong><br>
        <span class="small">${escapeHtml(d.file_name || '')}</span><br>
        ${d.expiration_date ? `<span class="small">Expires: ${escapeHtml(d.expiration_date)}</span><br>` : ''}
        <span class="${saved ? 'good' : 'small'}">${saved ? 'Saved offline on this tablet' : 'Not saved offline yet'}</span>
        <div class="actions">
          <a href="${d.public_url}" target="_blank">Open PDF</a>
          <button onclick="saveDocOffline(${d.id})">Save Offline</button>
          <button class="gray" onclick="openOfflineDoc(${d.id})">Open Saved Copy</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DigitalDriverBinderDB', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToDb(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getFromDb(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    const req = tx.objectStore('pdfs').get(String(id));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function hasOfflineDoc(id) {
  const rec = await getFromDb(id);
  return !!rec;
}

async function saveDocOffline(id) {
  const doc = currentDocs.find(d => Number(d.id) === Number(id));
  if (!doc) return alert('Document not found on this screen. Open Binder again.');
  try {
    const response = await fetch(doc.public_url);
    if (!response.ok) throw new Error('Could not download PDF');
    const blob = await response.blob();
    await saveToDb({ id: String(doc.id), blob, fileName: doc.file_name, docType: doc.doc_type, savedAt: new Date().toISOString() });
    alert('Saved offline on this tablet.');
    await driverLogin();
  } catch (err) {
    alert('Offline save failed: ' + err.message);
  }
}

async function saveAllOffline() {
  for (const d of currentDocs) await saveDocOffline(d.id);
}

async function openOfflineDoc(id) {
  const rec = await getFromDb(id);
  if (!rec) return alert('This PDF is not saved offline on this tablet yet. Click Save Offline first.');
  const url = URL.createObjectURL(rec.blob);
  window.open(url, '_blank');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

loadUnits();
initAccessMode();
