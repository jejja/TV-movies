function getDurationText(m) {
    if (m.runtime && m.runtime > 0) {
        const hours = Math.floor(m.runtime / 60);
        const mins = m.runtime % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    if (!m.startTime || !m.endTime) return "";
    const diffMs = m.endTime - m.startTime;
    if (diffMs <= 0) return "";
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('menuOverlay');
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
        menu.classList.remove('open');
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    } else {
        menu.classList.add('open');
        overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function openSharedModal(m, source) {
    document.getElementById('modalTitle').innerText = m.title + (m.year ? ` (${m.year})` : '');

    // N/A kontroll för betyget i modalen
    document.getElementById('modalRating').innerText = (m.imdbRate && m.imdbRate !== "N/A") ? `★ ${m.imdbRate}` : '★ -';

    if (m.rottenRate) {
        document.getElementById('rtWrap').style.display = 'flex';
        document.getElementById('modalRotten').innerText = m.rottenRate;
    } else {
        document.getElementById('rtWrap').style.display = 'none';
    }

    if (m.metaRate) {
        document.getElementById('mcWrap').style.display = 'flex';
        document.getElementById('modalMetacritic').innerText = m.metaRate;
        const mcScore = parseInt(m.metaRate);
        const mcIcon = document.getElementById('modalMetaIcon');
        if (mcScore >= 61) { mcIcon.style.background = '#66cc33'; mcIcon.style.color = 'black'; }
        else if (mcScore >= 40) { mcIcon.style.background = '#ffcc33'; mcIcon.style.color = 'black'; }
        else { mcIcon.style.background = '#ff0000'; mcIcon.style.color = 'white'; }
    } else {
        document.getElementById('mcWrap').style.display = 'none';
    }

    let rawGenres = m.genres || m.originalCategory || 'Film';
    let filteredGenres = rawGenres.split(',')
        .map(g => g.trim())
        .filter(g => {
            const low = g.toLowerCase();
            return low !== "movie" && low !== "film" && low !== "spelfilm" && low !== "spelfilmer";
        })
        .join(', ');
    document.getElementById('modalGenre').innerText = filteredGenres || 'Långfilm';

    document.getElementById('modalGenre').style.color = source === 'svt' ? 'var(--svt)' : 'var(--accent)';

    const heroImg = m.backdrop || m.image || '';
    if (heroImg) {
        document.getElementById('modalPoster').src = heroImg;
        document.getElementById('modalPoster').style.display = 'block';
        document.getElementById('modalPosterPlaceholder').style.display = 'none';
    } else {
        document.getElementById('modalPoster').style.display = 'none';
        document.getElementById('modalPosterPlaceholder').style.display = 'flex';
    }

    document.getElementById('modalDesc').innerText = m.desc || 'Ingen beskrivning tillgänglig.';

    let castHtml = '';
    if (m.director) castHtml += `<strong>Regi:</strong> ${m.director}<br>`;
    if (m.actors) castHtml += `<strong>Skådespelare:</strong> ${m.actors}`;
    document.getElementById('modalCast').innerHTML = castHtml;
    document.getElementById('modalCast').style.display = castHtml ? 'block' : 'none';

    const durationStr = getDurationText(m);
    if (source === 'svt') {
        document.getElementById('modalMeta').innerHTML = `Finns på SVT Play • ${durationStr}`;
    } else {
        const dateStrModal = new Date(m.startTime).toLocaleString('sv-SE', {weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
        document.getElementById('modalMeta').innerHTML = `${m.channel} • Sändes ${dateStrModal} • ${durationStr}`;
    }

    document.getElementById('modalImdb').href = m.imdbUrl || '#';
    document.getElementById('modalImdb').style.display = m.imdbUrl ? 'inline-block' : 'none';

    document.getElementById('movieModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    history.pushState({ modalOpen: true }, "");
}

function closeModal(event, fromPopState = false) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('movieModal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        if (!fromPopState) history.back();
    }
}

window.addEventListener('popstate', () => { closeModal(null, true); });