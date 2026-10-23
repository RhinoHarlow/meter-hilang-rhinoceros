# Surya Sembada GIS – Meter Hilang & Pencurian Air

Dashboard GIS dengan peta Surabaya (Leaflet + peta OpenStreetMap yang digelapkan lewat CSS) untuk memantau dua jenis kasus:
**Meter Hilang** dan **Pencurian Air**. Server Node.js **tanpa dependensi** (tidak perlu `npm install`).

## Menjalankan (VS Code)
1. Pasang [Node.js 18+](https://nodejs.org).
2. Buka folder ini di VS Code (`File → Open Folder`).
3. Tekan **F5** (konfigurasi "Jalankan server"), atau di terminal: `npm start`.
4. Buka http://localhost:3000 (butuh internet untuk memuat peta).

Saat pertama jalan, server membuat 70 data contoh di `data/reports.json`. Hapus dengan `npm run reset`.

## Fitur
- Layer: Meter Hilang, Pencurian Air, Zona Rawan, Heatmap
- Filter Hari Ini / 24 Jam / 7 Hari, KPI, EWS, Zoom Terparah
- Input laporan dengan klik peta, hapus dari popup marker
- Impor CSV (ganti semua / tambahkan), unduh template, ekspor CSV
- Data otomatis dimuat ulang tiap 30 detik

## Sinkron dari Google Sheets
1. Di Google Sheets: **File → Bagikan → Publikasikan ke web**, pilih tab data, format **CSV**, lalu salin link-nya.
2. Di file `.env` tambahkan: `SHEET_CSV_URL=link-tadi`
3. Jalankan ulang server. Data diambil saat start, lalu tiap `SYNC_MINUTES` menit (default 5), atau klik tombol **Sinkron Google Sheets**.

Catatan: saat `SHEET_CSV_URL` aktif, sheet adalah sumber data utama. Data yang ditambah lewat dashboard akan tertimpa saat sinkron berikutnya.
Koordinat yang rusak akibat lokalitas Indonesia (mis. `-725,259`) otomatis diperbaiki untuk wilayah Jawa Timur (lat -9..-6, lng 111..115, lihat `BOX` di `server.js`).
Google menganggap link "publikasikan ke web" bisa dibaca siapa saja yang punya link, jadi jangan bagikan link itu.

## Format CSV
```
id_meter,no_pelanggan,jenis,kecamatan,lat,lng,waktu_lapor
MTR-24101,PLG-123456,hilang,Genteng,-7.2575,112.7452,2026-10-23 07:30
MTR-24108,PLG-654321,pencurian,Rungkut,-7.3190,112.7800,2026-10-22 21:10
```
`jenis` = `hilang` atau `pencurian`. `waktu_lapor` boleh `2026-10-23 07:30` atau `23/10/2026 07:30`.
Dari Google Sheets/Excel: **File → Unduh → CSV**.

## API
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/health` | status server |
| GET | `/api/reports?jenis=` | daftar laporan |
| POST | `/api/reports` | tambah satu laporan |
| POST | `/api/import` | `{ "rows": [...], "mode": "replace" \| "append" }` |
| DELETE | `/api/reports/:id` | hapus laporan |
| GET | `/api/stats?hours=24` | ringkasan per jenis dan kecamatan |
| POST | `/api/sync` | ambil ulang data dari Google Sheets |
| GET | `/api/export.csv` | ekspor CSV |

Contoh request ada di `api.http` (ekstensi REST Client).

## Pengaman
Salin `.env.example` menjadi `.env` dan isi `API_KEY`. Jika terisi, POST dan DELETE wajib header `x-api-key`; dashboard akan meminta key saat dibutuhkan. **Penting:** untuk dipasang di internet, tambahkan HTTPS (reverse proxy) dan pertimbangkan login yang lebih lengkap.

## Docker
```
docker build -t meter-hilang-gis .
docker run -p 3000:3000 -v "$PWD/data:/app/data" meter-hilang-gis
```

## Mengganti ke database (PostGIS)
Semua akses data ada di bagian `store` pada `server.js` (`rows`, `save()`, `clean()`). Ganti dengan query PostgreSQL/PostGIS; frontend tidak perlu diubah selama format JSON API tetap.

## Push ke GitHub
```
git init
git add .
git commit -m "Dashboard meter hilang & pencurian air"
git branch -M main
git remote add origin https://github.com/USERNAME/meter-hilang-gis.git
git push -u origin main
```
Atau dengan GitHub CLI: `gh repo create meter-hilang-gis --private --source=. --push`.

> Data pada `data/reports.json` tidak ikut ke Git (sudah di `.gitignore`) supaya data pelanggan tidak terunggah.
