// Places to start in: real, named, with a good spread of heights and water in sight. Picked at random the first time HarmonyHike runs
// (and by the Surprise me button), so the location box shows a name to enjoy rather than coordinates.
export const PLACES = [
    ['Yosemite Valley, California', 37.7456, -119.5734],
    ['Big Sur coast, California', 36.3635, -121.9018],
    ['Emerald Bay, Lake Tahoe', 38.938, -120.1002],
    ['Moraine Lake, Banff', 51.3217, -116.186],
    ['Na Pali Coast, Kauai', 22.1717, -159.6526],
    ['Milford Sound, New Zealand', -44.6494, 167.9199],
    ['Torres del Paine, Chile', -50.974, -73.1954],
    ['Lake Como, Italy', 45.9706, 9.2622],
    ['Positano, Amalfi Coast', 40.628, 14.4955],
    ['Vernazza, Cinque Terre', 44.127, 9.7063],
    ['Hallstatt, Austria', 47.5462, 13.673],
    ['Geirangerfjord, Norway', 62.1049, 7.2058],
    ['Flam, Norway', 60.871, 7.114],
    ['Reine, Lofoten', 67.932, 13.0677],
    ['Isle of Skye, Scotland', 57.397, -6.2049],
    ['Bay of Kotor, Montenegro', 42.4327, 18.7712],
    ['Sugarloaf, Rio de Janeiro', -22.949, -43.157],
    ['Victoria Peak, Hong Kong', 22.2679, 114.1282],
    ['Lake Kawaguchi, Japan', 35.508, 138.7738],
    ['Crater Lake, Oregon', 42.972, -122.1341],
    ['Lake Louise, Alberta', 51.4094, -116.2305],
    ['Lake Atitlan, Guatemala', 14.675, -91.2495],
    ['Lake Lucerne, Switzerland', 46.992, 8.4233],
];
export const randomPlace = (not) => { let p; do { p = PLACES[Math.floor(Math.random() * PLACES.length)]; } while (PLACES.length > 1 && p[0] === not); return { location: p[0], lat: p[1], lon: p[2] }; };
