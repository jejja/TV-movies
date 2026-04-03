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
                imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/movie/${movie.id}`
            };
        }
    } catch (e) {}
    return null;
}

async function run() {
    const today = new Date().toISOString().split('T')[0];
    console.log(`Söker efter filmer för datum: ${today}`);

    let moviesToday = [];
    let allMovies = [];
    try {
        if (fs.existsSync('movies.json')) {
            allMovies = JSON.parse(fs.readFileSync('movies.json', 'utf-8'));
        }
    } catch (e) {}

    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = "";

    try {
        const res = await fetch(epgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
    } catch (e) {
        console.error("Fel vid nedladdning:", e.message);
        return;
    }

    // Dela upp filen i program
    const programmes = xml.split('<programme');
    console.log(`Analyserar ${programmes.length} program...`);

    let debugCount = 0;

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        
        // UTÖKAD MATCHNING: Vi letar efter Film, Movie eller Spelfilm
        const categoryMatch = prog.match(/<category[^>]*>(.*?)<\/category>/i);
        const category = categoryMatch ? categoryMatch[1].toLowerCase() : "";
        const isMovie = category.includes("film") || category.includes("movie");

        if (isMovie) {
            const channelMatch = prog.match(/channel="(.*?)"/);
            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})/);

            if (channelMatch && titleMatch && startMatch) {
                const channelId = channelMatch[1].toLowerCase();
                const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
                const title = titleMatch[1].replace(/&amp;/g, '&');

                // DEBUG: Logga de första 5 filmerna vi hittar oavsett kanal för att se vad de heter
                if (debugCount < 5 && progDate === today) {
                    console.log(`DEBUG: Hittade film "${title}" på kanal "${channelId}" med kategori "${category}"`);
                    debugCount++;
                }

                // KOLLA DATUM
                if (progDate !== today) continue;

                // SKIPPA PLAY/STREAMING
                if (channelId.includes("play") || channelId.includes("viasat") || channelId.includes("action")) continue;

                // MAPPA KANALER (Mjukare matchning)
                let cleanName = "";
                if (channelId.includes("svt1")) cleanName = "SVT1";
                else if (channelId.includes("svt2")) cleanName = "SVT2";
                else if (channelId.includes("tv3")) cleanName = "TV3";
                else if (channelId.includes("tv4")) cleanName = "TV4";
                else if (channelId.includes("kanal5")) cleanName = "KANAL 5";
                else if (channelId.includes("tv6")) cleanName = "TV6";
                else if (channelId.includes("sjuan")) cleanName = "SJUAN";
                else if (channelId.includes("tv8")) cleanName = "TV8";
                else if (channelId.includes("kanal9")) cleanName = "KANAL 9";
                else if (channelId.includes("tv10")) cleanName = "TV10";
                else if (channelId.includes("kanal11")) cleanName = "KANAL 11";
                else if (channelId.includes("tv12")) cleanName = "TV12";

                if (!cleanName) continue;

                // Om vi kommit hit har vi en giltig kanal och film!
                const fullStartMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
                const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
                
                let offset = fullStartMatch[7] ? fullStartMatch[7].substring(0, 3) + ':' + fullStartMatch[7].substring(3, 5) : "+02:00";
                const startTime = `${progDate}T${fullStartMatch[4]}:${fullStartMatch[5]}:${fullStartMatch[6]}${offset}`;
                
                let endTimeMs = null;
                if (stopMatch) {
                    let stopOffset = stopMatch[7] ? stopMatch[7].substring(0, 3) + ':' + stopMatch[7].substring(3, 5) : "+02:00";
                    endTimeMs = new Date(`${stopMatch[1]}-${stopMatch[2]}-${stopMatch[3]}T${stopMatch[4]}:${stopMatch[5]}:${stopMatch[6]}${stopOffset}`).getTime();
                }

                if (!moviesToday.find(m => m.title === title && m.channel === cleanName)) {
                    console.log(`✅ SPARAR: ${title} (${cleanName})`);
                    const movieData = await getMovieInfo(title);
                    moviesToday.push({
                        title: title,
                        channel: cleanName,
                        startTime: new Date(startTime).getTime(),
                        endTime: endTimeMs,
                        image: movieData ? movieData.poster : null,
                        imdbRate: movieData ? movieData.rating : null,
                        desc: (movieData && movieData.desc) ? movieData.desc : "Ingen beskrivning.",
                        imdbUrl: movieData ? movieData.imdbUrl : null,
                        date: today
                    });
                    await new Promise(r => setTimeout(r, 250));
                }
            }
        }
    }

    for (const newMovie of moviesToday) {
        const existingIndex = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (existingIndex !== -1) allMovies[existingIndex] = newMovie;
        else allMovies.push(newMovie);
    }

    const now = Date.now();
    allMovies = allMovies.filter(m => (now - m.startTime) <= 7 * 24 * 60 * 60 * 1000);
    allMovies.sort((a, b) => a.startTime - b.startTime);
    
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n🎉 Klart! Hittade totalt ${moviesToday.length} filmer för idag.`);
}

run();
