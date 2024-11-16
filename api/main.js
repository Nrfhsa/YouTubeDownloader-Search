const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('yt-dlp-exec');
const ytSearch = require('yt-search')
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const express = require('express');
const bodyParser = require('body-parser');
const cookiesPath = path.join(__dirname, 'config', 'cookies.txt');

// Konfigurasi bot
const token = "7355536746:AAHWuCdE-HKlcnuc_BiLWNKWQzqbzqDiFAU";
const bot = new TelegramBot(token);

// Inisialisasi Express
const app = express();
app.use(bodyParser.json());

// URL publik untuk webhook Anda (ganti dengan URL Vercel Anda)
const WEBHOOK_URL = 'https://your-vercel-deployment.vercel.app/api/bot';

// Atur webhook
bot.setWebHook(`${WEBHOOK_URL}/${token}`);

// Endpoint untuk menerima update dari Telegram
app.post(`/api/bot/${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Tambahkan endpoint untuk verifikasi
app.get('/', (req, res) => {
    res.send('Bot sedang berjalan...');
});

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});

// Handler Search
bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1];

    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang mencari video YouTube...");

    try {
        const result = await ytSearch({ query, hl: 'id' });
        const videos = result.videos;

        if (videos.length === 0) {
            await bot.editMessageText("❌ Tidak ditemukan video yang sesuai dengan pencarian Anda.", {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });
            return;
        }

        // Konfigurasi pagination
        const HASIL_PER_HALAMAN = 5;
        const TOTAL_VIDEO = 20;
        const totalHalaman = Math.ceil(Math.min(videos.length, TOTAL_VIDEO) / HASIL_PER_HALAMAN);
        
        for (let halaman = 0; halaman < totalHalaman; halaman++) {
            const mulaiIndex = halaman * HASIL_PER_HALAMAN;
            const akhirIndex = Math.min(mulaiIndex + HASIL_PER_HALAMAN, Math.min(videos.length, TOTAL_VIDEO));
            
            // Memformat hasil pencarian untuk halaman ini
            const hasilPencarian = videos.slice(mulaiIndex, akhirIndex).map((video, index) => 
                formatDetailVideo(video, mulaiIndex + index + 1)
            ).join('\n\n');

            const nomorHalaman = halaman + 1;
            const caption = `🔍 *Hasil Pencarian YouTube (${mulaiIndex + 1}-${akhirIndex} dari ${Math.min(videos.length, TOTAL_VIDEO)}):*\n\n${hasilPencarian}`;

            // Kirim thumbnail untuk video pertama di setiap grup
            const thumbnailVideo = videos[mulaiIndex];
            await bot.sendPhoto(chatId, thumbnailVideo.thumbnail, {
                caption: caption,
                parse_mode: 'Markdown'
            });

            // Tambahkan jeda kecil antara pesan untuk menghindari rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await bot.deleteMessage(chatId, pesanStatus.message_id);

    } catch (error) {
        console.error(error);
        await bot.editMessageText("❌ Terjadi kesalahan saat mencari video. Silakan coba lagi.", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
});

// Fungsi untuk memformat detail video
function formatDetailVideo(video, index) {
    const { title, timestamp, ago, url, views = 'N/A', author } = video;
    const maxTitleLength = 50;
    const shortenedTitle = title.length > maxTitleLength ? 
        title.substring(0, maxTitleLength) + '...' : 
        title;
    
    return `${index}. *${shortenedTitle}*\n` +
           `👤 Channel: ${author.name}\n` +
           `👀 Ditonton: ${typeof views === 'number' ? views.toLocaleString() : views} kali\n` +
           `⏱️ Durasi: ${timestamp}\n` +
           `📅 Diunggah: ${ago}\n` +
           `🔗 [Tonton Video](${url})`;
}

// Membuat folder downloads
const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir);
}

// Mengecek ukuran file
const getFileSizeInMB = (filePath) => {
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
};

// Fungsi untuk membuat file ZIP
const createZipArchive = (files, outputPath) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`ZIP file created successfully. Size: ${archive.pointer()} bytes`);
            resolve();
        });

        output.on('error', err => {
            console.error("Error creating ZIP file output stream:", err);
            reject(err);
        });

        archive.on('error', err => {
            console.error("Archiver error:", err);
            reject(err);
        });

        archive.pipe(output);
        files.forEach(file => archive.file(file.path, { name: file.name }));
        archive.finalize();
    });
};

// Fungsi untuk membersihkan file yang sudah diunduh
const bersihkanFile = (filePath) => {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`File ${filePath} berhasil dihapus.`);
    } else {
        console.log(`File ${filePath} tidak ditemukan untuk dihapus.`);
    }
};

// Fungsi untuk memvalidasi URL YouTube
const cekURLYouTube = (url) => {
    const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    return pattern.test(url);
};

// Fungsi untuk mengecek apakah URL adalah playlist
const isPlaylist = (url) => {
    return url.includes('playlist?list=') || url.includes('&list=');
};

// Fungsi untuk mendapatkan info video dengan cookies
const getVideoInfo = async (url) => {
    try {
        const options = {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            cookies: cookiesPath,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            addHeader: [
                'Accept-Language: id,en-US;q=0.9,en;q=0.8',
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
            ]
        };

        const info = await ytdl(url, options);
        if (!info) throw new Error('Data video tidak ditemukan');
        
        return info;
    } catch (error) {
        const errMessage = error.stderr || error.message;

        // Jika klaim hak cipta ditemukan, hanya tampilkan pesan ini
        if (errMessage.includes('copyright')) {
            console.error('Video tidak tersedia karena klaim hak cipta.');
            throw new Error('Video tidak tersedia karena klaim hak cipta.');
        }

        // Pesan error default untuk kasus lainnya
        let pesanError = 'Gagal mendapatkan info video';
        if (errMessage.includes('Sign in to confirm')) {
            pesanError = 'Diperlukan autentikasi. Pastikan file cookies.txt sudah diisi dengan benar.';
        }
        
        console.error(pesanError);
        throw new Error(pesanError);
    }
};

// Fungsi untuk mendapatkan info playlist
const getPlaylistInfo = async (url) => {
    try {
        const info = await ytdl(url, {
            dumpSingleJson: true,
            flatPlaylist: true,
            noCheckCertificates: true,
            noWarnings: true
        });
        return info;
    } catch (error) {
        console.error('Error memdapatkan playlist info:', error);
        return null;
    }
};

// Menangani perintah /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const pesan = `Selamat datang di Bot Pengunduh YouTube! 🎉\n\n` +
        `Perintah yang tersedia:\n\n` +
        `🔍 */search [kata kunci]* - Mencari video di YouTube\n` +
        `📥 */mp4 [URL]* - Unduh video format MP4\n` +
        `🎵 */mp3 [URL]* - Unduh audio format MP3\n` +
        `🎬 */webm [URL]* - Unduh video format WebM\n\n` +
        `Untuk playlist, Anda memiliki 2 pilihan:\n\n` +
        `📂 */playlist_mp4 [URL]* - Unduh playlist mp4 (terpisah)\n` +
        `📂 */playlist_mp3 [URL]* - Unduh playlist mp3 (terpisah)\n` +
        `🗂️ */playlist_mp4_zip [URL]* - Unduh playlist mp4 dalam ZIP\n` +
        `🗂️ */playlist_mp3_zip [URL]* - Unduh playlist mp3 dalam ZIP\n\n` +
        `Contoh: /mp4 https://youtube.com/watch?v=xxxxx\n\n` +
        `_Karena keterbatasan BOT Telegram dalam mengirim file yaitu maksimal 50 MB. Beberapa video dan audio tidak dapat diunduh_\n\n` +
        `💡 *Tips:*\n` +
        `- Gunakan unduhan terpisah jika ingin melihat progres per video\n` +
        `- Gunakan unduhan ZIP jika ingin mengunduh sekaligus\n` +
        `- Gunakan url dengan video/audio serupa agar file kurang dari 50 MB`
        ;
    
    bot.sendMessage(chatId, pesan, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
});

