const fs = require('fs');
const zlib = require('zlib'); // Inbyggd modul i Node.js för att packa upp .gz-filer

const TMDB_KEY = process.env.TMDB_API_KEY;

// 1. Hämta info från TMDB
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

// 2. Huvudfunktion
async function run() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let moviesToday = [];

    // Länk till den stora svenska komprimerade EPG-filen
    const epgUrl = "https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz";
    let xml = null;

    console.log(`Laddar ner svensk EPG från: ${epgUrl}`);
    try {
        const res = await fetch(epgUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        // Läs in datan och packa upp zip-formatet (.gz)
        const buffer = await res.arrayBuffer();
        xml = zlib.gunzipSync(Buffer.from(buffer)).toString('utf-8');
        console.log("✅ EPG-data framgångsrikt nedladdad och uppackad!");
        
    } catch (e) {
        console.error("❌ Fel vid nedladdning av EPG:", e.message);
        return;
    }

    const programmes = xml.split('<programme');
    console.log(`Söker igenom ${programmes.length} program efter filmer...`);

    // Vi mappar upp de kanaler vi faktiskt vill visa
    const allowedChannels = ["svt1", "svt2", "tv3", "tv4", "kanal 5", "tv6", "sjuan", "tv8", "kanal 9", "tv10", "kanal 11", "tv12"];

    for (let i = 1; i < programmes.length; i++) {
        const prog = programmes[i];
        
        // Kolla om programmet är taggat som Film / Movie
        const isMovie = prog.match(/<category[^>]*>.*?([Ff]ilm|[Mm]ovie).*?<\/category>/);
        
        if (isMovie) {
            const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
            const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
            const channelMatch = prog.match(/channel="(.*?)"/);
            const descMatch = prog.match(/<desc[^>]*>(.*?)<\/desc>/);

            if (startMatch && titleMatch && channelMatch) {
                const progDate = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
                
                // Filtrera så vi bara tar filmer som sänds idag
                if (progDate !== today) continue;

                let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                let channelRaw = channelMatch[1].toLowerCase();
                
                // Mappa mot vår lista för att sortera bort lokala skräpkanaler
                let matchedChannel = allowedChannels.find(c => channelRaw.includes(c.replace(' ', '')) || channelRaw.includes(c.replace(' ', '')));
                if (!matchedChannel) continue; 
                
                let cleanChannel = matchedChannel.toUpperCase();
                const startTime = `${progDate}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}+02:00`;
                let desc = descMatch ? descMatch[1].replace(/&amp;/g, '&') : "Ingen beskrivning.";

                // Undvik dubbletter om tablån skulle innehålla fel
                if (!moviesToday.find(m => m.title === title && m.channel === cleanChannel)) {
                    console.log(` 🎬 Hittade: ${title} på ${cleanChannel}`);
                    
                    // Gör filmen snygg med din nyckel!
                    const tmdbData = await getTMDBInfo(title);

                    moviesToday.push({
                        title: title,
                        channel: cleanChannel,
                        startTime: new Date(startTime).getTime(),
                        image: tmdbData ? tmdbData.poster : null,
                        imdbRate: tmdbData ? tmdbData.rating : null,
                        desc: (tmdbData && tmdbData.desc) ? tmdbData.desc : desc,
                        imdbUrl: tmdbData ? tmdbData.imdbUrl : null,
                        date: today
                    });

                    // Pytteliten paus så vi inte överbelastar TMDB
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
    }

    moviesToday.sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(moviesToday, null, 2));
    console.log(`\n🎉 Klart! Sparade ${moviesToday.length} filmer till movies.json`);
}

run();
