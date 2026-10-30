// Server REST sederhana tanpa dependensi (hanya modul bawaan Node 18+).
// Data disimpan di data/reports.json. Untuk produksi, ganti lapisan "store" dengan PostgreSQL/PostGIS.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try { // muat .env sederhana jika ada
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  });
} catch {}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';          // jika diisi, POST/DELETE wajib header x-api-key
const SHEET_URL = process.env.SHEET_CSV_URL || '';   // link "Publikasikan ke web" (format CSV) dari Google Sheets
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || '';
console.log('SHEET_CSV_URL terbaca:', Boolean(SHEET_URL));
console.log('Panjang URL:', SHEET_URL.length);
const SYNC_MIN = +process.env.SYNC_MINUTES || 5;     // sinkron otomatis tiap N menit
const FILE = path.join(__dirname, 'data', 'reports.json');
const PUB = path.join(__dirname, 'public');
const JENIS = ['hilang', 'pencurian'];
const KEC = [['Genteng',-7.2575,112.7452],['Tegalsari',-7.2780,112.7350],['Wonokromo',-7.3010,112.7370],['Rungkut',-7.3300,112.7800],['Sukolilo',-7.2900,112.7950],['Tandes',-7.2550,112.6850],['Benowo',-7.2350,112.6350],['Gubeng',-7.2750,112.7600],['Sawahan',-7.2800,112.7200],['Krembangan',-7.2300,112.7300],['Semampir',-7.2200,112.7600],['Gayungan',-7.3300,112.7300],['Karang Pilang',-7.3400,112.6900],['Mulyorejo',-7.2650,112.8000]];

// ---------- store ----------
let rows = [];
const nearest = (lat, lng) => KEC.reduce((b, d) => { const x = (d[1]-lat)**2 + (d[2]-lng)**2; return x < b[0] ? [x, d[0]] : b; }, [1e9, ''])[1];
function save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(rows)); fs.renameSync(FILE + '.tmp', FILE); }
function seed() {
  rows = Array.from({ length: 70 }, (_, i) => { const d = KEC[Math.floor(Math.random()*KEC.length)];
    return { id: 'MTR-' + (24100 + i*7), no_pelanggan: 'PLG-' + Math.floor(100000 + Math.random()*899999), jenis: Math.random() < .6 ? 'hilang' : 'pencurian',
      kecamatan: d[0], lat: +(d[1] + (Math.random()-.5)*.018).toFixed(5), lng: +(d[2] + (Math.random()-.5)*.018).toFixed(5),
      waktu_lapor: new Date(Date.now() - Math.random()*160*36e5).toISOString() }; });
  save();
}

try {
  rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  if (!Array.isArray(rows)) {
    throw new Error('Format reports.json tidak valid');
  }

  console.log('Database lokal berhasil dibaca:', rows.length, 'laporan');

} catch (error) {
  console.error('DATABASE ERROR:', error.message);
  console.error('Server dihentikan untuk melindungi data asli.');
  process.exit(1);
}


// Koordinat dari Google Sheets berlokalitas Indonesia sering rusak, mis. "-725,259" (seharusnya -7.25259)
// dan "11,267,816" (seharusnya 112.67816). Fungsi ini membaca normal dulu, lalu memperbaiki bila di luar Jawa Timur.
const BOX = { lat: [-9, -6], lng: [111, 115] };
function coord(raw, kind) {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim(); if (!s) return NaN;
  const inBox = v => v >= BOX[kind][0] && v <= BOX[kind][1];
  const n = parseFloat(s.replace(',', '.')); if (inBox(n)) return n;
  const d = s.replace(/\D/g, '');
  if (d) { const v = (s.startsWith('-') ? -1 : 1) * (+d) / 10 ** (d.length - (kind === 'lat' ? 1 : 3)); if (inBox(v)) return v; }
  return n;
}

function pd(s) {
  // Mendukung dd/mm/yyyy hh:mm dan format ISO.
  if (s instanceof Date) {
    return new Date(s.getTime());
  }

  s = String(s || '').trim();

  if (!s) {
    return new Date(NaN);
  }

  // Format Indonesia: 30/10/2026 12:30
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})[:.](\d{2}))?$/
  );

  if (m) {
    const date = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0)
    );

    // Validasi tanggal agar tanggal tidak bergeser otomatis.
    if (
      date.getFullYear() !== Number(m[3]) ||
      date.getMonth() !== Number(m[2]) - 1 ||
      date.getDate() !== Number(m[1])
    ) {
      return new Date(NaN);
    }

    return date;
  }

  // Format ISO: 2026-10-30T12:30:00.000Z
  return new Date(s.replace(' ', 'T'));
}

