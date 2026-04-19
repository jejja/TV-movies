const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY ? process.env.TMDB_API_KEY.trim() : null;
const OMDB_KEY = process.env.OMDB_API_KEY ? process.env.OMDB_API_KEY.trim() : null;

let omdbLimitReached = false; // SÄKERHETSBRYTARE FÖR OMDB

// Hjälpfunktion för att få konsekvent datum (YYYY-MM-DD) i svensk tid
function getSwedishDate() {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

async function getMovieDetails(tmdbId, movieTitle) {
    if (!TMDB_KEY) return null;
    try {
        const tmdbDetailsRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=sv-SE&append_to_response=credits`);
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

        // --- SMARTARE OMDB LOGIK ---
        if (!imdbId) {
            console.log(`      -> ⚠️ TMDB saknar IMDb-ID för "${movieTitle}". Sätter N/A.`);
            imdbRating = "N/A";
        } else if (omdbLimitReached) {
            console.log(`      -> ⏭️ Hoppar över OMDb för "${movieTitle}" (API-gränsen är redan nådd).`);
        } else if (OMDB_KEY) {
            try {
                const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
                const omdbData = await omdbRes.json();

                if (omdbData.Response === "False") {
                    if (omdbData.Error && omdbData.Error.toLowerCase().includes("limit")) {
                        console.log(`      -> 🛑 OMDb-gräns nådd vid sökning efter "${movieTitle}"! Avbryter fler betygssökningar idag.`);
                        omdbLimitReached = true;
                    } else {
                        console.log(`      -> ❌ OMDb returnerade fel för "${movieTitle}": ${omdbData.Error}. Sätter N/A.`);
                        imdbRating = "N/A";
                    }
                } else {
                    if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                        console.log(`      -> ✅ Fick betyg från OMDb för "${movieTitle}": ${omdbData.imdbRating}`);
                        imdbRating = omdbData.imdbRating;
                    } else {
                        console.log(`      -> 🤷‍♂️ OMDb hittade filmen "${movieTitle}", men saknar betyg (N/A). Sätter N/A.`);
                        imdbRating = "N/A";
                    }

                    if (omdbData.Ratings) {
                        const rt = omdbData.Ratings.find(r => r.Source === "Rotten Tomatoes");
                        const mc = omdbData.Ratings.find(r => r.Source === "Metacritic");
                        if (rt) rottenRating = rt.Value;
                        if (mc) metaRating = mc.Value;
                    }
                }
            } catch (err) {
                console.log(`      -> ⚠️ Nätverksfel vid kontakt med OMDb för "${movieTitle}".`);
            }
        }

        return {
            poster, backdrop, desc: tmdbDetailsData.overview || null,
            rating: imdbRating, rottenRate: rottenRating, metaRate: metaRating,
            imdbId, runtime: actualRuntime, year, actors, director, genres, language
        };
    } catch (e) {
        console.log(`      -> ⚠️ Kritiskt fel i getMovieDetails för "${movieTitle}":`, e.message);
        return null;
    }
}

async function getMovieInfoByTitle(title) {
    if (!TMDB_KEY) return null;
    try {
        const safeTitle = encodeURIComponent(title).replace(/'/g, "%27");
        const tmdbSearchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${safeTitle}&language=sv-SE&page=1`);
        const tmdbSearchData = await tmdbSearchRes.json();
        if (tmdbSearchData.results && tmdbSearchData.results.length > 0) {
            return await getMovieDetails(tmdbSearchData.results[0].id, title);
        }
    } catch (e) {}
    return null;
}

