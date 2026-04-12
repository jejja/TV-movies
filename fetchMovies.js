const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY ? process.env.TMDB_API_KEY.trim() : null;
const OMDB_KEY = process.env.OMDB_API_KEY ? process.env.OMDB_API_KEY.trim() : null;

// ---------------------------------------------------------
// HJÄLPFUNKTION: Hämtar all data (TMDB + OMDB) via TMDB-ID
// ---------------------------------------------------------
async function getMovieDetails(tmdbId) {
    if (!TMDB_KEY) return null;
    try {
        const tmdbDetailsRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits`);
        const tmdbDetailsData = await tmdbDetailsRes.json();

        let imdbRating = null;
        let rottenRating = null;
        let metaRating = null;
        const imdbId = tmdbDetailsData.imdb_id;

        const actualRuntime = tmdbDetailsData.runtime;
        const year = tmdbDetailsData.release_date ? tmdbDetailsData.release_date.substring(0, 4) : null;
        const backdrop = tmdbDetailsData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbDetailsData.backdrop_path}` : null;
        const poster = tmdbDetailsData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbDetailsData.poster_path}` : null;
        const actors = tmdbDetailsData.credits?.cast ? tmdbDetailsData.credits.cast.slice(0, 3).map(a => a.name).join(', ') : null;
        const director = tmdbDetailsData.credits?.crew ? tmdbDetailsData.credits.crew.find(c => c.job === 'Director')?.name : null;

        const language = tmdbDetailsData.original_language || null;
        const genres = tmdbDetailsData.genres ? tmdbDetailsData.genres.map(g => g.name).join(', ') : null;

        // Frågar OMDb för att hämta IMDb-betyg, Rotten Tomatoes och Metacritic
        if (imdbId && OMDB_KEY) {
            try {
                const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
                const omdbData = await omdbRes.json();

                if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") imdbRating = omdbData.imdbRating;
                if (omdbData.Ratings) {
                    const rt = omdbData.Ratings.find(r => r.Source === "Rotten Tomatoes");
                    const mc = omdbData.Ratings.find(r => r.Source === "Metacritic");
                    if (rt) rottenRating = rt.Value;
                    if (mc) metaRating = mc.Value;
                }
            } catch (err) {
                // Tyst felhantering om OMDb bråkar
            }
        }

        return {
            poster: poster,
            backdrop: backdrop,
            desc: tmdbDetailsData.overview || null,
            rating: imdbRating,
            rottenRate: rottenRating,
            metaRate: metaRating,
            imdbId: imdbId,
            runtime: actualRuntime,
            year: year,
            actors: actors,
            director: director,
            genres: genres,
            language: language
        };
    } catch (e) {
        return null;
    }
}

// Hjälpfunktion för Linjär-TV
async function getMovieInfoByTitle(title) {
    if (!TMDB_KEY) return null;
    try {
        const safeTitle = encodeURIComponent(title).replace(/'/g, "%27");
        const tmdbSearchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${safeTitle}&language=sv-SE&page=1`);
        const tmdbSearchData = await tmdbSearchRes.json();

        if (tmdbSearchData.results && tmdbSearchData.results.length > 0) {
            return await getMovieDetails(tmdbSearchData.results[0].id);
        }
    } catch (e) {}
    return null;
}