function parseCSV(t) {
  const out = []; let r = [], c = '', q = false; t = t.replace(/^\uFEFF/, '');
  const endRow = () => { r.push(c); c = ''; if (r.some(x => x.trim())) out.push(r); r = []; };
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; endRow(); } else c += ch; }
  if (c || r.length) endRow();
  const h = (out.shift() || []).map(x => x.trim().toLowerCase());
  return out.map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] || '').trim()])));
}

let lastSync = null;
let syncRunning = false;

async function sync() {
  if (syncRunning) {
    throw new Error('Sinkronisasi masih berjalan');
  }

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_TOKEN) {
    throw new Error('Konfigurasi Apps Script belum lengkap');
  }

  syncRunning = true;

  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('token', APPS_SCRIPT_TOKEN);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error('Google Sheets HTTP ' + response.status);
    }

    const result = await response.json();

    if (!result.ok || !Array.isArray(result.records)) {
      throw new Error(result.error || 'Data Google Sheets tidak valid');
    }

    const cloud = result.records.map(clean);

    const localMap = new Map(
      rows.map(r => [String(r.id), clean(r)])
    );

    const cloudMap = new Map(
      cloud.map(r => [String(r.id), r])
    );

    const merged = new Map();
    const ids = new Set([
      ...localMap.keys(),
      ...cloudMap.keys()
    ]);

    let downloaded = 0;
    let uploaded = 0;
    let archived = 0;
    const errors = [];

    const time = r => {
      const d = new Date(
        r.updated_at || r.deleted_at || r.waktu_lapor
      );
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    for (const id of ids) {
      const local = localMap.get(id);
      const remote = cloudMap.get(id);

      // Hanya ada di Google Sheets.
      if (!local && remote) {
        merged.set(id, remote);
        downloaded++;
        continue;
      }

      // Hanya ada di database lokal.
      if (local && !remote) {
        merged.set(id, local);

        try {
          await writeToGoogleSheets(local);
          uploaded++;
        } catch (e) {
          errors.push({ id, error: e.message });
        }
        continue;
      }

      if (!local || !remote) continue;

      // Jika salah satu sudah diarsipkan,
      // status arsip harus menang.
      if (local.is_deleted || remote.is_deleted) {
        const chosen = local.is_deleted ? local : remote;

        merged.set(id, chosen);

        if (!local.is_deleted || !remote.is_deleted) {
          try {
            await writeToGoogleSheets({
              ...chosen,
              is_deleted: true,
              deleted_at: chosen.deleted_at || new Date().toISOString(),
              deleted_by: chosen.deleted_by || 'RHINOCEROS'
            });

            archived++;
          } catch (e) {
            errors.push({ id, error: e.message });
          }
        }

        continue;
      }

      // Untuk laporan aktif, updated_at menentukan
      // versi terbaru.
      const localNewer = time(local) > time(remote);
      const chosen = localNewer ? local : remote;

      merged.set(id, chosen);

      if (localNewer) {
        try {
          await writeToGoogleSheets(local);
          uploaded++;
        } catch (e) {
          errors.push({ id, error: e.message });
        }
      } else if (time(remote) > time(local)) {
        downloaded++;
      }
    }

    // Simpan gabungan ke lokal secara atomik.
    rows = Array.from(merged.values());
    save();

    lastSync = {
      at: new Date().toISOString(),
      total: rows.length,
      downloaded,
      uploaded,
      archived,
      failed: errors.length,
      errors: errors.slice(0, 10)
    };

    return {
      ...lastSync,
      imported: downloaded,
      skipped: errors.length
    };

  } finally {
    syncRunning = false;
  }
}