// TV-GUIDE
async function updateTVGuide() {
    const todayStr = getSwedishDate();
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const options = { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' };
    const tomorrowEarlyStr = new Intl.DateTimeFormat('sv-SE', options).format(tomorrow);

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

        // Ändrad till "let" så vi kan bygga ihop titeln!
        let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/^Dox:\s*/i, '');

        // 1. FÅNGA UPP SUB-TITLE FÖR TV-FILMER OCH FRANCHISER
        const subTitleMatch = prog.match(/<sub-title[^>]*>(.*?)<\/sub-title>/);
        if (subTitleMatch) {
            const subTitle = subTitleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            title = `${title}: ${subTitle}`;
        }

        const categoryMatches = [...prog.matchAll(/<category[^>]*>(.*?)<\/category>/gi)].map(m => m[1]);
        const catsLower = categoryMatches.join(', ').toLowerCase();

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

        const durationMins = (stopTimeMs - startTimeMs) / 60000;
        if (durationMins < 50) continue;

        // 2. FILTRERING OCH SPECIALREGEL FÖR TV-FILMER
        const movieKeywords = ["film", "movie", "spelfilm", "action", "drama", "thriller", "sci-fi", "rysare", "skräck", "komedi", "comedy", "äventyr", "fantasy", "kriminal", "crime", "deckare", "mysterie", "mystery", "romantik", "romance"];
        if (!movieKeywords.some(key => catsLower.includes(key))) continue;

        const hardExcludeKeywords = ["nyheter", "news", "theater"]; // Tog bort "series" härifrån...
        if (hardExcludeKeywords.some(key => catsLower.includes(key))) continue;

        // ...och la till den här så vi kan släppa igenom avsnitt längre än 80 minuter!
        const isSeries = ["series", "serie"].some(key => catsLower.includes(key));
        if (isSeries && durationMins < 80) continue;

        if (!moviesToday.find(m => m.title === title && m.channel === cleanChannelName && m.startTime === startTimeMs)) {
            const existingMovie = allMovies.find(m => m.title === title && m.startTime === startTimeMs);

            const hasValidRating = existingMovie && existingMovie.imdbRate !== null && existingMovie.imdbRate !== "N/A";

            if (hasValidRating) {
                console.log(`♻️ Behåller data (TV): ${title}`);
                moviesToday.push(existingMovie);
            } else {
                if (existingMovie) console.log(`🔧 Lagar betyg (TV): ${title}`);
                else console.log(`🎬 MATCH (TV): ${title}`);

                const movieData = await getMovieInfoByTitle(title);
                moviesToday.push({
                    title, channel: cleanChannelName, originalChannel: rawId, originalCategory: categoryMatches.join(', '),
                    startTime: startTimeMs, endTime: stopTimeMs,
                    image: movieData ? movieData.poster : null, backdrop: movieData ? movieData.backdrop : null,
                    year: movieData ? movieData.year : (prog.match(/<date>(\d{4})<\/date>/)?.[1] || null),
                    actors: movieData ? movieData.actors : null, director: movieData ? movieData.director : null,
                    imdbRate: movieData ? movieData.rating : null,
                    rottenRate: movieData ? movieData.rottenRate : null, metaRate: movieData ? movieData.metaRate : null,
                    genres: movieData ? movieData.genres : null, language: movieData ? movieData.language : null,
                    desc: movieData?.desc || (prog.match(/<desc[^>]*>(.*?)<\/desc>/)?.[1] || "Ingen beskrivning."),
                    imdbUrl: movieData?.imdbId ? `https://www.imdb.com/title/${movieData.imdbId}/` : null,
                    runtime: movieData ? movieData.runtime : null, date: todayStr
                });
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }

    for (const newMovie of moviesToday) {
        const idx = allMovies.findIndex(m => m.title === newMovie.title && m.startTime === newMovie.startTime);
        if (idx !== -1) allMovies[idx] = newMovie;
        else allMovies.push(newMovie);
    }

    const clearLimit = Date.now() - (7 * 24 * 60 * 60 * 1000);
    allMovies = allMovies.filter(m => m.startTime >= clearLimit).sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
}

// SVT PLAY
async function updateSVTPlay() {
    if (!TMDB_KEY) return;
    const todayStr = getSwedishDate();
    console.log(`\n▶️ --- Synkar SVT Play (Upsert) ---`);

    let existingMovies = [];
    try {
        if (fs.existsSync('svtplay.json')) {
            existingMovies = JSON.parse(fs.readFileSync('svtplay.json', 'utf-8'));
        }
    } catch (e) {}

    let currentSweepIds = new Set();
    let newOrUpdatedList = [];

    const queries = [
        { name: "Spelfilmer", url: `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=sv-SE&watch_region=SE&with_watch_providers=493&sort_by=popularity.desc&with_runtime.gte=60&vote_count.gte=20&without_genres=99,10402&page=` },
        { name: "Dokumentärer", url: `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=sv-SE&watch_region=SE&with_watch_providers=493&sort_by=popularity.desc&with_runtime.gte=25&with_genres=99&page=` },
        { name: "Musik", url: `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=sv-SE&watch_region=SE&with_watch_providers=493&sort_by=popularity.desc&with_runtime.gte=50&with_genres=10402&page=` }
    ];

    for (const q of queries) {
        let totalPages = 1;
        for (let page = 1; page <= totalPages; page++) {
            const res = await fetch(q.url + page);
            const data = await res.json();
            if (!res.ok || !data.results) break;
            if (page === 1) totalPages = Math.min(data.total_pages, 10);

            for (const movie of data.results) {
                if (currentSweepIds.has(movie.id)) continue;
                currentSweepIds.add(movie.id);

                let existing = existingMovies.find(m => m.tmdbId === movie.id || (m.title === movie.title && m.year === movie.release_date?.substring(0,4)));

                const hasValidRating = existing && existing.imdbRate !== null && existing.imdbRate !== "N/A";

                if (hasValidRating) {
                    console.log(`♻️  Behåller: ${movie.title}`);
                    existing.stillPresent = true;
                    newOrUpdatedList.push(existing);
                } else {
                    if (existing) console.log(`🔧 Lagar betyg: ${movie.title}`);
                    else console.log(`✨ NY FILM: ${movie.title}`);

                    const details = await getMovieDetails(movie.id, movie.title);
                    if (details && details.genres) {
                        newOrUpdatedList.push({
                            tmdbId: movie.id, title: movie.title, channel: "SVT Play",
                            image: details.poster, backdrop: details.backdrop,
                            year: details.year, actors: details.actors, director: details.director,
                            imdbRate: details.rating, rottenRate: details.rottenRate, metaRate: details.metaRate,
                            genres: details.genres, language: details.language, desc: details.desc || movie.overview,
                            imdbUrl: details.imdbId ? `https://www.imdb.com/title/${details.imdbId}/` : null,
                            runtime: details.runtime,
                            addedDate: (existing && existing.addedDate) ? existing.addedDate : todayStr,
                            stillPresent: true
                        });
                        await new Promise(r => setTimeout(r, 200));
                    }
                }
            }
        }
    }

    if (newOrUpdatedList.length < 50) return;

    const finalData = newOrUpdatedList.filter(m => m.stillPresent);
    finalData.forEach(m => delete m.stillPresent);

    fs.writeFileSync('svtplay.json', JSON.stringify(finalData, null, 2));
    console.log(`✅ Synk klar! Totalt ${finalData.length} filmer.`);
}

async function runAll() {
    // Hämtar variabeln från GitHub Actions, default är 'all'
    const target = process.env.SYNC_TARGET || 'all';

    if (target === 'all' || target === 'tv') {
        await updateTVGuide();
    } else {
        console.log(`\n⏭️ Hoppar över TV-tablån (Körläge: ${target})`);
    }

    if (target === 'all' || target === 'svt') {
        await updateSVTPlay();
    } else {
        console.log(`\n⏭️ Hoppar över SVT Play (Körläge: ${target})`);
    }
}
runAll();