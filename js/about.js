import { el } from './ui.js';

export function openAbout() {
    const link = (text, href) => el('a', { href, target: '_blank', rel: 'noopener', text });
    const box = el('div', { class: 'box glass' },
        el('h2', { text: 'About HarmonyHike' }),
        el('p', {}, 'Set hikers loose in your favorite places. Each makes notes and shapes based on how and where they hike. Enjoy the fresh air standalone, or send your MIDI instruments into the wild. This is the web version of the HarmonyHike desktop app.'),
        el('div', { class: 'credits' },
            el('h3', { text: 'MAP AND TERRAIN DATA' }),
            el('p', {}, link('OpenStreetMap', 'https://www.openstreetmap.org/copyright'), ' contributors (land cover, read from map tiles; ODbL). Place names by ', link('Nominatim', 'https://nominatim.org/'), '.'),
            el('p', {}, 'Elevation from the ', link('AWS Terrain Tiles', 'https://registry.opendata.aws/terrain-tiles/'), ' (NASADEM/SRTM, USGS 3DEP and others; see the ', link('attribution page', 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'), ').'),
            el('p', {}, 'Weather data by ', link('Open-Meteo.com', 'https://open-meteo.com/'), ' (CC BY 4.0).'),
            el('h3', { text: 'CHARACTERS AND ANIMALS' }),
            el('p', {}, 'The animals are low-poly models by ', link('Quaternius', 'https://quaternius.com/'), ' (CC0): ', link('Farm Animals', 'https://opengameart.org/content/lowpoly-animated-farm-animal-pack'), ', ',
                link('Animal Pack Vol. 2', 'https://opengameart.org/content/animated-animales-low-poly'), ', ', link('5 Low Poly Animals', 'https://opengameart.org/content/5-low-poly-animals'), ' and the deer from ',
                link('Ultimate Animated Animals', 'https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS'), '. The hikers are original to HarmonyHike.'),
            el('h3', { text: 'SKIES' }),
            el('p', {}, 'CC0 sky panoramas from ', link('Poly Haven', 'https://polyhaven.com/'), ': Belfast Sunset, Farm Field, Kloofendal 48d Partly Cloudy, Kloofendal Overcast, Kloppenheim 05, Qwantani Dusk 2, Sunflowers and Wasteland Clouds (by Greg Zaal, Jarod Guest, Sergej Majboroda, Dimitrios Savva).'),
            el('h3', { text: 'SOUND' }),
            el('p', {}, 'All sounds are synthesized live in your browser; there are no recorded samples.')),
        el('p', {}, el('button', { text: 'Close', onclick: () => root.remove() })));
    const root = el('div', { class: 'dialog', onclick: e => { if (e.target === root) root.remove(); } }, box);
    document.getElementById('dialog-root').append(root);
}
