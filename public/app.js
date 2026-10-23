// Frontend dashboard – mengambil data dari server (/api/*) dan menampilkannya di peta Leaflet.
const $ = s => document.querySelector(s);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const D = [["Genteng",-7.2575,112.7452],["Tegalsari",-7.2780,112.7350],["Wonokromo",-7.3010,112.7370],["Rungkut",-7.3300,112.7800],["Sukolilo",-7.2900,112.7950],["Tandes",-7.2550,112.6850],["Benowo",-7.2350,112.6350],["Gubeng",-7.2750,112.7600],["Sawahan",-7.2800,112.7200],["Krembangan",-7.2300,112.7300],["Semampir",-7.2200,112.7600],["Gayungan",-7.3300,112.7300],["Karang Pilang",-7.3400,112.6900],["Mulyorejo",-7.2650,112.8000]];
const T = {
  hilang:    { n: "Meter Hilang",  s: "Hilang",    c: "#f43f5e", ic: "❌", t: "mtr.laporan_hilang" },
  pencurian: { n: "Pencurian Air", s: "Pencurian", c: "#fb923c", ic: "🚨", t: "tsi.pencurian_air" }
};
let P = [], LY = { hilang: 1, pencurian: 1, zona: 1, heat: 0 }, rng = 24, addMode = 0, ref = Date.now();

