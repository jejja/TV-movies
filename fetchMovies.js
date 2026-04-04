const fs = require('fs');
const zlib = require('zlib');

const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;

async function getMovieInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        // Tvingar apostrofer att URL-kodas för att inte bryta TMDB-anropet
        const safeTitle = encodeURIComponent(title).replace(/'/g, "%27");
        
        const tmdbSearchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${safeTitle}&language=sv-SE&page=1`);
        const tmdbSearchData = await tmdbSearchRes.json();
        
        if (tmdbSearchData.results && tmdbSearchData.results.length > 0) {
            const movie = tmdbSearchData.results[0];
            let imdbRating = null;
            let imdbId = null;
            
            // Vi lägger till &append_to_response=credits för att få skådisar och regissör i samma anrop!
            const tmdbDetailsRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_KEY}&append_to_response=credits`);
            const tmdbDetailsData = await tmdbDetailsRes.json();
            
            imdbId = tmdbDetailsData.imdb_id;
            const actualRuntime = tmdbDetailsData.runtime;
            
            // Plocka ut årtal (de första 4 tecknen i "YYYY-MM-DD")
            const year = tmdbDetailsData.release_date ? tmdbDetailsData.release_date.substring(0, 4) : null;
            
            // Plocka ut en bred bakgrundsbild (backdrop)
            const backdrop = tmdbDetailsData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbDetailsData.backdrop_path}` : null;
            
            // Plocka ut de 3 främsta skådespelarna
            const actors = tmdbDetailsData.credits?.cast ? tmdbDetailsData.credits.cast.slice(0, 3).map(a => a.name).join(', ') : null;
            
            // Leta upp regissören
            const director = tmdbDetailsData.credits?.crew ? tmdbDetailsData.credits.crew.find(c => c.job === 'Director')?.name : null;

            if (imdbId && OMDB_KEY) {
                const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
                const omdbData = await omdbRes.json();
                if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") imdbRating = omdbData.imdbRating;
            }

            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                backdrop: backdrop, // Vår nya snygga bild!
                desc: movie.overview || null,
                rating: imdbRating || null, // Sparar BARA riktiga IMDb-betyg nu, inga TMDB-10:or!
                imdbId: imdbId,
                runtime: actualRuntime,
                year: year,
                actors: actors,
                director: director
            };
        }
    } catch (e) {}
    return null;
}

async function run() {
    const now = new Date();
    
    // Tvinga svensk tidszon så att nattkörningar inte hämtar gårdagens EPG
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

    const channelMap = {
        "[SVT1HD].SVT1.HD.se": "SVT1",
        "[SVT2HD].SVT2.HD.se": "SVT2",
        "[TV3HD].TV3.HD.se": "TV3",
        "[TV4HD].TV4.HD.se": "TV4",
        "[KANL5HD].KANAL.5.HD.se": "KANAL 5",
        "[TV6HD].TV6.HD.se": "TV6",
        "[SJUHD].Sjuan.HD.se": "SJUAN",
        "[TV8HD].TV8.HD.se": "TV8",
        "[KANAL9H].Kanal.9.HD.se": "KANAL 9",
        "[TV10HD].TV10.HD.se": "TV10",
        "[KANAL10].Kanal.10.se": "TV10",
        "[KANL11H].Kanal.11.HD.se": "KANAL 11",
        "[TV12HD].TV12.HD.se": "TV12"
    };

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        
        // 1. Vilken kanal är det?
        const channelMatch = prog.match(/channel="(.*?)"/);
        if (!channelMatch) continue;
        const rawId = channelMatch[1];
        const cleanChannelName = channelMap[rawId];
        if (!cleanChannelName) continue; 

        // 2. Plocka ut titeln tidigt för att kunna logga snyggt, och tvätta den direkt!
        const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
        if (!titleMatch) continue;
        
        const title = titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/^Dox:\s*/i, ''); // Tvättar bort SVT:s Dox-prefix

        // 3. Kategorilogik
        const categoryMatches = [...prog.matchAll(/<category[^>]*>(.*?)<\/category>/gi)].map(m => m[1]);
        const originalCategory = categoryMatches.join(', ');
        const catsLower = originalCategory.toLowerCase();

        const movieKeywords = ["film", "movie", "spelfilm", "action", "drama", "thriller", "sci-fi", "rysare", "skräck", "komedi", "comedy", "äventyr", "fantasy"];
        const isMovie = movieKeywords.some(key => catsLower.includes(key));
        
        if (!isMovie) continue; // Inte en film (t.ex. Rapport). Skippa tyst!

        // HÅRDA exkluderingsord - Blockerar ALLTID
        const hardExcludeKeywords = ["series", "serie", "nyheter", "news", "theater", "concert", "konsert", "musik", "music", "classical", "sport"];
        const foundHardExclude = hardExcludeKeywords.find(key => catsLower.includes(key)); 
        
        if (foundHardExclude) {
            console.log(`🛑 FILTRERAD: "${title}" (Blockerades av ordet: '${foundHardExclude}') | EPG-Kategori: ${originalCategory}`);
            continue; 
        }

        // MJUKA exkluderingsord - Saker som dokumentärer
        const softExcludeKeywords = ["documentary", "dokumentär"];
        const foundSoftExclude = softExcludeKeywords.find(key => catsLower.includes(key));

        if (foundSoftExclude) {
            const strongMovieKeywords = ["film", "movie", "spelfilm"];
            const isExplicitlyMovie = strongMovieKeywords.some(key => catsLower.includes(key));
            
            // Om den är en dokumentär men saknar de starka orden movie/film/spelfilm -> skippa
            if (!isExplicitlyMovie) {
                console.log(`⚠️ FILTRERAD: "${title}" (Är en '${foundSoftExclude}' men saknade starkt film-ord) | EPG-Kategori: ${originalCategory}`);
                continue; 
            }
        }

        // 4. Tid och datum
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
        
        if (durationMin < 70) continue; // För kort för att vara en långfilm

        // 5. Plocka ut resten av datan
        const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);
        const dateMatch = prog.match(/<date>(\d{4})<\/date>/);
        const xmlYear = dateMatch ? dateMatch[1] : null;

        // 6. Spara ner filmen om vi inte redan har den idag
        if (!moviesToday.find(m => m.title === title && m.channel === cleanChannelName && m.startTime === startTimeMs)) {
            console.log(`🎬 MATCH: ${title} på ${cleanChannelName}`);
            const movieData = await getMovieInfo(title);
            
            moviesToday.push({
                title: title,
                channel: cleanChannelName,
                originalChannel: rawId,
                originalCategory: originalCategory,
                startTime: startTimeMs,
                endTime: stopTimeMs,
                image: movieData ? movieData.poster : null,
                backdrop: movieData ? movieData.backdrop : null, 
                year: (movieData && movieData.year) ? movieData.year : xmlYear, 
                actors: movieData ? movieData.actors : null, 
                director: movieData ? movieData.director : null, 
                imdbRate: movieData ? movieData.rating : null,
                desc: (movieData && movieData.desc) ? movieData.desc : (descMatch ? descMatch[1] : "Ingen beskrivning."),
                imdbUrl: movieData && movieData.imdbId ? `https://www.imdb.com/title/${movieData.imdbId}/` : null,
                runtime: movieData ? movieData.runtime : null, 
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

    const clearLimit = Date.now() - (7 * 24 * 60 * 60 * 1000); // Sparar 7 dagars historik
    allMovies = allMovies.filter(m => m.startTime >= clearLimit);
    allMovies.sort((a, b) => a.startTime - b.startTime);
    
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log(`\n✅ KLART! Sparade ${moviesToday.length} filmer.`);
}

run();
