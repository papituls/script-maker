// api/index.js - Vercel Serverless Function

// Import modul yang dibutuhkan
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fetch = require('node-fetch');
const he = require('he');

// ======================================================================
// PENTING: ID Spreadsheet ini HARUS diatur sebagai Environment Variable di Vercel
// Nama variable: SPREADSHEET_ID
// Nilai: ID dari Google Spreadsheet Anda
// ======================================================================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ======================================================================
// PENTING: API Key Gemini ini HARUS diatur sebagai Environment Variable di Vercel
// Nama variable: GEMINI_API_KEY
// Nilai: API Key Gemini Anda
// ======================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ======================================================================
// PENTING: Kredensial service account untuk Google Sheets API
// ======================================================================
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

const SHEET_NAME = 'Passwords';

// Inisialisasi Google Auth Client
let sheetsClient;
let googleAuth;

async function initSheetsClient() {
    console.log('initSheetsClient called');
    if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
        console.error('Environment variables for Google Service Account are missing.');
        throw new Error('Google Service Account credentials are not set in Vercel Environment Variables.');
    }
    console.log('Service Account Email:', GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('Private Key starts with (raw):', process.env.GOOGLE_PRIVATE_KEY.substring(0, 50));

    googleAuth = new GoogleAuth({
        credentials: {
            client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive'],
    });
    sheetsClient = await googleAuth.getClient();
    console.log('Sheets client initialized successfully.');
}

// Handler utama untuk Vercel Serverless Function
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).send('OK');
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Only POST is supported.' });
    }

    try {
        if (!sheetsClient) {
            await initSheetsClient();
        }

        const payload = req.body;
        console.log('Received payload:', JSON.stringify(payload, null, 2));
        if (!payload || typeof payload !== 'object' || !payload.action) {
            throw new Error("Payload tidak valid. Pastikan 'action' ada di body request.");
        }

        const action = payload.action;

        let responseData;
        switch (action) {
            case 'checkPassword':
                responseData = { name: await checkPassword(payload.password) };
                break;
            case 'generateScript':
                responseData = await generateScript(payload.productUrl, payload.scriptType, payload.style, payload.length);
                break;
            case 'exportToDoc':
                responseData = { url: await exportToDoc(payload.content, payload.productName) };
                break;
            default:
                throw new Error("Tindakan tidak valid.");
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({ error: `Server Error: ${error.message}` });
    }
};