function clean(r) {
  const id = String(r.id_meter || r.id || '').trim();

  // Jangan membuat ID acak saat sinkronisasi.
  if (!id) {
    throw new Error('ID laporan kosong');
  }

  const jenisRaw = String(r.jenis || '').toLowerCase();

  const jenis = jenisRaw.includes('curi')
    ? 'pencurian'
    : jenisRaw.includes('hilang')
      ? 'hilang'
      : null;

  if (!jenis) {
    throw new Error('Jenis laporan tidak valid: ' + id);
  }

  const lat = coord(r.lat, 'lat');
  const lng = coord(r.lng, 'lng');

  if (
    !Number.isFinite(lat) ||
    lat < -90 || lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 || lng > 180
  ) {
    throw new Error('Koordinat tidak valid: ' + id);
  }

  const t = pd(r.waktu_lapor);

  if (isNaN(t.getTime())) {
    throw new Error('Waktu laporan tidak valid: ' + id);
  }

  const isDeleted =
    r.is_deleted === true ||
    String(r.is_deleted).toLowerCase() === 'true' ||
    String(r.is_deleted) === '1';

  const deletedAt = r.deleted_at
    ? pd(r.deleted_at)
    : null;

  if (deletedAt && isNaN(deletedAt.getTime())) {
    throw new Error('Waktu arsip tidak valid: ' + id);
  }

  const updatedAt = r.updated_at
    ? pd(r.updated_at)
    : t;

  if (isNaN(updatedAt.getTime())) {
    throw new Error('Waktu pembaruan tidak valid: ' + id);
  }

  return {
    id,
    no_pelanggan: String(r.no_pelanggan || '-').slice(0, 40),
    jenis,
    kecamatan: String(
      r.kecamatan || nearest(lat, lng)
    ).slice(0, 40),
    lat,
    lng,
    waktu_lapor: t.toISOString(),
    petugas: String(r.petugas || '').slice(0, 40),
    status: String(r.status || 'Baru').slice(0, 40),
    is_deleted: isDeleted,
    deleted_at: deletedAt ? deletedAt.toISOString() : '',
    deleted_by: String(r.deleted_by || '').slice(0, 40),
    updated_at: updatedAt.toISOString()
  };
}
async function writeToGoogleSheets(report) {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_TOKEN) {
    throw new Error('Konfigurasi Apps Script belum lengkap');
  }

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('token', APPS_SCRIPT_TOKEN);

  async function post(data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(data),
      redirect: 'follow'
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Gagal mengirim data');
    }

    return result;
  }

  const payload = {
    ...report,
    id_meter: report.id
  };

  if (report.is_deleted) {
    try {
      await post({
        ...payload,
        is_deleted: false,
        action: 'upsert'
      });
    } catch (error) {
      // Jika sudah diarsipkan di cloud, lanjutkan
      // untuk memastikan status arsip tetap konsisten.
      if (!/sudah diarsipkan/i.test(error.message)) {
        throw error;
      }
    }

    return post({
      action: 'archive',
      id_meter: report.id,
      deleted_by: report.deleted_by || 'RHINOCEROS'
    });
  }

  return post({
    ...payload,
    action: 'upsert'
  });
}


// ---------- http ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const body = req => new Promise((ok, no) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > 5e6) { no(new Error('Body terlalu besar (maks 5 MB)')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error('JSON tidak valid')); } }); });
const authed = req => !API_KEY || req.headers['x-api-key'] === API_KEY;

