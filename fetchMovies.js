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
    console.log(`Analyserar ${programmes.length} program för ${today}...`);

    // --- UTÖKAD KANAL-LISTA ---
    const channelsToFind = [
        { keys: ["svt1"], name: "SVT1" },
        { keys: ["svt2"], name: "SVT2" },
        { keys: ["tv3"], name: "TV3" },
        { keys: ["tv4"], name: "TV4" },
        { keys: ["kanal5", "k5."], name: "KANAL 5" },
        { keys: ["tv6"], name: "TV6" },
        { keys: ["sjuan"], name: "SJUAN" },
        { keys: ["tv8", "kanal8"], name: "TV8" },
        { keys: ["kanal9", "k9."], name: "KANAL 9" },
        { keys: ["tv10", "kanal10"], name: "TV10" },
        { keys: ["kanal11", "k11."], name: "KANAL 11" },
        { keys: ["tv12"], name: "TV12" }
    ];

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        
        // 1. Kolla kanal ID
        const channelMatch = prog.match(/channel="(.*?)"/);
        if (!channelMatch) continue;
        const rawId = channelMatch[1].toLowerCase();
        
        // Skippa play/streaming (vi kollar efter ".play" eller bara "play" utanför klamrarna)
        if (rawId.includes("play") && !rawId.includes("hd")) continue;

        const foundChannel = channelsToFind.find(c => c.keys.some(k => rawId.includes(k)));
        if (!foundChannel) continue;

        // 2. Kolla Kategori - Vi letar nu efter ALLT som liknar en film
        const categories = [...prog.matchAll(/<category[^>]*>(.*?)<\/category>/gi)].map(m => m[1].toLowerCase());
        const movieKeywords = ["film", "movie", "action", "drama", "thriller", "komedi", "comedy", "sci-fi", "rysare", "skräck", "romantik", "fantasy", "spelfilm"];
        
        const isMovie = categories.some(cat => movieKeywords.some(key => cat.includes(key)));
        
        if (!isMovie) continue;

        // 3. Kolla datum
        const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
        if (!startMatch) continue;
        const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
        if (progDate !== today) continue;

        const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
        const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);
        
        let offset = startMatch[7] ? startMatch[7].substring(0, 3) + ':' + startMatch[7].substring(3, 5) : "+02:00";
        const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}${offset}`;
        
        let endTimeMs = null;
        if (stopMatch) {
            let stopOffset = stopMatch[7] ? stopMatch[7].substring(0, 3) + ':' + stopMatch[7].substring(3, 5) : "+02:00";
            endTimeMs = new Date(`${stopMatch[1]}-${stopMatch[2]}-${stopMatch[3]}T${stopMatch[4]}:${stopMatch[5]}:${stopMatch[6]}${stopOffset}`).getTime();
        }

        if (!moviesToday.find(m => m.title === title && m.channel === foundChannel.name && m.startTime === new Date(startTime).getTime())) {
            console.log(`🎬 HITTAD: ${title} på ${foundChannel.name} (${rawId})`);
            const movieData = await getMovieInfo(title);
            
            moviesToday.push({
                title: title,
                channel: foundChannel.name,
                originalChannel: rawId, 
                startTime: new Date(startTime).getTime(),
                endTime: endTimeMs,
                image: movieData ? movieData.poster : null,
                imdbRate: movieData ? movieData.rating : null,
                desc: (movieData && movieData.desc) ? movieData.desc : (descMatch ? descMatch[1] : "Ingen beskrivning."),
                imdbUrl: movieData && movieData.imdbId ? `https://www.imdb.com/title/${movieData.imdbId}/` : null,
                date: today
            });
            await new Promise(r => setTimeout(r, 200));
        }
    }

    for (const newMovie of moviesToday) {
        const idx = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (idx !== -1) allMovies[idx] = newMovie;
        else allMovies.push(newMovie);
    }

    const now = Date.now();
    allMovies = allMovies.filter(m => (now - m.startTime) <= 7 * 24 * 60 * 60 * 1000);
    allMovies.sort((a, b) => a.startTime - b.startTime);
    
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n✅ Klar! Sparade ${moviesToday.length} filmer.`);
}

run();
