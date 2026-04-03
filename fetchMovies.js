const fs = require('fs');

const CHANNELS = ["svt1", "svt2", "tv3", "tv4", "kanal-5", "tv6", "sjuan", "tv8", "kanal-9", "tv10", "kanal-11", "tv12"];
const TMDB_KEY = process.env.TMDB_API_KEY;

// 1. Funktion för att hämta snygga posters från TMDB
async function getTMDBInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=sv-SE&page=1`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const movie = data.results[0];
            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null
            };
        }
    } catch (e) {}
    return null;
}

// 2. Funktion för att hämta tablå från tv.nu (med inbyggd fördröjning för 429)
async function fetchTvNu(channel, dateStr) {
    const url = `https://web-api.tv.nu/channels/${channel}/schedule?date=${dateStr}&fullDay=true`;
    
    for (let i = 0; i < 3; i++) { // Försök upp till 3 gånger per kanal
        const res = await fetch(url, {
            headers: {
                // Vi lurar servern att vi är en vanlig webbläsare
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (res.status === 429) {
            console.log(`[429] Gick lite för snabbt! Väntar 5 sekunder och försöker igen...`);
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }
    return null;
}

// 3. Huvudfunktionen som kör allt
async function run() {
    const dateStr = new Date().toISOString().split('T')[0];
    let moviesToday = [];

    for (const ch of CHANNELS) {
        console.log(`Hämtar tablå för ${ch}...`);
        
        try {
            const data = await fetchTvNu(ch, dateStr);
            
            if (data && data.broadcasts) {
                const movies = data.broadcasts.filter(b => b.isMovie);
                
                for (const m of movies) {
                    console.log(` -> Hittade: ${m.title}`);
                    
                    // Skicka titeln till TMDB för att få snyggare bilder
                    const tmdbData = await getTMDBInfo(m.title);

                    moviesToday.push({
                        title: m.title,
                        channel: ch.toUpperCase(),
                        startTime: new Date(m.startTime).getTime(),
                        // Om TMDB hittar en bild, använd den. Annars ta tv.nu:s inbyggda bild.
                        image: (tmdbData && tmdbData.poster) ? tmdbData.poster : (m.image ? m.image.url : null),
                        imdbRate: m.imdbRate || null,
                        imdbUrl: m.imdbUrl || null,
                        desc: (tmdbData && tmdbData.desc) ? tmdbData.desc : m.description,
                        date: dateStr
                    });

                    // Mikropaus för att inte stressa TMDB:s API
                    await new Promise(r => setTimeout(r, 300));
                }
            }
        } catch (e) {
            console.error(`Kunde inte hämta ${ch}:`, e.message);
        }

        // MAGIN: Vi väntar hela 3 sekunder innan vi går till nästa kanal. 
        // Eftersom detta körs i bakgrunden på natten gör det inget att det tar 1-2 minuter totalt!
        console.log(`Väntar 3 sekunder innan nästa kanal...`);
        await new Promise(r => setTimeout(r, 3000));
    }

    // Sortera filmerna efter starttid
    moviesToday.sort((a, b) => a.startTime - b.startTime);
    
    // Skapa vår statiska JSON-fil
    fs.writeFileSync('movies.json', JSON.stringify(moviesToday, null, 2));
    console.log(`\n🎉 Klart! Sparade ${moviesToday.length} filmer till movies.json`);
}

run();
