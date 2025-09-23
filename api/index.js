const express = require('express');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

let sheetsClient = null;

async function initSheetsClient() {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
        },
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive'
        ],
    });
    sheetsClient = await auth.getClient();
    console.log('Sheets client initialized successfully.');
}

async function exportToDoc(content, productName) {
    if (!sheetsClient) {
        console.error('Google Sheets client not initialized.');
        throw new Error('Google Sheets client not initialized.');
    }
    const docs = google.docs({ version: 'v1', auth: sheetsClient });
    const drive = google.drive({ version: 'v3', auth: sheetsClient });
    
    const title = `Script - ${productName || "Nama Produk Tidak Dikenali"}`;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    try {
        console.log('Attempting to create Google Doc with title:', title);
        console.log('Target folder ID:', folderId);
        console.log('Service Account Email:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
        
        // Cek token autentikasi
        const authToken = await sheetsClient.getAccessToken();
        console.log('Access Token obtained:', authToken.token ? 'Valid' : 'Invalid or Empty');
        if (!authToken.token) {
            throw new Error('Authentication token is invalid or missing.');
        }

        // Buat dokumen terlebih dahulu
        const createResponse = await docs.documents.create({
            requestBody: {
                title: title,
            },
        });
        const documentId = createResponse.data.documentId;
        console.log('Document created successfully, ID:', documentId);

        // Insert text
        console.log('Inserting text into document...');
        await docs.documents.batchUpdate({
            documentId: documentId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: {
                                index: 1,
                            },
                            text: content,
                        },
                    },
                ],
            },
        });
        console.log('Text inserted successfully.');

        // Pindahkan dokumen ke folder spesifik
        console.log('Moving document to folder...');
        await drive.files.update({
            fileId: documentId,
            addParents: folderId,
            removeParents: 'root',
            requestBody: {
                // Opsional: Update metadata lain jika diperlukan
            },
        });
        console.log('Document moved to folder successfully.');

        // Opsional: Bagikan secara publik
        console.log('Sharing document publicly...');
        await drive.permissions.create({
            fileId: documentId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });
        console.log('Document shared publicly with read-only access.');

        const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
        console.log('Generated doc URL:', docUrl);
        return docUrl;
    } catch (e) {
        console.error('Gagal membuat Google Doc:', e.message);
        console.error('Full error details:', JSON.stringify(e, null, 2));
        console.error('Error code:', e.code || 'N/A');
        console.error('Error status/reason:', e.errors ? e.errors[0].reason : 'Unknown');
        throw new Error('Gagal membuat Google Doc. Pastikan Service Account memiliki izin di Google Drive Anda.');
    }
}

app.post('/api', async (req, res) => {
    const { action, content, productName } = req.body;

    try {
        await initSheetsClient();
        if (action === 'exportToDoc') {
            const docUrl = await exportToDoc(content, productName);
            res.json({ success: true, url: docUrl });
        } else {
            res.status(400).json({ success: false, message: 'Aksi tidak dikenali' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