// Fungsi untuk mengunduh satu video dari playlist (tanpa ZIP)
const downloadPlaylistItem = async (url, format, chatId, statusMessageId, currentIndex, totalVideos) => {
    try {
        const info = await getVideoInfo(url);
        let outputPath;
        let downloadOptions;

        if (format === 'mp3') {
            outputPath = path.join(downloadDir, `${info.title}.mp3`);
            downloadOptions = {
                output: outputPath,
                cookies: cookiesPath, 
                format: 'bestaudio[ext=mp3]/best',
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: 0,
                addMetadata: true,
                embedThumbnail: true
            };
        } else { 
            outputPath = path.join(downloadDir, `${info.title}.mp4`);
            downloadOptions = {
                output: outputPath,
                cookies: cookiesPath, 
                format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                mergeOutputFormat: 'mp4'
            };
        }

        await bot.editMessageText(`📥 Mengunduh (${currentIndex}/${totalVideos}): ${info.title}...`, {
            chat_id: chatId,
            message_id: statusMessageId
        });

        await ytdl(url, downloadOptions);
        return { info, outputPath };
    } catch (error) {
        console.error(`Error downloading playlist item: ${url}`, error);
        return null;
    }
};

// Fungsi untuk menangani unduhan playlist tanpa ZIP
const handlePlaylist = async (msg, match, format) => {
    const chatId = msg.chat.id;
    const url = match[1];

    if (!cekURLYouTube(url)) {
        return bot.sendMessage(chatId, "⚠️ Mohon masukkan URL YouTube yang valid");
    }

    if (!isPlaylist(url)) {
        return bot.sendMessage(chatId, "⚠️ URL yang dimasukkan bukan playlist YouTube");
    }

    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang memproses playlist...");

    try {
        const playlistInfo = await getPlaylistInfo(url);
        const totalVideos = playlistInfo.entries.length;

        await bot.editMessageText(`📋 Ditemukan ${totalVideos} video dalam playlist\n\n⏳ Memulai pengunduhan...`, {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });

        let berhasilDownload = 0;
        let gagalDownload = 0;

        for (let i = 0; i < playlistInfo.entries.length; i++) {
            const video = playlistInfo.entries[i];
            const result = await downloadPlaylistItem(
                video.url,
                format,
                chatId,
                pesanStatus.message_id,
                i + 1,
                totalVideos
            );

            if (result) {
                const { info, outputPath } = result;
                try {
                    if (format === 'mp3') {
                        await bot.sendAudio(chatId, outputPath, {
                            caption: `✅ ${info.title}\n\n🎵 Audio ${i + 1}/${totalVideos}`,
                            title: info.title,
                            performer: info.uploader || 'Unknown Artist',
                            contentType: 'audio/mp3'
                        });
                    } else {
                        await bot.sendVideo(chatId, outputPath, {
                            caption: `✅ ${info.title}\n\n🎥 Video ${i + 1}/${totalVideos}`,
                            filename: `${info.title}.${format}`,
                            contentType: `video/${format}`
                        });
                    }
                    berhasilDownload++;
                } catch (sendError) {
                    console.error(`Error sending file: ${info.title}`, sendError);
                    gagalDownload++;
                } finally {
                    bersihkanFile(outputPath);
                }
            } else {
                gagalDownload++;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await bot.editMessageText(`✅ Playlist selesai diunduh!\n\n` +
            `📥 Berhasil: ${berhasilDownload} video\n` +
            `❌ Gagal: ${gagalDownload} video`, {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    } catch (error) {
        console.error(error);
        bot.editMessageText("❌ Gagal mengunduh playlist. Silakan coba lagi.", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
};

// Tambahkan handler untuk perintah playlist MP3 tanpa ZIP
bot.onText(/\/playlist_mp3 (.+)/, (msg, match) => {
    handlePlaylist(msg, match, 'mp3');
});

// Tambahkan handler untuk perintah playlist MP4 tanpa ZIP
bot.onText(/\/playlist_mp4 (.+)/, (msg, match) => {
    handlePlaylist(msg, match, 'mp4');
});

// Fungsi untuk mengunduh satu video dari playlist (untuk ZIP)
const downloadPlaylistItemForZip = async (url, format, chatId, statusMessageId, currentIndex, totalVideos) => {
    try {
        const info = await getVideoInfo(url);
        let outputPath;
        let downloadOptions;

        if (format === 'mp3') {
            outputPath = path.join(downloadDir, `${info.title}.mp3`);
            downloadOptions = {
                output: outputPath,
                cookies: cookiesPath, 
                format: 'bestaudio[ext=mp3]/best',
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: 0,
                addMetadata: true
            };
        } else {
            outputPath = path.join(downloadDir, `${info.title}.mp4`);
            downloadOptions = {
                output: outputPath,
                cookies: cookiesPath, 
                format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                mergeOutputFormat: 'mp4'
            };
        }

        await bot.editMessageText(`📥 Mengunduh (${currentIndex}/${totalVideos}): ${info.title}...`, {
            chat_id: chatId,
            message_id: statusMessageId
        });

        await ytdl(url, downloadOptions);
        return {
            path: outputPath,
            name: path.basename(outputPath)
        };
    } catch (error) {
        console.error(`Error downloading playlist item: ${url}`, error);
        return null;
    }
};

// Fungsi untuk menangani unduhan playlist dengan ZIP
const handlePlaylistZip = async (msg, match, format) => {
    const chatId = msg.chat.id;
    const url = match[1];

    // Validasi URL YouTube
    if (!cekURLYouTube(url)) {
        return bot.sendMessage(chatId, "⚠️ Mohon masukkan URL YouTube yang valid");
    }

    // Validasi jika URL adalah playlist
    if (!isPlaylist(url)) {
        return bot.sendMessage(chatId, "⚠️ URL yang dimasukkan bukan playlist YouTube");
    }

    // Pesan status saat memproses playlist
    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang memproses playlist...");

    try {
        const playlistInfo = await getPlaylistInfo(url);
        const playlistTitle = playlistInfo.title.replace(/[^a-zA-Z0-9-_ ]/g, '');
        const zipFileName = `${playlistTitle}_${format}.zip`;
        const zipFilePath = path.join(downloadDir, zipFileName);
        const totalVideos = playlistInfo.entries.length;
        const downloadedFiles = [];

        // Update pesan status dengan jumlah video yang ditemukan
        await bot.editMessageText(`📋 Ditemukan ${totalVideos} video dalam playlist\n\n⏳ Memulai pengunduhan...`, {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });

        // Proses unduh setiap video
        for (let i = 0; i < totalVideos; i++) {
            const video = playlistInfo.entries[i];
            const downloadedFile = await downloadPlaylistItemForZip(
                video.url,
                format,
                chatId,
                pesanStatus.message_id,
                i + 1,
                totalVideos
            );

            if (downloadedFile) {
                downloadedFiles.push(downloadedFile);
            }
        }

        // Buat file ZIP jika ada file yang berhasil diunduh
        if (downloadedFiles.length > 0) {
            await bot.editMessageText(`📦 Membuat file ZIP...`, {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });

            await createZipArchive(downloadedFiles, zipFilePath);
            const fileSizeMB = getFileSizeInMB(zipFilePath);
            console.log(`Ukuran file ZIP setelah dibuat: ${fileSizeMB} MB`);

            // Cek ukuran file ZIP
            if (fileSizeMB > 50) {
                // Kirim pesan peringatan jika file terlalu besar
                await bot.sendMessage(chatId, `⚠️ File ZIP terlalu besar (${fileSizeMB.toFixed(2)} MB) untuk dikirim melalui Telegram. Silakan unduh langsung dari server.`);

                // Jeda sebelum file ZIP dihapus
                setTimeout(() => {
                    bersihkanFile(zipFilePath);
                    console.log(`File ZIP ${zipFilePath} telah dihapus karena terlalu besar untuk dikirim.`);
                }, 5000);

            } else {
                // Kirim file ZIP jika ukurannya sesuai
                await bot.editMessageText(`⬆️ Mengirim file ZIP...`, {
                    chat_id: chatId,
                    message_id: pesanStatus.message_id
                });

                await bot.sendDocument(chatId, zipFilePath, {
                    caption: `✅ Playlist berhasil diunduh!\n📦 Total: ${downloadedFiles.length}/${totalVideos} file`,
                    filename: zipFileName,
                    contentType: 'application/zip'
                });

                // Hapus file ZIP setelah dikirim
                bersihkanFile(zipFilePath);
            }

            // Hapus setiap file unduhan individual setelah proses selesai
            downloadedFiles.forEach(file => bersihkanFile(file.path));

            // Hapus pesan status setelah selesai
            await bot.deleteMessage(chatId, pesanStatus.message_id);

        } else {
            throw new Error('Tidak ada file yang berhasil diunduh');
        }
    } catch (error) {
        console.error("Error processing playlist ZIP:", error);
        await bot.editMessageText("❌ Gagal mengunduh playlist. Silakan coba lagi.", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
};

// Menangani perintah unduh playlist MP3 ZIP
bot.onText(/\/playlist_mp3_zip (.+)/, (msg, match) => {
    handlePlaylistZip(msg, match, 'mp3');
});

// Menangani perintah unduh playlist MP4 ZIP
bot.onText(/\/playlist_mp4_zip (.+)/, (msg, match) => {
    handlePlaylistZip(msg, match, 'mp4');
});

// Handler untuk unduhan MP4
bot.onText(/\/mp4 (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1];

    if (!cekURLYouTube(url)) {
        return bot.sendMessage(chatId, "⚠️ Mohon masukkan URL YouTube yang valid");
    }

    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang memproses permintaan Anda...");

    try {
        const info = await getVideoInfo(url);
        
        if (!info || !info.title) {
            throw new Error('Informasi video tidak lengkap');
        }

        const outputPath = path.join(downloadDir, `${info.title}.mp4`);
        
        await bot.editMessageText("📥 Sedang mengunduh video...", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });

        await ytdl(url, {
            output: outputPath,
            cookies: cookiesPath,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            mergeOutputFormat: 'mp4',
            addHeader: [
                'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language:en-US,en;q=0.9',
                'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
            ]
        });

        const fileSizeMB = getFileSizeInMB(outputPath);
        
        if (fileSizeMB > 50) {
            await bot.editMessageText(`⚠️ File terlalu besar (${fileSizeMB.toFixed(2)} MB) untuk dikirim melalui Telegram. Silakan unduh langsung dari server.`, {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });
            bersihkanFile(outputPath);
        } else {
            await bot.editMessageText("⬆️ Sedang mengirim video...", {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });

            await bot.sendVideo(chatId, outputPath, {
                caption: `✅ ${info.title}\n\n🎥 Video berhasil diunduh!`,
                filename: `${info.title}.mp4`,
                contentType: 'video/mp4'
            });
            
            console.log(`Video ${info.title} berhasil diunduh dan dikirim.`);
            bersihkanFile(outputPath);
            await bot.deleteMessage(chatId, pesanStatus.message_id);
        }

    } catch (error) {
        console.error('Error:', error);
        let pesanError = "❌ Terjadi kesalahan: ";
        
        if (error.message.includes('verifikasi bot')) {
            pesanError += "YouTube meminta verifikasi. Silakan coba lagi nanti atau gunakan URL video lain.";
        } else if (error.message.includes('Informasi video tidak lengkap')) {
            pesanError += "Tidak dapat mengambil informasi video. Pastikan URL valid dan video tersedia.";
        } else {
            pesanError += "Gagal mengunduh video. Silakan coba lagi.";
        }

        await bot.editMessageText(pesanError, {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
});

// Handler untuk unduhan MP3
bot.onText(/\/mp3 (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1];

    if (!cekURLYouTube(url)) {
        return bot.sendMessage(chatId, "⚠️ Mohon masukkan URL YouTube yang valid");
    }

    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang memproses permintaan Anda...");

    try {
        const info = await getVideoInfo(url);
        const outputPath = path.join(downloadDir, `${info.title}.mp3`);
        
        await bot.editMessageText("📥 Sedang mengunduh audio...", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });

        await ytdl(url, {
            output: outputPath,
            cookies: cookiesPath, 
            format: 'bestaudio[ext=mp3]/best',
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
            addMetadata: true,
            embedThumbnail: true
        });

        const fileSizeMB = getFileSizeInMB(outputPath);
        
        if (fileSizeMB > 50) {
            await bot.editMessageText(`⚠️ File terlalu besar (${fileSizeMB.toFixed(2)} MB) untuk dikirim melalui Telegram. Silakan unduh langsung dari server.`, {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });
            bersihkanFile(outputPath);
        } else {
            await bot.editMessageText("⬆️ Sedang mengirim audio...", {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });

            await bot.sendAudio(chatId, outputPath, {
                caption: `✅ ${info.title}\n\n🎵 Audio berhasil diunduh!`,
                title: info.title,
                performer: info.uploader || 'Unknown Artist',
                contentType: 'audio/mp3'
            });

            console.log(`Audio ${info.title} berhasil diunduh dan dikirim.`);
            bersihkanFile(outputPath);
            await bot.deleteMessage(chatId, pesanStatus.message_id);
        }

    } catch (error) {
        console.error(error);
        bot.editMessageText("❌ Gagal mengunduh audio. Silakan coba lagi.", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
});

// Handler untuk unduhan WEBM
bot.onText(/\/webm (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1];

    if (!cekURLYouTube(url)) {
        return bot.sendMessage(chatId, "⚠️ Mohon masukkan URL YouTube yang valid");
    }

    const pesanStatus = await bot.sendMessage(chatId, "⏳ Sedang memproses permintaan Anda...");

    try {
        const info = await getVideoInfo(url);
        const outputPath = path.join(downloadDir, `${info.title}.webm`);
        
        await bot.editMessageText("📥 Sedang mengunduh video...", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });

        await ytdl(url, {
            output: outputPath,
            cookies: cookiesPath, 
            format: 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
            mergeOutputFormat: 'webm'
        });

        const fileSizeMB = getFileSizeInMB(outputPath);
        
        if (fileSizeMB > 50) {
            await bot.editMessageText(`⚠️ File terlalu besar (${fileSizeMB.toFixed(2)} MB) untuk dikirim melalui Telegram. Silakan unduh langsung dari server.`, {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });
            bersihkanFile(outputPath);
        } else {
            await bot.editMessageText("⬆️ Sedang mengirim video...", {
                chat_id: chatId,
                message_id: pesanStatus.message_id
            });

            await bot.sendVideo(chatId, outputPath, {
                caption: `✅ ${info.title}\n\n🎥 Video berhasil diunduh!`,
                filename: `${info.title}.webm`,
                contentType: 'video/webm'
            });
            
            console.log(`Video ${info.title} berhasil diunduh dan dikirim.`);
            bersihkanFile(outputPath);
            await bot.deleteMessage(chatId, pesanStatus.message_id);
        }

    } catch (error) {
        console.error(error);
        bot.editMessageText("❌ Gagal mengunduh video. Silakan coba lagi.", {
            chat_id: chatId,
            message_id: pesanStatus.message_id
        });
    }
});

// Menangani error
bot.on('polling_error', (error) => {
    console.error(error);
});

console.log('Bot sudah berjalan...');
