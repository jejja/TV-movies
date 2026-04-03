const fs = require('fs');

const TMDB_KEY = process.env.TMDB_API_KEY;

// 1. Hämta info från TMDB
async function getTMDBInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=sv-SE&page=1`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const movie = data.results[0];
            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null,
                rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
                imdbUrl: `https://www.themoviedb.org/movie/${movie.id}`
            };
        }
    } catch (e) {}
    return null;
}

// 2. Huvudfunktion
async function run() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let moviesToday = [];

    // Länkar till IPTV-org:s öppna arkiv med EPG-data (Sverige)
    const epgUrls = [
        "https://iptv-org.github.io/epg/guides/se/tv.nu.epg.xml",
        "https://iptv-org.github.io/epg/guides/se/tv24.se.epg.xml"
    ];

    let xml = null;
    for (const url of epgUrls) {
        console.log(`Testar att ladda ner EPG från: ${url}`);
        try {
            const res = await fetch(url);
            if (res.ok) {
                xml = await res.text();
                if (xml.includes('<programme')) {
                    console.log("✅ EPG-data hittad!");
                    break;
                }
            }
        } catch (e) {
            console.error("Fel:", e.message);
        }
    }

    if (!xml) {
        console.error("❌ Kunde inte hämta tablån från de öppna källorna.");
        return;
    }

    const programmes = xml.split('<programme');
    console.log(`Söker igenom ${programmes.length} program efter filmer för dagens datum (${today})...`);

    for (const prog of programmes) {
        // Leta efter kategorier i XML-filen som indikerar att det är en film
        if (prog.match(/<(category|genre)[^>]*>\s*(Film|Movie|Cinema)\s*<\/(category|genre)>/i)) {
            
            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const channelMatch = prog.match(/channel="(.*?)"/);
            const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

            if (startMatch && titleMatch && channelMatch) {
                const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
                
                // Hoppa över filmer som inte sänds idag
                if (progDate !== today) continue;

                let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                
                // Snygga till kanalnamnet (t.ex. "svt1.svt.se" -> "SVT1")
                let channel = channelMatch[1].split('.')[0].toUpperCase();
                
                const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}+02:00`;
                let desc = descMatch ? descMatch[1].replace(/&amp;/g, '&') : "Ingen beskrivning.";

                // Undvik dubbletter
                if (!moviesToday.find(m => m.title === title && m.channel === channel)) {
                    console.log(` 🎬 Hittade: ${title} på ${channel}`);
                    
                    const tmdbData = await getTMDBInfo(title);

                    moviesToday.push({
                        title: title,
                        channel: channel,
                        startTime: new Date(startTime).getTime(),
                        image: tmdbData ? tmdbData.poster : null,
                        imdbRate: tmdbData ? tmdbData.rating : null,
                        desc: (tmdbData && tmdbData.desc) ? tmdbData.desc : desc,
                        imdbUrl: tmdbData ? tmdbData.imdbUrl : null,
                        date: today
                    });

                    // Mikropaus för TMDB
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
    }

    moviesToday.sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(moviesToday, null, 2));
    console.log(`\n🎉 Klart! Sparade ${moviesToday.length} filmer till movies.json`);
}

run();
