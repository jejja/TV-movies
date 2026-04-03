const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY; // Hämtar din nya nyckel!

async function getMovieInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        // 1. Sök på TMDB för att få affisch och svensk beskrivning
        const tmdbSearchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=sv-SE&page=1`);
        const tmdbSearchData = await tmdbSearchRes.json();
        
        if (tmdbSearchData.results && tmdbSearchData.results.length > 0) {
            const movie = tmdbSearchData.results[0];
            let imdbRating = null;
            let imdbId = null;

            // 2. Hämta filmens exakta IMDb-ID från TMDB
            const tmdbDetailsRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_KEY}`);
            const tmdbDetailsData = await tmdbDetailsRes.json();
            imdbId = tmdbDetailsData.imdb_id;

            // 3. Om vi har ett IMDb-ID, fråga OMDb efter det exakta IMDb-betyget!
            if (imdbId && OMDB_KEY) {
                const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
                const omdbData = await omdbRes.json();
                
                if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                    imdbRating = omdbData.imdbRating;
                }
            }

            // Fallback: Skulle OMDb misslyckas, tar vi TMDB-betyget i reserv.
            const finalRating = imdbRating || (movie.vote_average ? movie.vote_average.toFixed(1) : null);

            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                desc: movie.overview || null,
                rating: finalRating,
                // Skicka nu användaren till riktiga IMDb istället för TMDB!
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
                    // Skicka till vår nya kombinerade sökfunktion!
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
                    
                    // Liten paus så vi inte stressar sökmotorerna
                    await new Promise(r => setTimeout(r, 250));
                }
            }
        }
    }

    for (const newMovie of moviesToday) {
        // En lite smartare uppdatering av arkivet: Om vi hämtar en film på nytt idag,
        // och den redan finns i historiken (för idag), skriv över den så vi får nya betyget.
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
    console.log(`\n🎉 Klart! Arkivet innehåller nu ${allMovies.length} filmer (med riktiga IMDb-betyg!).`);
}

run();