async function checkPassword(submittedPassword) {
    if (!submittedPassword || typeof submittedPassword !== 'string' || submittedPassword.trim() === '') {
        console.log('Invalid password input:', submittedPassword);
        return null;
    }

    try {
        const sheets = google.sheets({ version: 'v4', auth: sheetsClient });
        console.log('Attempting to access Spreadsheet ID:', SPREADSHEET_ID);
        console.log('Range:', `${SHEET_NAME}!A2:C`);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:C`,
        });

        const data = response.data.values;
        console.log('Spreadsheet data:', data);
        if (!data || data.length === 0) {
            console.log('No data found in Spreadsheet');
            return null;
        }

        const trimmedPassword = submittedPassword.trim();

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const name = String(row[0]).trim();
            const passwordInSheet = String(row[2]).trim();
            console.log(`Comparing password: ${passwordInSheet} with submitted: ${trimmedPassword}`);
            if (passwordInSheet === trimmedPassword && passwordInSheet !== "") {
                return name || "Pengguna";
            }
        }
        console.log('No matching password found');
        return null;
    } catch (e) {
        console.error("Gagal mengakses Spreadsheet:", e.message);
        console.error("Full error:", JSON.stringify(e, null, 2));
        throw new Error("Gagal memeriksa kata sandi. Pastikan Spreadsheet ID dan Service Account benar.");
    }
}

async function generateScript(productUrl, scriptType, style, length) {
    if (!GEMINI_API_KEY) throw new Error("API Key Gemini belum diatur.");

    let productInfo = '';
    try {
        const response = await fetch(productUrl);
        if (!response.ok) {
            productInfo = `Gagal mengambil info dari URL (${response.status}): ${response.statusText}`;
        } else {
            const html = await response.text();
            productInfo = extractTextFromHtml(html);
        }
    } catch (e) {
        productInfo = `Gagal mengambil info dari URL: ${e.message}`;
    }

    if (productInfo.length > 5000) productInfo = productInfo.substring(0, 5000);

    const prompt = `
        Anda adalah "ScriptForge AI", seorang ahli strategi konten dan copywriter video viral. Anda HARUS mengikuti semua instruksi dengan presisi mutlak. KEGAGALAN MENGIKUTI SATU ATURAN PUN AKAN MEMBUAT KESELURUHAN TUGAS GAGAL.

        **PERSONA & GAYA BAHASA INTI:**
        Anda HARUS mengadopsi persona seorang content creator berpengalaman yang sangat ahli dalam menjual produk. Gaya tulisan Anda secara keseluruhan HARUS selalu:
        - **Luwes dan Super Natural:** HINDARI bahasa kaku. Gunakan bahasa sehari-hari yang sangat mengalir. Gunakan sapaan informal (contoh: "guys", "bestie", "sumpah", "gila sih", "pokoknya"). Variasikan struktur kalimat.
        - **Percaya Diri dan Meyakinkan:** Tulis seolah-olah Anda benar-benar sudah mencoba dan jatuh cinta dengan produknya. Tunjukkan antusiasme.
        - **Fokus pada Emosi & Manfaat Nyata:** Jangan hanya sebutkan fitur, tapi terjemahkan menjadi manfaat emosional atau solusi masalah nyata.
        - **Spesial untuk Gaya 'Santai & Menghibur (Gen Z)':** Gunakan bahasa yang SANGAT informal. Masukkan slang Gen Z (contoh: "spill", "fomo", "salty", "check out", "worth it", "sefruit"), campur sedikit bahasa Inggris, dan gunakan emoji secara natural.

        **ANALISIS PRODUK:**
        Informasi Produk (diekstrak dari ${productUrl}):
        """
        ${productInfo}
        """

        **MISI ANDA:**
        Buat TEPAT 5 konsep naskah video yang unik. Setiap naskah HARUS menggunakan formula hook yang berbeda, sesuai urutan di bawah.

        **OPSI PENGGUNA (WAJIB DIIKUTI TANPA PENGECUALIAN):**
        - **Jenis Naskah:** ${scriptType}
        - **Gaya Bahasa:** ${style}
        - **Target Durasi Narasi:** ${length}

        **ATURAN STRUKTUR OUTPUT (PALING PENTING):**
        Anda HARUS menghasilkan sebuah JSON object TUNGGAL yang valid. Strukturnya harus seperti ini:
        {
          "productName": "string",
          "variations": [ "string", "string", "string", "string", "string" ]
        }

        **ATURAN KONTEN UNTUK SETIAP STRING VARIASI (WAJIB DIIKUTI):**
        Setiap string dalam array "variations" HARUS mengikuti format teks multiline ini dengan SEKSAMA, gunakan '\\n' untuk baris baru:

        **[VISUAL]**
        (timestamp) Deskripsi adegan 1...
        (timestamp) Deskripsi adegan 2...

        **[AUDIO]**
        (timestamp) Deskripsi audio 1...

        **[TEKS OVERLAY]**
        (timestamp) Teks yang muncul 1...

        **[NARASI]**
        **(ANALISIS HOOK)** Formula yang Digunakan: [Sebutkan nama formula yang sesuai untuk variasi ini].
        **(HOOK)** Teks hook...
        **(BODY)** Teks body yang panjangnya sesuai target durasi. [Highlight kalimat penting di sini].
        **(CTA)** Teks call to action...

        **ATURAN SPESIFIK KONTEN (ATURAN PALING KRITIKAL):**
        1.  **Panjang Narasi (ATURAN NOMOR SATU):** Aturan ini berlaku untuk TOTAL JUMLAH KATA dari gabungan bagian (HOOK), teks yang di-highlight [seperti ini] di dalam (BODY), dan (CTA).
            - Total gabungan tersebut WAJIB disesuaikan agar TEPAT SASARAN dengan Target Durasi yang dipilih. INI ADALAH ATURAN PALING KRITIS.
            - Jika Target Durasi '${length}' (Sangat Pendek): Total narasi (Hook + Highlight + CTA) HARUS antara 60-90 kata.
            - Jika Target Durasi '${length}' (Sedang): Total narasi (Hook + Highlight + CTA) HARUS antara 120-180 kata.
            - Jika Target Durasi '${length}' (Panjang): Total narasi (Hook + Highlight + CTA) HARUS antara 225-375 kata.
        2.  **Panjang Body (ATURAN NOMOR DUA):** Bagian (BODY) itu sendiri HARUS ditulis secara komprehensif dan detail. Berikan informasi yang kaya dan lengkap, seolah-olah tidak ada batasan kata. Tujuannya adalah memberikan konteks penuh kepada pengguna. Bagian highlight di dalamnya akan menjadi inti narasi yang sesuai durasi.
        3.  **Siklus Formula Hook:** Setiap variasi HARUS menggunakan formula hook yang berbeda secara berurutan:
            - Variasi 1: **Masalah & Solusi**
            - Variasi 2: **Rasa Penasaran & Kontroversi**
            - Variasi 3: **Identifikasi Audiens**
            - Variasi 4: **Hasil di Awal**
            - Variasi 5: **Pertanyaan Langsung**
        4.  **productName:** Identifikasi nama produk yang paling akurat dari informasi yang ada.
        5.  **Jenis Naskah (ATURAN SANGAT TEGAS, WAJIB PATUHI):**
            - **JIKA, DAN HANYA JIKA,** '${scriptType}' adalah **'Narasi + Dialog'**, Anda **WAJIB MENGGANTI TOTAL STRUKTUR** bagian **[NARASI]** menjadi format dialog. Ini bukan pilihan. Anda HARUS menulis percakapan antara minimal dua orang (contoh: Host & Tamu, atau Dua Temen). Abaikan format (HOOK), (BODY), (CTA) standar dan ganti dengan format percakapan ini:
              **[NARASI]**
              **(ANALISIS HOOK)** Formula yang Digunakan: [Sebutkan nama formula].
              **Host:** [Kalimat pembuka/hook]
              **Tamu:** [Respons/kalimat pertama]
              **Host:** [Melanjutkan penjelasan produk lewat dialog]
              **Tamu:** [Menambahkan manfaat atau testimoni]
              **Host:** [Call to action dalam bentuk dialog]
              JANGAN, DALAM KONDISI APAPUN, MENULIS NARASI BIASA KETIKA OPSI INI DIPILIH.
            - Jika '${scriptType}' adalah 'Cinematic', maka bagian [VISUAL] harus sangat detail, deskriptif, dan puitis. Bagian [NARASI] harus lebih singkat dan berdampak.
            - Jika '${scriptType}' adalah 'Narasi Saja', gunakan format standar (HOOK), (BODY), (CTA).
        6.  **Highlight:** Di dalam (BODY), tandai kalimat paling penting dan berdampak dengan format [seperti ini]. Jumlah kata di dalam highlight inilah yang akan dihitung untuk memenuhi target durasi.

        **LANGKAH FINAL:** Periksa kembali output Anda. Pastikan 100% valid sebagai JSON object tunggal dan SETIAP string variasi mengikuti SEMUA aturan di atas, terutama ATURAN PANJANG NARASI (Hook + Highlight + CTA) dan **ATURAN WAJIB UNTUK JENIS NASKAH**.
    `;

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, options);
    
    const responseText = await response.text();
    if (!response.ok) throw new Error("Panggilan API Gemini gagal: " + responseText);

    const jsonResponse = JSON.parse(responseText);
    if (jsonResponse.candidates && jsonResponse.candidates.length > 0) {
        const generatedText = jsonResponse.candidates[0].content.parts[0].text;
        try {
            const cleanText = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
            const resultObject = JSON.parse(cleanText);
            if (resultObject && resultObject.productName && Array.isArray(resultObject.variations)) {
                return resultObject;
            }
            throw new Error("Struktur JSON dari AI tidak sesuai.");
        } catch (e) {
            return { productName: "Gagal Parsing", variations: [generatedText] };
        }
    }
    throw new Error("Tidak ada konten dari AI.");
}

function extractTextFromHtml(htmlString) {
    const cleanedHtml = htmlString
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/ig, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/ig, '')
        .replace(/<\/?[^>]+(>|$)/g, " ")
        .replace(/\s{2,}/g, ' ')
        .trim();
    return he.decode(cleanedHtml);
}

