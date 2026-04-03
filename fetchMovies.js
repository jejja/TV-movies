const fs = require('fs');

const channels = [
    { id: 'svt1.svt.se', name: 'SVT1' },
    { id: 'svt2.svt.se', name: 'SVT2' },
    { id: 'tv3.se', name: 'TV3' },
    { id: 'tv4.se', name: 'TV4' },
    { id: 'kanal5.se', name: 'Kanal 5' },
    { id: 'tv6.se', name: 'TV6' }
];

const TMDB_KEY = process.env.TMDB_API_KEY;

async function getTMDBInfo(title) {
    if (!TMDB_KEY) return null;
    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=sv-SE&page=1`);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const movie = data.results[0];
            return {
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
                desc: movie.overview,
                imdbUrl: `https://www.themoviedb.org/movie/${movie.id}` // TMDB-länk som fallback
            };
        }
    } catch (e) {
        console.error(`Fel vid hämtning från TMDB för ${title}:`, e);
    }
    return null;
}

async function run() {
    const today = new Date().toISOString().split('T')[0];
    let moviesToday = [];

    for (const ch of channels) {
        console.log(`Hämtar tablå för ${ch.name}...`);
        try {
            const res = await fetch(`http://xmltv.xmltv.se/${ch.id}_${today}.xml`);
            if (!res.ok) continue;
            const xml = await res.text();

            const programmes = xml.split('<programme');
            
            for (let i = 1; i < programmes.length; i++) {
                const prog = programmes[i];
                
                if (prog.includes('<category lang="sv">Film</category>')) {
                    const startMatch = prog.match(/start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
                    const titleMatch = prog.match(/<title[^>]*>(.*?)<\/title>/);
                    
                    if (startMatch && titleMatch) {
                        const title = titleMatch[1].replace(/&amp;/g, '&');
                        const startTime = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}T${startMatch[4]}:${startMatch[5]}:${startMatch[6]}+02:00`;
                        
                        console.log(`Hittade film: ${title} på ${ch.name}`);
                        const tmdbData = await getTMDBInfo(title);
                        
                        moviesToday.push({
                            title: title,
                            channel: ch.name,
                            startTime: new Date(startTime).getTime(),
                            image: tmdbData ? tmdbData.poster : null,
                            imdbRate: tmdbData ? tmdbData.rating : null,
                            desc: tmdbData ? tmdbData.desc : "Ingen beskrivning tillgänglig.",
                            imdbUrl: tmdbData ? tmdbData.imdbUrl : null,
                            date: today
                        });
                        
                        await new Promise(r => setTimeout(r, 200));
                    }
                }
            }
        } catch (error) {
            console.error(`Kunde inte hämta ${ch.name}:`, error);
        }
    }

    moviesToday.sort((a, b) => a.startTime - b.startTime);
    fs.writeFileSync('movies.json', JSON.stringify(moviesToday, null, 2));
    console.log(`Klart! Sparade ${moviesToday.length} filmer till movies.json`);
}

run();
