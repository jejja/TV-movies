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

            const finalRating = imdbRating || (movie.vote_average ? movie.vote_average.toFixed(1) : null);

            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null,
                rating: finalRating,
                imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/movie/${movie.id}`
            };
        }
    } catch (e) {
        console.error(`Fel vid informationshämtning för ${title}:`, e.message);
    }
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
    let xml = null;

    console.log(`Laddar ner EPG...`);
    try {
        const res = await fetch(epgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
    } catch (e) {
        console.error("Fel vid nedladdning av EPG:", e.message);
        return;
    }

    const programmes = xml.split('<programme');
    
    // --- VIKTIGT: Här definierar vi de EXAKTA kanalnamnen i EPG-filen ---
    const allowedChannels = [
        "SVT1.se", "SVT2.se", "TV3.se", "TV4.se", "Kanal5.se", "TV6.se", 
        "Sjuan.se", "TV8.se", "Kanal9.se", "TV10.se", "Kanal11.se", "TV12.se"
    ];

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        const isMovie = prog.match(/<category[^>]*>.*?([Ff]ilm|[Mm]ovie).*?<\/category>/);
        
        if (isMovie) {
            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            const stopMatch = prog.match(/stop="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?"/);
            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const channelMatch = prog.match(/channel="(.*?)"/);
            const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

            if (startMatch && titleMatch && channelMatch) {
                const channelId = channelMatch[1];
                
                // KOLL: Är detta en av våra godkända kanaler? (Vi ignorerar allt med "Play" i namnet)
                if (!allowedChannels.includes(channelId)) continue;

                const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
                if (progDate !== today) continue;

                let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                
                // Snygga till kanalnamnet för din app
                let cleanChannel = channelId.replace('.se', '').toUpperCase();
                if(cleanChannel === "KANAL5") cleanChannel = "KANAL 5";
                if(cleanChannel === "KANAL9") cleanChannel = "KANAL 9";
                if(cleanChannel === "KANAL11") cleanChannel = "KANAL 11";

                let offset = "+00:00";
                if (startMatch[7]) offset = startMatch[7].substring(0, 3) + ':' + startMatch[7].substring(3, 5);
                const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}${offset}`;
                
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
                    const movieData = await getMovieInfo(title);
                    
                    moviesToday.push({
                        title: title,
                        channel: cleanChannel,
                        startTime: new Date(startTime).getTime(),
                        endTime: endTimeMs,
                        image: movieData ? movieData.poster : null,
                        imdbRate: movieData ? movieData.rating : null,
                        desc: (movieData && movieData.desc) ? movieData.desc : desc,
                        imdbUrl: movieData ? movieData.imdbUrl : null,
                        date: today
                    });
                    
                    await new Promise(r => setTimeout(r, 250));
                }
            }
        }
    }

    // Uppdatera arkivet
    for (const newMovie of moviesToday) {
        const existingIndex = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (existingIndex !== -1) {
            allMovies[existingIndex] = newMovie;
        } else {
            allMovies.push(newMovie);
        }
    }

    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    allMovies = allMovies.filter(m => (now - m.startTime) <= sevenDaysInMs);

    allMovies.sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n🎉 Klart! Endast linjära kanaler sparades.`);
}

run();
