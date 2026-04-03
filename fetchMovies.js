const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;

async function getMovieInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        const tmdbSearchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=sv-SE&page=1`);
        const tmdbSearchData = await tmdbSearchRes.json();
        
        if (tmdbSearchData.results && tmdbSearchData.results.length > 0) {
            const movie = tmdbSearchData.results[0];
            let imdbRating = null;
            let imdbId = null;

            const tmdbDetailsRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_KEY}`);
            const tmdbDetailsData = await tmdbDetailsRes.json();
            imdbId = tmdbDetailsData.imdb_id;

            if (imdbId && OMDB_KEY) {
                const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
                const omdbData = await omdbRes.json();
                if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                    imdbRating = omdbData.imdbRating;
                }
            }

            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null,
                rating: imdbRating || (movie.vote_average ? movie.vote_average.toFixed(1) : null),
                imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/movie/${movie.id}`
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
        }
    } catch (e) {}

    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = "";

    console.log(`Laddar ner EPG...`);
    try {
        const res = await fetch(epgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
    } catch (e) {
        console.error("Fel vid nedladdning:", e.message);
        return;
    }

    const programmes = xml.split('<programme');
    console.log(`Hittade ${programmes.length} program i filen. Letar efter filmer...`);

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        const isMovie = prog.match(/<category[^>]*>.*?([Ff]ilm|[Mm]ovie).*?<\/category>/);
        
        if (isMovie) {
            const channelMatch = prog.match(/channel="(.*?)"/);
            if (!channelMatch) continue;
            
            const channelId = channelMatch[1].toLowerCase();

            // 1. SKIPPA ALLT SOM ÄR PLAY/STREAMING
            if (channelId.includes("play") || channelId.includes("viasat") || channelId.includes("action")) continue;

            // 2. MAPPA KANALERNA (Här gör vi matchningen mjukare)
            let cleanName = "";
            if (channelId.startsWith("svt1")) cleanName = "SVT1";
            else if (channelId.startsWith("svt2")) cleanName = "SVT2";
            else if (channelId.startsWith("tv3")) cleanName = "TV3";
            else if (channelId.startsWith("tv4")) cleanName = "TV4";
            else if (channelId.startsWith("kanal5")) cleanName = "KANAL 5";
            else if (channelId.startsWith("tv6")) cleanName = "TV6";
            else if (channelId.startsWith("sjuan")) cleanName = "SJUAN";
            else if (channelId.startsWith("tv8")) cleanName = "TV8";
            else if (channelId.startsWith("kanal9")) cleanName = "KANAL 9";
            else if (channelId.startsWith("tv10")) cleanName = "TV10";
            else if (channelId.startsWith("kanal11")) cleanName = "KANAL 11";
            else if (channelId.startsWith("tv12")) cleanName = "TV12";

            // Om vi inte hittade en match i vår lista, gå vidare till nästa
            if (!cleanName) continue;

            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            if (!startMatch) continue;

            const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
            if (progDate !== today) continue;

            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

            const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            
            let offset = "+00:00";
            if (startMatch[7]) offset = startMatch[7].substring(0, 3) + ':' + startMatch[7].substring(3, 5);
            const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}${offset}`;
            
            let endTimeMs = null;
            if (stopMatch) {
                const stopDate = `${stopMatch[1]}-${stopMatch[2]}-${stopMatch[3]}`;
                let stopOffset = "+00:00";
                if (stopMatch[7]) stopOffset = stopMatch[7].substring(0, 3) + ':' + stopMatch[7].substring(3, 5);
                endTimeMs = new Date(`${stopDate}T${stopMatch[4]}:${stopMatch[5]}:${stopMatch[6]}${stopOffset}`).getTime();
            }

            if (!moviesToday.find(m => m.title === title && m.channel === cleanName)) {
                console.log(`🎬 Hittade film: ${title} på ${cleanName}`);
                const movieData = await getMovieInfo(title);
                moviesToday.push({
                    title: title,
                    channel: cleanName,
                    startTime: new Date(startTime).getTime(),
                    endTime: endTimeMs,
                    image: movieData ? movieData.poster : null,
                    imdbRate: movieData ? movieData.rating : null,
                    desc: (movieData && movieData.desc) ? movieData.desc : (descMatch ? descMatch[1] : ""),
                    imdbUrl: movieData ? movieData.imdbUrl : null,
                    date: today
                });
                await new Promise(r => setTimeout(r, 250));
            }
        }
    }

    // Slå ihop och spara
    for (const newMovie of moviesToday) {
        const existingIndex = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (existingIndex !== -1) allMovies[existingIndex] = newMovie;
        else allMovies.push(newMovie);
    }

    const now = Date.now();
    allMovies = allMovies.filter(m => (now - m.startTime) <= 7 * 24 * 60 * 60 * 1000);
    allMovies.sort((a, b) => a.startTime - b.startTime);
    
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n✅ KLART! Sparade ${moviesToday.length} filmer för idag.`);
}

run();
