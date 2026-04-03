const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY;

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

async function run() {
    const today = new Date().toISOString().split('T')[0];
    let moviesToday = [];
    
    let allMovies = [];
    try {
        if (fs.existsSync('movies.json')) {
            allMovies = JSON.parse(fs.readFileSync('movies.json', 'utf-8'));
            console.log(`Laddade ${allMovies.length} tidigare filmer från arkivet.`);
        }
    } catch (e) {
        console.log("Kunde inte läsa gammalt arkiv, börjar på en ny kula.");
    }

    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = null;

    console.log(`Laddar ner svensk EPG från: ${epgUrl}`);
    try {
        const res = await fetch(epgUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
    } catch (e) {
        console.error("❌ Fel vid nedladdning av EPG:", e.message);
        return;
    }

    const programmes = xml.split('<programme');
    const allowedChannels = ["svt1", "svt2", "tv3", "tv4", "kanal 5", "tv6", "sjuan", "tv8", "kanal 9", "tv10", "kanal 11", "tv12"];

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        const isMovie = prog.match(/<category[^>]*>.*?([Ff]ilm|[Mm]ovie).*?<\/category>/);
        
        if (isMovie) {
            // NYTT: Nu hämtar vi även 'stop'-tiden från EPG-filen!
            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const channelMatch = prog.match(/channel="(.*?)"/);
            const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

            if (startMatch && titleMatch && channelMatch) {
                const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
                if (progDate !== today) continue;

                let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                let channelRaw = channelMatch[1].toLowerCase();
                
                let matchedChannel = allowedChannels.find(c => channelRaw.includes(c.replace(' ', '')) || channelRaw.includes(c.replace(' ', '')));
                if (!matchedChannel) continue; 
                let cleanChannel = matchedChannel.toUpperCase();
                
                let offset = "+00:00";
                if (startMatch[7]) offset = startMatch[7].substring(0, 3) + ':' + startMatch[7].substring(3, 5);
                const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}${offset}`;
                
                // Räkna ut stopptiden
                let endTimeMs = null;
                if (stopMatch) {
                    const stopDate = `${stopMatch[1]}-${stopMatch[2]}-${stopMatch[3]}`;
                    let stopOffset = "+00:00";
                    if (stopMatch[7]) stopOffset = stopMatch[7].substring(0, 3) + ':' + stopMatch[7].substring(3, 5);
                    const stopTime = `${stopDate}T${stopMatch[4]}:${stopMatch[5]}:${stopMatch[6]}${stopOffset}`;
                    endTimeMs = new Date(stopTime).getTime();
                }

                let desc = descMatch ? descMatch[1].replace(/&amp;/g, '&') : "Ingen beskrivning.";

                if (!moviesToday.find(m => m.title === title && m.channel === cleanChannel)) {
                    const tmdbData = await getTMDBInfo(title);
                    moviesToday.push({
                        title: title,
                        channel: cleanChannel,
                        startTime: new Date(startTime).getTime(),
                        endTime: endTimeMs, // Skicka med sluttiden
                        image: tmdbData ? tmdbData.poster : null,
                        imdbRate: tmdbData ? tmdbData.rating : null,
                        desc: (tmdbData && tmdbData.desc) ? tmdbData.desc : desc,
                        imdbUrl: tmdbData ? tmdbData.imdbUrl : null,
                        date: today
                    });
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
    }

    for (const newMovie of moviesToday) {
        const exists = allMovies.find(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (!exists) allMovies.push(newMovie);
    }

    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    allMovies = allMovies.filter(m => (now - m.startTime) <= sevenDaysInMs);

    allMovies.sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n🎉 Klart! Arkivet innehåller nu ${allMovies.length} filmer.`);
}

run();