// ---------- API ----------
async function api(url, opt = {}) {
  const h = { 'Content-Type': 'application/json' }, k = localStorage.getItem('apiKey');
  if (k) h['x-api-key'] = k;
  const r = await fetch(url, { ...opt, headers: h });
  if (r.status === 401) { const n = prompt('Server meminta API key:'); if (n) { localStorage.setItem('apiKey', n); return api(url, opt); } throw new Error('Tidak punya akses'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server tidak merespons (' + r.status + ') – jalankan npm start dan buka http://localhost:3000');
  return j;
}
function demo() {
  return Array.from({ length: 70 }, (_, i) => { const d = D[Math.floor(Math.random() * D.length)];
    return { id: "MTR-" + (24100 + i * 7), pel: "PLG-" + Math.floor(100000 + Math.random() * 899999), k: Math.random() < .6 ? "hilang" : "pencurian", d: d[0], lat: d[1] + (Math.random() - .5) * .018, lng: d[2] + (Math.random() - .5) * .018, ts: Date.now() - Math.random() * 160 * 36e5 }; });
}

async function load(first) {
  try {
    P = (await api('/api/reports')).map(r => ({
      id: r.id,
      pel: r.no_pelanggan,
      k: r.jenis,
      d: r.kecamatan,
      lat: r.lat,
      lng: r.lng,
      ts: new Date(r.waktu_lapor).getTime(),
      pet: r.petugas,
      st: r.status
    }));

    const newest = P.length
      ? Math.max(...P.map(p => p.ts))
      : Date.now();

    ref = Date.now() - newest < 7 * 864e5
      ? Date.now()
      : newest;

    draw();

    if (first) {
      $("#info").textContent =
        `Terhubung ke server • ${P.length} laporan`;
    }
  } catch (e) {
    if (!P.length) {
      P = [];
      ref = Date.now();
      draw();
    }

    $("#info").textContent =
      "⚠ Server tidak terdeteksi. Jalankan 'npm start' lalu buka http://localhost:3000 (bukan lewat Live Server).";
  }
}


// ---------- peta ----------
const map = L.map("map", { zoomControl: false }).setView([-7.2756, 112.7426], 12);
L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
const g = L.layerGroup().addTo(map);
const near = (lat, lng) => D.reduce((b, d) => { const x = (d[1]-lat)**2 + (d[2]-lng)**2; return x < b[0] ? [x, d[0]] : b; }, [1e9, ""])[1];
const vis = () => P.filter(p => (ref - p.ts) / 36e5 <= rng);
function dist() { const o = {}; vis().forEach(p => o[p.d] = (o[p.d] || 0) + 1); return Object.entries(o).sort((a, b) => b[1] - a[1]); }
function cnt() { const o = { hilang: 0, pencurian: 0 }; vis().forEach(p => o[p.k]++); return o; }

function draw() {
  g.clearLayers(); const v = vis(), ds = dist();
  if (LY.zona) ds.slice(0, 5).forEach(([n, c]) => { const d = D.find(x => x[0] == n); if (d) L.circle([d[1], d[2]], { radius: 500 + c * 130, color: "#f43f5e", weight: 1, dashArray: "5 5", fillOpacity: .1 }).addTo(g); });
  if (LY.heat) v.forEach(p => L.circle([p.lat, p.lng], { radius: 450, stroke: false, fillColor: "#fb923c", fillOpacity: .14 }).addTo(g));
  v.filter(p => LY[p.k]).forEach(p => {
    const t = T[p.k];
    const ic = L.divIcon({ className: "", iconSize: [26, 26], html: `<div class="mk"><i style="background:${t.c}"></i><u style="border-color:${t.c};color:${t.c}">${t.ic}</u></div>` });
    L.marker([p.lat, p.lng], { icon: ic }).bindPopup(
      `<b style="color:${t.c}">${t.n}</b><br>${esc(p.id)} • ${esc(p.pel)}<br>Kec. ${esc(p.d)}<br>${new Date(p.ts).toLocaleString("id-ID")}<br>Petugas: ${esc(p.pet || "-")} • ${esc(p.st || "-")}<br>` +
      `<button class="btn" style="margin-top:6px;padding:3px 10px" onclick="del('${encodeURIComponent(p.id)}')">Hapus</button>`).addTo(g);
  });
  const c = cnt();
  $("#kp").innerHTML = Object.keys(T).map(k => `<span class="k"><span class="dot" style="background:${T[k].c}"></span>${T[k].s}: <b>${c[k]}</b></span>`).join("") +
    `<div class="seg">${[[12, "Hari Ini"], [24, "24 Jam"], [168, "7 Hari"]].map(r => `<span data-r="${r[0]}" class="${rng == r[0] ? "on" : ""}">${r[1]}</span>`).join("")}</div>`;
  document.querySelectorAll(".seg span").forEach(s => s.onclick = () => { rng = +s.dataset.r; draw(); });
  $("#ewsn").textContent = c.hilang + c.pencurian;
  $("#crit").textContent = ds.filter(d => d[1] >= 5).length + " Kritis";
}
async function del(id) {
  if (!confirm("Hapus laporan ini?")) return;
  try { await api('/api/reports/' + id, { method: 'DELETE' }); map.closePopup(); load(); } catch (e) { alert(e.message); }
}
window.del = del;

// ---------- panel layer ----------
function lays() {
  const rows = [["hilang", "Laporan Meter Hilang", T.hilang.t, "POINT", T.hilang.c, T.hilang.ic], ["pencurian", "Laporan Pencurian Air", T.pencurian.t, "POINT", T.pencurian.c, T.pencurian.ic], ["zona", "Zona Rawan Kasus", "mtr.zona_rawan", "POLYGON", "#a78bfa", "▢"], ["heat", "Heatmap Kasus", "mtr.heat_kasus", "RASTER", "#fb923c", "🔥"]];
  $("#layers").innerHTML = rows.map(r => `<div class="ly ${LY[r[0]] ? "on" : ""}" data-k="${r[0]}"><i style="background:${r[4]}22;color:${r[4]}">${r[5]}</i><div><b>${r[1]}</b><small>${r[2]} • ${r[3]}</small></div><span class="eye">${LY[r[0]] ? "👁" : "⦸"}</span></div>`).join("");
  document.querySelectorAll(".ly").forEach(e => e.onclick = () => { LY[e.dataset.k] ^= 1; lays(); draw(); });
}

// ---------- copilot (aturan sederhana) ----------
function say(t, u) { const m = document.createElement("div"); m.className = "m" + (u ? " u" : ""); m.textContent = t; $("#chat").appendChild(m); $("#chat").scrollTop = 1e9; }
function ask(q) {
  say(q, 1); const l = q.toLowerCase(), c = cnt(), ds = dist(); let a;
  if (/rawan|paling|wilayah/.test(l)) a = ds.length ? `Wilayah paling rawan: ${ds.slice(0, 3).map(d => d[0] + " (" + d[1] + " kasus)").join(", ")}.` : "Belum ada kasus pada rentang waktu ini.";
  else if (/curi|air/.test(l)) a = `Ada ${c.pencurian} kasus pencurian air pada rentang terpilih.`;
  else if (/hilang|meter/.test(l)) a = `Ada ${c.hilang} meter dilaporkan hilang pada rentang terpilih.`;
  else a = `Ringkasan: ${c.hilang} meter hilang dan ${c.pencurian} kasus pencurian air. Hotspot utama: ${ds[0] ? ds[0][0] : "-"}.`;
  setTimeout(() => say(a), 300);
}
document.querySelectorAll(".chips span").forEach(s => s.onclick = () => ask(s.textContent));
$("#sd").onclick = () => { const v = $("#q").value.trim(); if (v) { ask(v); $("#q").value = ""; } };
$("#q").onkeydown = e => { if (e.key == "Enter") $("#sd").click(); };
$("#bz").onclick = () => { const t = dist()[0]; if (!t) return; const d = D.find(x => x[0] == t[0]); if (d) map.flyTo([d[1], d[2]], 14); };

// ---------- input laporan ----------
$("#add").onclick = () => { addMode ^= 1; $("#add").classList.toggle("on", addMode); $("#info").textContent = addMode ? "Klik lokasi di peta untuk menambah laporan." : "Mode input dimatikan."; };
map.on("click", async e => {
  if (!addMode) return;
  const j = (prompt("Jenis laporan: ketik 1 = Meter Hilang, 2 = Pencurian Air", "1") || "").trim(); if (!j) return;
  try { await api('/api/reports', { method: 'POST', body: JSON.stringify({ jenis: j == "2" ? "pencurian" : "hilang", lat: e.latlng.lat, lng: e.latlng.lng, kecamatan: near(e.latlng.lat, e.latlng.lng) }) }); load(); } catch (er) { alert(er.message); }
});

// ---------- CSV ----------
const HEAD = "id_meter,no_pelanggan,jenis,kecamatan,lat,lng,waktu_lapor";
$("#tpl").onclick = () => { const b = new Blob([HEAD + "\nMTR-24101,PLG-123456,hilang,Genteng,-7.2575,112.7452,2026-10-23 07:30\nMTR-24108,PLG-654321,pencurian,Rungkut,-7.3190,112.7800,2026-10-22 21:10\n"], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "template-meter-hilang.csv"; a.click(); };
const pd = s => { s = (s || "").trim(); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/); return m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : new Date(s.replace(" ", "T")); };
const split = l => { const o = []; let c = "", q = 0; for (const ch of l) { if (ch == '"') q ^= 1; else if ((ch == "," || ch == ";") && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o.map(x => x.trim()); };
$("#imp").onclick = () => $("#file").click();
$("#file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const ls = (await f.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter(x => x.trim());
  const h = split(ls[0]).map(x => x.toLowerCase()), ix = n => h.indexOf(n), rows = [];
  ls.slice(1).forEach(l => { const r = split(l), t = pd(r[ix("waktu_lapor")]); rows.push({ id_meter: r[ix("id_meter")], no_pelanggan: r[ix("no_pelanggan")], jenis: r[ix("jenis")], kecamatan: r[ix("kecamatan")], lat: r[ix("lat")], lng: r[ix("lng")], waktu_lapor: isNaN(t) ? "" : t.toISOString() }); });
  const ganti = confirm("Ganti SEMUA data di server dengan isi file ini?\n\nOK = ganti semua • Batal = tambahkan ke data yang ada");
  try {
    const r = await api('/api/import', { method: 'POST', body: JSON.stringify({ rows, mode: ganti ? 'replace' : 'append' }) });
    await load(); if (P.length) map.fitBounds(P.map(p => [p.lat, p.lng]), { padding: [60, 60] });
    $("#info").textContent = `Impor berhasil: ${r.imported} baris${r.skipped ? `, ${r.skipped} dilewati` : ""}.`;
  } catch (er) { $("#info").textContent = "Impor gagal: " + er.message + " (cek header: " + HEAD + ")"; }
  e.target.value = "";
};

$("#sync").onclick = async () => {
  $("#info").textContent = "Menyinkronkan dari Google Sheets…";
  try { const r = await api('/api/sync', { method: 'POST', body: '{}' }); await load(); $("#info").textContent = `Sinkron berhasil: ${r.imported} baris` + (r.skipped ? `, ${r.skipped} dilewati` : ""); }
  catch (e) { $("#info").textContent = "Sinkron gagal: " + e.message; }
};
lays(); draw(); load(true); setInterval(load, 30000);
