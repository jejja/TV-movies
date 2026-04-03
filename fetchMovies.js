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
                if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") imdbRating = omdbData.imdbRating;
            }
            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null,
                rating: imdbRating || (movie.vote_average ? movie.vote_average.toFixed(1) : null),
                imdbId: imdbId
            };
        }
    } catch (e) {}
    return null;
}

async function run() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowEarlyStr = tomorrow.toISOString().split('T')[0];
    
    let moviesToday = [];
    let allMovies = [];
    try {
        if (fs.existsSync('movies.json')) {
            allMovies = JSON.parse(fs.readFileSync('movies.json', 'utf-8'));
        }
    } catch (e) {}

    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = "";

    console.log(`Hämtar EPG...`);
    try {
        const res = await fetch(epgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
    } catch (e) {
        console.error("Fel:", e.message);
        return;
    }

    const programmes = xml.split('<programme');
    console.log(`Analyserar ${programmes.length} program...`);

    // --- EXAKT KANAL-MAPPNING (Baserat på rådatan vi såg) ---
    const channelMap = {
        "[SVT1HD].SVT1.HD.se": "SVT1",
        "[SVT2HD].SVT2.HD.se": "SVT2",
        "[TV3HD].TV3.HD.se": "TV3",
        "[TV4HD].TV4.HD.se": "TV4",
        "[KANAL5HD].Kanal5.HD.se": "KANAL 5",
        "[TV6HD].TV6.HD.se": "TV6",
        "[SJUANHD].Sjuan.HD.se": "SJUAN",
        "[TV8HD].TV8.HD.se": "TV8",
        "[KANAL9HD].Kanal9.HD.se": "KANAL 9",
        "[TV10HD].TV10.HD.se": "TV10",
        "[KANAL11HD].Kanal11.HD.se": "KANAL 11",
        "[TV12HD].TV12.HD.se": "TV12"
    };

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        
        // 1. Kanal-koll (Bara de exakta ID-numren tillåts!)
        const channelMatch = prog.match(/channel="(.*?)"/);
        if (!channelMatch) continue;
        const rawId = channelMatch[1];
        const cleanChannelName = channelMap[rawId];
        if (!cleanChannelName) continue; // Hoppar över TV4 Play och allt annat skräp

        // 2. Kategori-koll (Spara för debug och exkludera Series)
        const categoryMatches = [...prog.matchAll(/<category[^>]*>(.*?)<\/category>/gi)].map(m => m[1]);
        const originalCategory = categoryMatches.join(', ');
        const catsLower = originalCategory.toLowerCase();

        // BLOCKERA SERIER OCH DOKUMENTÄRER
        if (catsLower.includes("series") || catsLower.includes("serie") || catsLower.includes("documentary")) continue;

        const movieKeywords = ["film", "movie", "spelfilm", "action", "drama", "thriller", "sci-fi", "rysare", "skräck", "komedi", "comedy", "äventyr", "fantasy"];
        const isMovie = movieKeywords.some(key => catsLower.includes(key));
        if (!isMovie) continue;

        // 3. Tid och Datum (Idag + Natt fram till 05:00)
        const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
        const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
        if (!startMatch || !stopMatch) continue;

        const progStartDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
        const progHour = parseInt(startMatch[4]);
        const isToday = (progStartDate === todayStr);
        const isEarlyTomorrow = (progStartDate === tomorrowEarlyStr && progHour < 5);
        if (!isToday && !isEarlyTomorrow) continue;

        let offset = startMatch[7] ? startMatch[7].substring(0, 3) + ':' + startMatch[7].substring(3, 5) : "+02:00";
        const startTimeMs = new Date(`${progStartDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}${offset}`).getTime();
        let stopOffset = stopMatch[7] ? stopMatch[7].substring(0, 3) + ':' + stopMatch[7].substring(3, 5) : "+02:00";
        const stopTimeMs = new Date(`${stopMatch[1]}-${stopMatch[2]}-${stopMatch[3]}T${stopMatch[4]}:${stopMatch[5]}:${stopMatch[6]}${stopOffset}`).getTime();
        
        const durationMin = (stopTimeMs - startTimeMs) / 1000 / 60;
        if (durationMin < 70) continue; // Fortfarande 70 minuters-spärr för säkerhet

        const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

        if (!moviesToday.find(m => m.title === title && m.channel === cleanChannelName && m.startTime === startTimeMs)) {
            console.log(`🎬 HITTAD: ${title} på ${cleanChannelName} (Kategori: ${originalCategory})`);
            const movieData = await getMovieInfo(title);
            
            moviesToday.push({
                title: title,
                channel: cleanChannelName,
                originalChannel: rawId,
                originalCategory: originalCategory,
                startTime: startTimeMs,
                endTime: stopTimeMs,
                image: movieData ? movieData.poster : null,
                imdbRate: movieData ? movieData.rating : null,
                desc: (movieData && movieData.desc) ? movieData.desc : (descMatch ? descMatch[1] : "Ingen beskrivning."),
                imdbUrl: movieData && movieData.imdbId ? `https://www.imdb.com/title/${movieData.imdbId}/` : null,
                date: todayStr
            });
            await new Promise(r => setTimeout(r, 200));
        }
    }

    for (const newMovie of moviesToday) {
        const idx = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (idx !== -1) allMovies[idx] = newMovie;
        else allMovies.push(newMovie);
    }

    const clearLimit = Date.now() - (7 * 24 * 60 * 60 * 1000);
    allMovies = allMovies.filter(m => m.startTime >= clearLimit);
    allMovies.sort((a, b) => a.startTime - b.startTime);
    
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n✅ KLART! Sparade ${moviesToday.length} filmer.`);
}

run();