// ---------------------------------------------------------
// DEL 1: TV-TABLÅN (movies.json)
// ---------------------------------------------------------
async function updateTVGuide() {
    const now = new Date();
    const options = { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('sv-SE', options);
    const todayStr = formatter.format(now);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowEarlyStr = formatter.format(tomorrow);

    let moviesToday = [];
    let allMovies = [];
    try {
        if (fs.existsSync('movies.json')) {
            allMovies = JSON.parse(fs.readFileSync('movies.json', 'utf-8'));
        }
    } catch (e) {}

    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = "";

    console.log(`\n📺 --- Hämtar TV-tablån (EPG) ---`);
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

    const channelMap = {
        "[SVT1HD].SVT1.HD.se": "SVT1", "[SVT2HD].SVT2.HD.se": "SVT2", "[TV3HD].TV3.HD.se": "TV3",
        "[TV4HD].TV4.HD.se": "TV4", "[KANL5HD].KANAL.5.HD.se": "KANAL 5", "[TV6HD].TV6.HD.se": "TV6",
        "[SJUHD].Sjuan.HD.se": "SJUAN", "[TV8HD].TV8.HD.se": "TV8", "[KANAL9H].Kanal.9.HD.se": "KANAL 9",
        "[TV10HD].TV10.HD.se": "TV10", "[KANAL10].Kanal.10.se": "TV10", "[KANL11H].Kanal.11.HD.se": "KANAL 11",
        "[TV12HD].TV12.HD.se": "TV12"
    };

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        const channelMatch = prog.match(/channel="(.*?)"/);
        if (!channelMatch) continue;
        const rawId = channelMatch[1];
        const cleanChannelName = channelMap[rawId];
        if (!cleanChannelName) continue;

        const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/^Dox:\s*/i, '');

        const categoryMatches = [...prog.matchAll(/<category[^>]*>(.*?)<\/category>/gi)].map(m => m[1]);
        const originalCategory = categoryMatches.join(', ');
        const catsLower = originalCategory.toLowerCase();

        const movieKeywords = ["film", "movie", "spelfilm", "action", "drama", "thriller", "sci-fi", "rysare", "skräck", "komedi", "comedy", "äventyr", "fantasy", "kriminal", "crime", "deckare", "mysterie", "mystery", "romantik", "romance"];
        if (!movieKeywords.some(key => catsLower.includes(key))) continue;

        const hardExcludeKeywords = ["series", "serie", "nyheter", "news", "theater"];
        if (hardExcludeKeywords.some(key => catsLower.includes(key))) continue;

        const softExcludeKeywords = ["documentary", "dokumentär"];
        if (softExcludeKeywords.some(key => catsLower.includes(key))) {
            const strongMovieKeywords = ["film", "movie", "spelfilm"];
            if (!strongMovieKeywords.some(key => catsLower.includes(key))) continue;
        }

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
        if (durationMin < 50) continue;

        const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);
        const dateMatch = prog.match(/<date>(\d{4})<\/date>/);
        const xmlYear = dateMatch ? dateMatch[1] : null;

        if (!moviesToday.find(m => m.title === title && m.channel === cleanChannelName && m.startTime === startTimeMs)) {
            console.log(`🎬 MATCH (TV): ${title} på ${cleanChannelName}`);
            const movieData = await getMovieInfoByTitle(title);

            moviesToday.push({
                title: title, channel: cleanChannelName, originalChannel: rawId, originalCategory: originalCategory,
                startTime: startTimeMs, endTime: stopTimeMs,
                image: movieData ? movieData.poster : null, backdrop: movieData ? movieData.backdrop : null,
                year: (movieData && movieData.year) ? movieData.year : xmlYear,
                actors: movieData ? movieData.actors : null, director: movieData ? movieData.director : null,
                imdbRate: movieData ? movieData.rating : null,
                rottenRate: movieData ? movieData.rottenRate : null, metaRate: movieData ? movieData.metaRate : null,
                genres: movieData ? movieData.genres : null,
                language: movieData ? movieData.language : null,
                desc: (movieData && movieData.desc) ? movieData.desc : (descMatch ? descMatch[1] : "Ingen beskrivning."),
                imdbUrl: movieData && movieData.imdbId ? `https://www.imdb.com/title/${movieData.imdbId}/` : null,
                runtime: movieData ? movieData.runtime : null, date: todayStr
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
    console.log(`✅ KLART! Sparade ${moviesToday.length} TV-filmer i movies.json.`);
}

// ---------------------------------------------------------
// DEL 2: SVT PLAY (svtplay.json)
// ---------------------------------------------------------
async function updateSVTPlay() {
    if (!TMDB_KEY) {
        console.log("❌ TMDB_API_KEY saknas eller är felaktig! Hoppar över SVT Play.");
        return;
    }

    console.log(`\n▶️ --- Hämtar SVT Play-filmer via TMDB ---`);
    let svtMovies = [];

    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
        const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=sv-SE&watch_region=SE&with_watch_providers=493&sort_by=popularity.desc&with_runtime.gte=50&vote_count.gte=50&page=${page}`;

        try {
            const res = await fetch(url);
            const data = await res.json();

            if (!res.ok) {
                console.error(`❌ API Fel från TMDB (Status ${res.status}):`, data);
                break;
            }

            if (!data.results || data.results.length === 0) {
                break;
            }

            if (page === 1) {
                // TMDB tillåter max page 500. Utöver det kraschar API:et.
                totalPages = Math.min(data.total_pages, 500);
                console.log(`Hittade totalt ${data.total_pages} sidor hos TMDB. Hämtar alla tillåtna...`);
            }

            for (const movie of data.results) {
                console.log(`🎬 MATCH (SVT Play, Sida ${page}/${totalPages}): ${movie.title}`);
                const details = await getMovieDetails(movie.id);

                if (details) {
                    // NYTT: Kasta filmer som helt saknar genre hos TMDB
                    if (!details.genres || details.genres.trim() === "") {
                        console.log(`⏩ Hoppar över: ${movie.title} (TMDB saknar genredata)`);
                        continue;
                    }

                    svtMovies.push({
                        title: movie.title,
                        originalCategory: "SVT Play",
                        channel: "SVT Play",
                        image: details.poster,
                        backdrop: details.backdrop,
                        year: details.year,
                        actors: details.actors,
                        director: details.director,
                        imdbRate: details.rating,
                        rottenRate: details.rottenRate,
                        metaRate: details.metaRate,
                        genres: details.genres,
                        language: details.language,
                        desc: details.desc || movie.overview,
                        imdbUrl: details.imdbId ? `https://www.imdb.com/title/${details.imdbId}/` : null,
                        runtime: details.runtime
                    });
                }
                await new Promise(r => setTimeout(r, 150));
            }
        } catch (e) {
            console.error("❌ Fel vid hämtning av SVT Play:", e);
        }
    }

    fs.writeFileSync('svtplay.json', JSON.stringify(svtMovies, null, 2));
    console.log(`✅ KLART! Sparade ${svtMovies.length} kurerade filmer i svtplay.json.`);
}

// ---------------------------------------------------------
// KÖR ALLT
// ---------------------------------------------------------
async function runAll() {
    await updateTVGuide();
    await updateSVTPlay();
}

runAll();