async function api(req, res, u) {
  const p = u.pathname, m = req.method;
  if (p === '/api/health') return send(res, 200, { ok: true, total: rows.length, auth: !!API_KEY, sheet: !!SHEET_URL, lastSync });
  if (p === '/api/reports' && m === 'GET') {
    const j = u.searchParams.get('jenis'); return send(res, 200, j ? rows.filter(r => r.jenis === j) : rows);
  }
  if (p === '/api/export.csv' && m === 'GET') {
    const h = 'id_meter,no_pelanggan,jenis,kecamatan,lat,lng,waktu_lapor';
    const esc = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    return send(res, 200, [h, ...rows.map(r => [r.id, r.no_pelanggan, r.jenis, r.kecamatan, r.lat, r.lng, r.waktu_lapor].map(esc).join(','))].join('\n'), 'text/csv; charset=utf-8');
  }
  if (p === '/api/stats' && m === 'GET') {
    const hrs = +u.searchParams.get('hours') || 24, now = Date.now(), out = { hours: hrs, hilang: 0, pencurian: 0, kecamatan: {} };
    rows.filter(r => now - new Date(r.waktu_lapor) <= hrs*36e5).forEach(r => { out[r.jenis]++; (out.kecamatan[r.kecamatan] ||= { hilang: 0, pencurian: 0 })[r.jenis]++; });
    return send(res, 200, out);
  }
  if (m === 'POST' || m === 'DELETE') if (!authed(req)) return send(res, 401, { error: 'API key salah / belum diisi' });
  if (p === '/api/sync' && m === 'POST') return send(res, 200, await sync());
  
if (p === '/api/reports' && m === 'POST') {
  const input = await body(req);

  console.log('KOORDINAT MENTAH:', input.lat, input.lng);

  const r = clean(input);

  console.log('KOORDINAT SETELAH CLEAN:', r.lat, r.lng);
  console.log('ID LAPORAN:', r.id);

  // Simpan lokal terlebih dahulu agar data tetap aman.
  rows.push(r);
  save();

  // Kirim ke Google Sheets jika integrasi sudah dikonfigurasi.
  if (APPS_SCRIPT_URL && APPS_SCRIPT_TOKEN) {
    try {
      const result = await writeToGoogleSheets(r);
      return send(res, 201, { ...r, synced_to_sheets: true, sheet_id: result.id_meter });
    } catch (e) {
      console.error('Gagal menulis ke Google Sheets:', e.message);
      return send(res, 201, {
        ...r,
        synced_to_sheets: false,
        warning: 'Tersimpan lokal, tetapi gagal dikirim ke Google Sheets.'
      });
    }
  }

  return send(res, 201, {
    ...r,
    synced_to_sheets: false,
    warning: 'Konfigurasi Google Sheets belum tersedia.'
  });
}

  if (p === '/api/import' && m === 'POST') {
    const b = await body(req); if (!Array.isArray(b.rows)) throw new Error('Kirim { rows: [...] }');
    const ok = [], bad = []; b.rows.forEach((r, i) => { try { ok.push(clean(r)); } catch (e) { bad.push({ baris: i + 1, error: e.message }); } });
    if (!ok.length) return send(res, 400, { error: 'Tidak ada baris valid', bad: bad.slice(0, 10) });
    rows = b.mode === 'append' ? rows.concat(ok) : ok; save(); return send(res, 200, { imported: ok.length, skipped: bad.length, bad: bad.slice(0, 10) });
  }

const d = p.match(/^\/api\/reports\/(.+)$/);

if (d && m === 'DELETE') {
  const id = decodeURIComponent(d[1]);

  const index = rows.findIndex(
    r => String(r.id) === id
  );

  if (index === -1) {
    return send(res, 404, {
      error: 'Laporan tidak ditemukan'
    });
  }

  const report = rows[index];

  // Jangan mengarsipkan ulang laporan yang sudah diarsipkan.
  if (report.is_deleted) {
    return send(res, 200, {
      archived: true,
      already_archived: true,
      id: id
    });
  }

  const now = new Date().toISOString();

  // Soft Delete: data tidak dihapus dari database lokal.
  rows[index] = {
    ...report,
    is_deleted: true,
    deleted_at: now,
    deleted_by: 'RHINOCEROS',
    updated_at: now
  };

  // Simpan lokal terlebih dahulu.
  save();

  // Kirim perubahan arsip ke Google Sheets.
  try {
    await writeToGoogleSheets(rows[index]);

    return send(res, 200, {
      archived: true,
      synced_to_sheets: true,
      id: id,
      message: 'Laporan berhasil diarsipkan'
    });

  } catch (error) {
    console.error(
      'Sinkronisasi arsip tertunda:',
      error.message
    );

    return send(res, 200, {
      archived: true,
      synced_to_sheets: false,
      id: id,
      message: 'Arsip tersimpan lokal dan menunggu sinkronisasi'
    });
  }
}

send(res, 404, {
  error: 'Endpoint tidak ditemukan'
});

} // PENUTUP FUNGSI api()

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    let f = path.normalize(path.join(PUB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
    if (!f.startsWith(PUB)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(f, (e, data) => e ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, data, MIME[path.extname(f)] || 'application/octet-stream'));
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(`Dashboard Meter Hilang: http://localhost:${PORT}  (data: ${rows.length} laporan${API_KEY ? ', API key aktif' : ''})`));


/*
if (APPS_SCRIPT_URL && APPS_SCRIPT_TOKEN) {
  const run = () => {
    sync()
      .then(r => console.log(
        'Sinkronisasi RHINOCEROS:',
        JSON.stringify(r, null, 2)
      ))
      .catch(e => console.error(
        'Sinkronisasi gagal:',
        e.message
      ));
  };

  setTimeout(run, 3000);
  setInterval(run, SYNC_MIN * 60000);
}
*/

