// Static game data: species, buildings, fences, research, dig sites, diseases, missions.

export const DAY_SECONDS = 150;   // real seconds per in-game day at 1x speed
export const MAP_SIZE = 96;
export const PARTY = 1;         // each walking visitor figure is one paying guest
export const WORLD_SCALE = 0.4;  // metres -> world units for dinosaur models (1 tile ≈ 2.5 m)

export const SIZE_RANK = { S: 1, M: 2, L: 3, XL: 4 };

// ---------- Dinosaur body-plan presets (all measurements in metres) ----------
function theropod(L, o = {}) {
  return Object.assign({
    plan: 'biped', hipH: 0.26 * L, pitch: 0.06, bodyL: 0.32 * L, bodyR: 0.085 * L, bodyH: 0.1 * L,
    neckL: 0.1 * L, neckR: 0.045 * L, neckAng: 0.5, headL: 0.13 * L, headH: 0.065 * L, headW: 0.055 * L,
    tailL: 0.45 * L, tailR: 0.06 * L, tailAng: 0.05, legR: 0.04 * L, armL: 0.07 * L, frontR: 1, teeth: true,
  }, o);
}
function ornithomimid(L, o = {}) {
  return theropod(L, Object.assign({
    hipH: 0.3 * L, bodyL: 0.26 * L, bodyR: 0.07 * L, bodyH: 0.08 * L, neckL: 0.2 * L, neckR: 0.025 * L,
    neckAng: 1.0, headL: 0.07 * L, headH: 0.035 * L, headW: 0.03 * L, tailL: 0.42 * L, tailR: 0.04 * L,
    legR: 0.03 * L, armL: 0.09 * L, teeth: false,
  }, o));
}
function hadrosaur(L, o = {}) {
  return Object.assign({
    plan: 'quad', hipH: 0.24 * L, pitch: -0.06, bodyL: 0.35 * L, bodyR: 0.09 * L, bodyH: 0.11 * L,
    neckL: 0.12 * L, neckR: 0.04 * L, neckAng: 0.75, headL: 0.11 * L, headH: 0.045 * L, headW: 0.04 * L,
    tailL: 0.42 * L, tailR: 0.06 * L, tailAng: 0.04, legR: 0.04 * L, frontR: 0.6, armL: 0,
  }, o);
}
function ceratopsian(L, o = {}) {
  return Object.assign({
    plan: 'quad', hipH: 0.2 * L, pitch: -0.04, bodyL: 0.4 * L, bodyR: 0.14 * L, bodyH: 0.13 * L,
    neckL: 0.05 * L, neckR: 0.07 * L, neckAng: 0.05, headL: 0.24 * L, headH: 0.11 * L, headW: 0.1 * L,
    tailL: 0.3 * L, tailR: 0.06 * L, tailAng: 0.12, legR: 0.06 * L, frontR: 0.9, armL: 0,
  }, o);
}
function stegosaur(L, o = {}) {
  return Object.assign({
    plan: 'quad', hipH: 0.25 * L, pitch: -0.22, bodyL: 0.38 * L, bodyR: 0.1 * L, bodyH: 0.13 * L,
    neckL: 0.11 * L, neckR: 0.035 * L, neckAng: 0.05, headL: 0.08 * L, headH: 0.035 * L, headW: 0.035 * L,
    tailL: 0.42 * L, tailR: 0.06 * L, tailAng: -0.1, legR: 0.05 * L, frontR: 0.75, armL: 0,
  }, o);
}
function ankylosaur(L, o = {}) {
  return Object.assign({
    plan: 'quad', hipH: 0.15 * L, pitch: -0.02, bodyL: 0.42 * L, bodyR: 0.17 * L, bodyH: 0.1 * L,
    neckL: 0.05 * L, neckR: 0.06 * L, neckAng: 0.0, headL: 0.1 * L, headH: 0.06 * L, headW: 0.09 * L,
    tailL: 0.38 * L, tailR: 0.06 * L, tailAng: 0.0, legR: 0.055 * L, frontR: 0.9, armL: 0,
  }, o);
}
function sauropod(L, o = {}) {
  return Object.assign({
    plan: 'quad', hipH: 0.17 * L, pitch: 0.12, bodyL: 0.28 * L, bodyR: 0.1 * L, bodyH: 0.1 * L,
    neckL: 0.36 * L, neckR: 0.035 * L, neckAng: 0.6, headL: 0.065 * L, headH: 0.034 * L, headW: 0.03 * L,
    tailL: 0.36 * L, tailR: 0.05 * L, tailAng: 0.08, legR: 0.04 * L, frontR: 1, armL: 0,
  }, o);
}
function pachy(L, o = {}) {
  return theropod(L, Object.assign({
    hipH: 0.28 * L, bodyL: 0.34 * L, bodyR: 0.11 * L, bodyH: 0.12 * L, neckL: 0.09 * L, neckAng: 0.4,
    headL: 0.15 * L, headH: 0.12 * L, headW: 0.1 * L, tailL: 0.4 * L, armL: 0.06 * L, teeth: false,
  }, o));
}

// ---------- Species ----------
// diet, size, cost, incubate (days), life (days), stars (park rating, 1-5), fence tier needed (1 low, 2 medium, 3 high),
// aggr (0-1), atk, def, hp, spd (walk tiles/s), run, herd [min,max], forest (preferred tree cover), space (tiles each)
const STAR_VALUE = [0, 3, 6, 10, 16, 24];
const FENCE_STR = [0, 2, 3, 5];
const S = (id, name, diet, size, cost, incubate, life, stars, fence, aggr, atk, def, hp, spd, run, herd, forest, space, col, col2, model, extra = {}) =>
  Object.assign({ id, name, diet, size, cost, incubate, life, stars, value: STAR_VALUE[stars], fence, str: FENCE_STR[fence], aggr, atk, def, hp, spd, run, herd, forest, space, col, col2, model }, extra);

export const SPECIES = [
  S('dryosaurus', 'Dryosaurus', 'herb', 'S', 1200, 0.4, 70, 1, 1, 0.05, 2, 3, 60, 0.9, 2.6, [3, 10], 0.45, 14, 0x6e7a3a, 0xcfc79a,
    ornithomimid(3.5, { neckL: 0.12 * 3.5, neckAng: 0.7, headL: 0.1 * 3.5, headH: 0.05 * 3.5 }), { stripes: true, period: 'Late Jurassic', blurb: 'A swift little ornithopod that lives in nervous, chattering herds.' }),
  S('gallimimus', 'Gallimimus', 'herb', 'S', 2000, 0.5, 75, 3, 1, 0.05, 2, 3, 70, 1.0, 3.0, [4, 14], 0.2, 16, 0x9a6a32, 0xe8d6a8,
    ornithomimid(6), { stripes: true, period: 'Late Cretaceous', blurb: 'The "chicken mimic". Flocks stampede across open plains at astonishing speed.' }),
  S('homalocephale', 'Homalocephale', 'herb', 'S', 1800, 0.5, 70, 3, 1, 0.2, 4, 5, 70, 0.8, 2.2, [2, 8], 0.35, 14, 0x7a5a3e, 0xd8c49c,
    pachy(3, { headH: 0.09 * 3 }), { flatDome: true, period: 'Late Cretaceous', blurb: 'A flat-headed cousin of Pachycephalosaurus, fond of thick undergrowth.' }),
  S('pachycephalosaurus', 'Pachycephalosaurus', 'herb', 'M', 2500, 0.7, 80, 2, 1, 0.35, 8, 8, 110, 0.8, 2.2, [2, 8], 0.4, 20, 0x5e6c84, 0xd6cebe,
    pachy(4.5), { dome: true, territorial: true, period: 'Late Cretaceous', blurb: 'Thick-skulled head-butter. Rivals settle disputes with dominance displays.' }),
  S('edmontosaurus', 'Edmontosaurus', 'herb', 'L', 4000, 1.0, 95, 3, 1, 0.1, 6, 10, 260, 0.7, 1.8, [4, 14], 0.35, 40, 0x6a7a48, 0xd8d0a8,
    hadrosaur(11), { period: 'Late Cretaceous', blurb: 'A big, placid duck-billed grazer that thrives in large herds.' }),
  S('corythosaurus', 'Corythosaurus', 'herb', 'L', 4500, 1.0, 95, 3, 1, 0.1, 6, 10, 240, 0.7, 1.8, [3, 12], 0.5, 38, 0x3f6a5a, 0xdcd4b4,
    hadrosaur(9), { crest: 'helmet', stripes: true, period: 'Late Cretaceous', blurb: 'Its hollow helmet crest produces deep, booming calls.' }),
  S('parasaurolophus', 'Parasaurolophus', 'herb', 'L', 5000, 1.1, 100, 3, 1, 0.1, 6, 10, 250, 0.75, 1.9, [3, 12], 0.45, 38, 0x9a5e30, 0xe8d4aa,
    hadrosaur(9.5), { crest: 'tube', stripes: true, period: 'Late Cretaceous', blurb: 'Famous for its long tube crest and trombone-like honks.' }),
  S('ouranosaurus', 'Ouranosaurus', 'herb', 'L', 4200, 1.0, 95, 2, 1, 0.15, 7, 9, 220, 0.7, 1.7, [2, 8], 0.2, 34, 0xa07434, 0xe6d2a6,
    hadrosaur(8, { neckAng: 0.55 }), { sail: 0.18, period: 'Early Cretaceous', blurb: 'A sail-backed iguanodont from the ancient Sahara.' }),
  S('kentrosaurus', 'Kentrosaurus', 'herb', 'M', 3500, 0.9, 90, 2, 1, 0.4, 14, 16, 180, 0.55, 1.3, [2, 8], 0.4, 24, 0x6e6a32, 0xd2c696,
    stegosaur(5), { plates: 'kentro', tailSpikes: true, period: 'Late Jurassic', blurb: 'A spiky African stegosaur. Gives predators a very bad day.' }),
  S('stegosaurus', 'Stegosaurus', 'herb', 'L', 9000, 1.4, 110, 4, 1, 0.35, 20, 22, 360, 0.5, 1.2, [2, 8], 0.4, 48, 0x5a6a42, 0xcfc8a0,
    stegosaur(9), { plates: 'stego', tailSpikes: true, plateCol: 0xa04e30, period: 'Late Jurassic', blurb: 'Iconic plated giant with a spiked tail – the thagomizer.' }),
  S('ankylosaurus', 'Ankylosaurus', 'herb', 'L', 9500, 1.4, 110, 4, 1, 0.35, 22, 30, 400, 0.45, 1.1, [1, 6], 0.35, 44, 0x6a5a40, 0xbcae90,
    ankylosaur(8), { armor: true, club: true, period: 'Late Cretaceous', blurb: 'A living tank. Its tail club can shatter bone.' }),
  S('styracosaurus', 'Styracosaurus', 'herb', 'L', 4000, 1.2, 100, 2, 1, 0.45, 22, 20, 340, 0.6, 1.7, [3, 10], 0.2, 40, 0x8a5236, 0xdcc4a0,
    ceratopsian(5.5), { horns: 'styraco', frill: 'spiky', period: 'Late Cretaceous', blurb: 'Crowned with a spectacular spiked frill.' }),
  S('torosaurus', 'Torosaurus', 'herb', 'L', 4500, 1.4, 110, 2, 1, 0.45, 24, 22, 380, 0.6, 1.6, [2, 8], 0.2, 46, 0x5e6a4a, 0xd6ceaa,
    ceratopsian(8, { headL: 0.28 * 8 }), { horns: 'trike', frill: 'huge', territorial: true, period: 'Late Cretaceous', blurb: 'Owner of one of the largest skulls of any land animal.' }),
  S('triceratops', 'Triceratops', 'herb', 'L', 15000, 1.5, 120, 5, 2, 0.5, 26, 24, 420, 0.6, 1.7, [2, 8], 0.25, 48, 0x6a6252, 0xcfc4ac,
    ceratopsian(9), { horns: 'trike', frill: 'round', frillCol: 0x9a6034, period: 'Late Cretaceous', blurb: 'Three horns, one frill, zero patience for predators.' }),
  S('camarasaurus', 'Camarasaurus', 'herb', 'XL', 9000, 2.0, 140, 3, 1, 0.1, 25, 30, 700, 0.5, 1.0, [2, 8], 0.5, 80, 0x6e5e44, 0xb4a488,
    sauropod(16, { neckAng: 0.45, pitch: 0.05, neckL: 0.3 * 16 }), { period: 'Late Jurassic', blurb: 'The most common sauropod of the Jurassic. Gentle but enormous.' }),
  S('brachiosaurus', 'Brachiosaurus', 'herb', 'XL', 20000, 2.4, 160, 5, 1, 0.05, 28, 34, 900, 0.5, 1.0, [2, 6], 0.6, 100, 0x56664a, 0xa8a88a,
    sauropod(22, { pitch: 0.3, neckAng: 0.8 }), { period: 'Late Jurassic', blurb: 'Towering high-browser. Guests never forget their first sight of one.' }),
  // Carnivores
  S('dilophosaurus', 'Dilophosaurus', 'carn', 'M', 6000, 0.9, 80, 2, 2, 0.6, 18, 8, 140, 0.8, 2.6, [1, 5], 0.55, 30, 0x7a8a34, 0xeee6ae,
    theropod(6, { neckL: 0.12 * 6, neckAng: 0.6, headL: 0.11 * 6, headH: 0.05 * 6, armL: 0.08 * 6, bodyR: 0.065 * 6 }), { crest: 'double', stripes: true, period: 'Early Jurassic', blurb: 'Twin-crested hunter. Prefers dense forest to stalk from.' }),
  S('velociraptor', 'Velociraptor', 'carn', 'M', 18000, 1.0, 85, 5, 2, 0.9, 22, 10, 130, 1.0, 3.4, [3, 6], 0.5, 30, 0x8a7048, 0xe2d4b6,
    theropod(4, { hipH: 0.24 * 4, armL: 0.12 * 4, headL: 0.14 * 4, headH: 0.055 * 4, bodyR: 0.07 * 4, tailR: 0.04 * 4 }), { stripes: true, pack: true, period: 'Late Cretaceous', blurb: 'Clever pack hunters. They test the fences for weaknesses. High fences recommended.' }),
  S('ceratosaurus', 'Ceratosaurus', 'carn', 'L', 7000, 1.2, 100, 2, 2, 0.7, 30, 16, 330, 0.7, 2.2, [1, 2], 0.4, 60, 0x7a4a32, 0xdcc49c,
    theropod(6.5), { horns: 'nasal', ridge: 0.04, stripes: true, period: 'Late Jurassic', blurb: 'A horned Jurassic hunter with a row of bony osteoderms.' }),
  S('albertosaurus', 'Albertosaurus', 'carn', 'L', 9000, 1.4, 105, 3, 2, 0.7, 36, 18, 420, 0.75, 2.4, [1, 3], 0.35, 70, 0x5a4232, 0xc8b496,
    theropod(9, { armL: 0.04 * 9 }), { stripes: true, period: 'Late Cretaceous', blurb: 'A lighter, faster relative of Tyrannosaurus that may hunt in groups.' }),
  S('allosaurus', 'Allosaurus', 'carn', 'L', 16000, 1.4, 105, 4, 2, 0.75, 38, 18, 440, 0.75, 2.4, [1, 3], 0.4, 72, 0x8a6a42, 0xdcc8a0,
    theropod(8.5, { armL: 0.09 * 8.5, headL: 0.13 * 8.5 }), { horns: 'allo', stripes: true, period: 'Late Jurassic', blurb: 'The apex predator of the Jurassic, with distinctive horns over its eyes.' }),
  S('acrocanthosaurus', 'Acrocanthosaurus', 'carn', 'XL', 20000, 1.6, 115, 4, 3, 0.75, 42, 22, 560, 0.7, 2.2, [1, 2], 0.35, 90, 0x4e5a66, 0xcac6ba,
    theropod(11.5), { sail: 0.07, period: 'Early Cretaceous', blurb: 'A huge predator with a tall ridge of spines along its back.' }),
  S('carcharodontosaurus', 'Carcharodontosaurus', 'carn', 'XL', 22000, 1.7, 120, 4, 3, 0.8, 50, 24, 680, 0.7, 2.1, [1, 2], 0.3, 110, 0x6a5a48, 0xd2c4a8,
    theropod(13, { headL: 0.15 * 13, headH: 0.07 * 13, armL: 0.04 * 13 }), { stripes: true, period: 'Late Cretaceous', blurb: '"Shark-toothed lizard" – a giant African predator to rival Tyrannosaurus.' }),
  S('spinosaurus', 'Spinosaurus', 'carn', 'XL', 30000, 1.9, 125, 5, 3, 0.8, 48, 26, 700, 0.65, 2.0, [1, 1], 0.3, 110, 0x4e5e4e, 0xd0c8b0,
    theropod(15, { headL: 0.12 * 15, headH: 0.045 * 15, headW: 0.04 * 15, neckL: 0.11 * 15, armL: 0.08 * 15 }), { sail: 0.13, sailCol: 0x9a4430, period: 'Late Cretaceous', blurb: 'A truly frightening predator from Cretaceous Africa. Solitary and dangerous.' }),
  S('tyrannosaurus', 'Tyrannosaurus', 'carn', 'XL', 35000, 2.0, 130, 5, 3, 0.85, 55, 28, 760, 0.7, 2.2, [1, 1], 0.25, 120, 0x4e4232, 0xb8a888,
    theropod(12.5, { armL: 0.03 * 12.5, headL: 0.14 * 12.5, headH: 0.075 * 12.5, headW: 0.065 * 12.5, bodyR: 0.095 * 12.5 }), { period: 'Late Cretaceous', blurb: 'The tyrant lizard king. The star of any park – if you can hold it.' }),
];
// Tuning from the original game's data (see docs/og-reference.md): popularity stars, security tier, era, rarity.
// security: 1 low, 2 medium, 3 high, 4 extreme (needs a High fence and can still break it when stressed).
const OG = {
  acrocanthosaurus: [4, 4, 'Early Cretaceous', 'uncommon'], albertosaurus: [3, 1, 'Late Cretaceous', 'common'],
  allosaurus: [4, 3, 'Late Jurassic', 'common'], ankylosaurus: [4, 1, 'Late Cretaceous', 'uncommon'],
  brachiosaurus: [5, 1, 'Late Jurassic', 'uncommon'], carcharodontosaurus: [4, 3, 'Early Cretaceous', 'rare'],
  camarasaurus: [3, 1, 'Late Jurassic', 'common'], ceratosaurus: [2, 3, 'Late Jurassic', 'uncommon'],
  corythosaurus: [3, 1, 'Late Cretaceous', 'common'], dilophosaurus: [2, 2, 'Early Jurassic', 'uncommon'],
  dryosaurus: [1, 1, 'Late Jurassic', 'common'], edmontosaurus: [3, 1, 'Late Cretaceous', 'uncommon'],
  gallimimus: [3, 1, 'Late Cretaceous', 'uncommon'], homalocephale: [3, 1, 'Late Cretaceous', 'rare'],
  kentrosaurus: [2, 1, 'Late Jurassic', 'uncommon'], ouranosaurus: [2, 1, 'Early Cretaceous', 'rare'],
  pachycephalosaurus: [2, 1, 'Late Cretaceous', 'uncommon'], parasaurolophus: [3, 1, 'Late Cretaceous', 'uncommon'],
  spinosaurus: [5, 4, 'Early Cretaceous', 'rare'], stegosaurus: [4, 1, 'Late Jurassic', 'common'],
  styracosaurus: [2, 1, 'Late Cretaceous', 'uncommon'], torosaurus: [2, 1, 'Late Cretaceous', 'common'],
  triceratops: [5, 3, 'Late Cretaceous', 'common'], tyrannosaurus: [5, 4, 'Late Cretaceous', 'common'],
  velociraptor: [5, 3, 'Late Cretaceous', 'uncommon'],
};
const SECURITY = ['', 'Low', 'Medium', 'High', 'Extreme'];
// Health, lifespan at a full genome (months), largest herd, and bite strength. Health, lifespan and herd sizes are
// from the JP-Genesis Archives species pages; bite strength is set so that, as the wiki describes, a large
// carnivore kills most animals in two or three bites, Ankylosaurus survives more than three, and so on.
const ARCH = {
  dryosaurus: [100, 66, 15, 10], gallimimus: [160, 60, 20, 10], homalocephale: [150, 51, 15, 12], kentrosaurus: [450, 45, 15, 120],
  pachycephalosaurus: [400, 48, 15, 80], styracosaurus: [300, 42, 15, 120], ouranosaurus: [500, 40, 8, 20], edmontosaurus: [500, 78, 7, 20],
  corythosaurus: [500, 54, 10, 20], parasaurolophus: [500, 60, 12, 20], camarasaurus: [600, 60, 6, 0], brachiosaurus: [1000, 68, 5, 0],
  stegosaurus: [550, 54, 15, 350], ankylosaurus: [1600, 60, 8, 480], torosaurus: [450, 70, 15, 220], triceratops: [750, 54, 15, 320],
  dilophosaurus: [500, 66, 4, 40], velociraptor: [200, 45, 5, 45], ceratosaurus: [300, 48, 3, 90], albertosaurus: [725, 48, 2, 160],
  allosaurus: [700, 66, 3, 220], acrocanthosaurus: [700, 66, 4, 300], carcharodontosaurus: [700, 66, 3, 420], spinosaurus: [850, 54, 1, 380],
  tyrannosaurus: [800, 57, 2, 360],
};
// Species that need company (the wiki: sauropods are stressed when alone, raptors are pack hunters, Stegosaurus is a herd animal).
const HERD_MIN = { brachiosaurus: 2, camarasaurus: 2, velociraptor: 2, stegosaurus: 2 };
// The original's four hatchery classes. They set the base cost and incubation time.
const SMALL = new Set(['dryosaurus', 'gallimimus', 'homalocephale', 'kentrosaurus', 'pachycephalosaurus', 'styracosaurus',
  'dilophosaurus', 'ceratosaurus', 'albertosaurus', 'velociraptor']);
for (const sp of SPECIES) {
  const [stars, sec, era, rarity] = OG[sp.id];
  const large = !SMALL.has(sp.id);
  sp.cat = (large ? 'L' : 'S') + (sp.diet === 'carn' ? 'C' : 'H');
  sp.stars = stars; sp.value = STAR_VALUE[stars];
  sp.security = SECURITY[sec];
  sp.fence = Math.min(3, sec);
  sp.str = [0, 2, 3, 5, 6][sec];
  sp.period = era; sp.era = era.includes('Jurassic') ? 'Jurassic' : 'Cretaceous';
  sp.rarity = rarity;
  // Cloning cost as shown in the final game (JP-Genesis Archives): it follows the star rating only.
  sp.cost = (stars >= 4 ? 1995 : 990) + 750 * stars;
  sp.incubate = large ? 0.27 : 0.2;          // 40 s / 30 s at 1x
  const [hp, months, herdMax, atk] = ARCH[sp.id];
  sp.hp = hp; sp.atk = atk;
  sp.life = months * 2;                       // full lifespan in days at 100% DNA (1 month = 2 days)
  sp.herd = [HERD_MIN[sp.id] || 1, herdMax];
}
// Friend species (herbivores) and favourite prey (carnivores), as listed in the original's Dinopedia.
const FRIEND = {
  ankylosaurus: 'ankylosaurus', brachiosaurus: 'camarasaurus', camarasaurus: 'brachiosaurus', corythosaurus: 'edmontosaurus',
  dryosaurus: 'dryosaurus', edmontosaurus: 'parasaurolophus', gallimimus: 'gallimimus', homalocephale: 'pachycephalosaurus',
  kentrosaurus: 'stegosaurus', ouranosaurus: 'edmontosaurus', pachycephalosaurus: 'homalocephale', parasaurolophus: 'edmontosaurus',
  stegosaurus: 'kentrosaurus', styracosaurus: 'torosaurus', torosaurus: 'triceratops', triceratops: 'torosaurus',
};
const PREY = {
  acrocanthosaurus: 'parasaurolophus', albertosaurus: 'parasaurolophus', allosaurus: 'stegosaurus', carcharodontosaurus: 'ouranosaurus',
  ceratosaurus: 'dryosaurus', dilophosaurus: 'dryosaurus', spinosaurus: 'ouranosaurus', tyrannosaurus: 'edmontosaurus', velociraptor: 'goat',
};
for (const sp of SPECIES) { sp.friend = FRIEND[sp.id] || null; sp.prey = PREY[sp.id] || null; }
// Length in metres as listed in the original's Dinopedia, and short notes on how each species behaves in the game.
const LENGTH_M = { acrocanthosaurus: 13, albertosaurus: 8, allosaurus: 11, ankylosaurus: 7, brachiosaurus: 25, camarasaurus: 19, carcharodontosaurus: 14, ceratosaurus: 6,
  corythosaurus: 9, dilophosaurus: 7, dryosaurus: 3, edmontosaurus: 13, gallimimus: 6, homalocephale: 3, kentrosaurus: 4, ouranosaurus: 7, pachycephalosaurus: 8,
  parasaurolophus: 10, spinosaurus: 15, stegosaurus: 9, styracosaurus: 5, torosaurus: 8, triceratops: 9, tyrannosaurus: 13, velociraptor: 3 };
const NOTES = {
  brachiosaurus: 'Too big for any carnivore to hunt. Rears up to frighten predators away. Eats only from trees, never from feeders.',
  camarasaurus: 'A social giant that gets stressed when alone. Eats only from trees. Cannot fight back: even raptors can bring it down.',
  kentrosaurus: 'Nervous around large herbivores, Brachiosaurus most of all. Lashes out with its tail spikes.',
  stegosaurus: 'Swings its spiked tail at any carnivore, and sometimes at its neighbours. Can fight a death duel with Tyrannosaurus.',
  ankylosaurus: 'One of the toughest animals in the park. Its club can fell large carnivores. Can fight a death duel with Tyrannosaurus.',
  triceratops: 'The only herbivore that needs a Medium fence, and the only one that rampages. Charges vehicles. Can fight a death duel with Tyrannosaurus.',
  torosaurus: 'Herd males butt heads to decide who leads. Defends itself against small carnivores.',
  pachycephalosaurus: 'Herd members butt heads until one gives way; the winner leads the herd. Attacks small carnivores.',
  styracosaurus: 'Runs rings around small carnivores and gores them with its nose horn.',
  gallimimus: 'The fastest animal in the park. Scatters at the first sign of danger. The only herbivore that can catch rabies.',
  dryosaurus: 'Lives in large, restless herds. Defenceless.',
  homalocephale: 'Hides behind larger herbivores for protection.',
  parasaurolophus: 'A favourite prey of Acrocanthosaurus and Albertosaurus.', corythosaurus: 'Playful and sociable; Fun Lovers adore it.',
  edmontosaurus: 'Herds for safety. Tyrannosaurus\'s favourite prey.', ouranosaurus: 'Gets on with other hadrosaurs. Prey for every Chenini carnivore.',
  dilophosaurus: 'Kills small prey with venom. Collapses into a coma instead of rampaging when stressed.',
  ceratosaurus: 'A scavenger as much as a hunter. Collapses into a coma instead of rampaging when stressed.',
  albertosaurus: 'Prefers to hunt in pairs. Rarely tries to break out; goes comatose when stressed.',
  velociraptor: 'Pack hunter that tests Low and Medium fences for a weak point to climb. Never tries High fences. The only small carnivore that rampages.',
  allosaurus: 'The weakest large carnivore; other large carnivores treat it as prey. Will not break a High fence.',
  acrocanthosaurus: 'Shares an enclosure peacefully with Carcharodontosaurus. Will not break a High fence.',
  carcharodontosaurus: 'One of the strongest biters in the park. Can break a High fence when rampaging.',
  spinosaurus: 'The largest carnivore. Rarely backs down from a fight and can break a High fence. Fights death duels with Tyrannosaurus.',
  tyrannosaurus: 'Feared by almost everything. Fights death duels with Spinosaurus, Triceratops, Ankylosaurus and Stegosaurus, and can break a High fence.',
};
for (const sp of SPECIES) { sp.lengthM = LENGTH_M[sp.id]; sp.notes = NOTES[sp.id] || ''; }

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// ---------- Fences: three tiers of electric fence ----------
export const FENCES = [
  null,
  { id: 1, name: 'Low Security Fence', armor: 2, cost: 100, hp: 120, h: 1.0, research: null, desc: 'These fences are used to make enclosures for your dinosaurs. Holds most herbivores.' },
  { id: 2, name: 'Medium Security Fence', armor: 3, cost: 250, hp: 170, h: 1.35, research: 'fence_med', desc: 'Taller posts and heavier wire. Needed for small carnivores and Triceratops.' },
  { id: 3, name: 'High Security Fence', armor: 5, cost: 500, hp: 260, h: 1.8, research: 'fence_high', desc: 'Concrete wall and high-voltage wire. The only fence for large carnivores.' },
];

// ---------- Buildings ----------
// fn: what it does. need: visitor need satisfied. path: needs path access. view: viewing radius.
const B = (id, name, cat, icon, size, cost, upkeep, fn, extra = {}) => Object.assign({ id, name, cat, icon, size, cost, upkeep, fn, path: true }, extra);
export const BUILDINGS = [
  B('entrance', 'Park Entrance', 'amenity', '', [5, 5], 5000, 40, 'entrance', { model: [5, 3], limit: 10, health: 5000, desc: 'Where guests arrive by helicopter and leave again. You need at least one to open the park. The helipad stands behind it.' }),
  // the gate and visitor centre of earlier versions (kept for old saves)
  B('gate', 'Park Gate', 'special', '', [3, 2], 0, 30, 'entrance', { legacy: true, fixed: true }),
  B('visitor_center', 'Visitor Center', 'special', '', [4, 3], 0, 40, 'shop', { legacy: true, fixed: true, need: 'shop', price: 6, stay: 6 }),
  // Paths (path add-ons sit beside a footpath)
  B('bin', 'Trash Can', 'paths', '', [1, 1], 100, 1, 'bin', { path: false, pathside: true, desc: 'Guests drop less litter near a trash can. Place it beside a footpath.' }),
  B('bench', 'Bench', 'paths', '', [1, 1], 75, 1, 'bench', { path: false, pathside: true, desc: 'Tired guests sit down and rest here. Place it beside a footpath.' }),
  B('fountain', 'Fountain', 'paths', '', [1, 1], 1500, 5, 'deco', { path: false, pathside: true, joy: 6, research: 'fountain', limit: 10, desc: 'A calming water feature that soothes guests nearby.' }),
  // Cleaner Station
  B('cleaner', 'Cleaner Station', 'cleaner', '', [2, 2], 3000, 20, 'cleaner', { limit: 10, health: 2000, desc: 'Hire cleaners who sweep litter off your footpaths. Click it to hire or fire them.' }),
  // Amenities
  B('snack', 'Kiosk', 'amenity', '', [2, 2], 2000, 15, 'shop', { limit: 10, health: 1000, need: 'hunger', also: 'thirst', price: 20, max: 50, stay: 4, desc: 'Sells a meal, a side order and a drink. You choose the menu and the price.' }),
  B('restroom', 'Rest Rooms', 'amenity', '', [2, 2], 1500, 10, 'shop', { limit: 10, health: 1000, need: 'bladder', price: 2, max: 10, stay: 3, desc: 'Visitors need these. You can charge a small fee to use them.' }),
  B('giftshop', 'Souvenir Stand', 'amenity', '', [2, 2], 2000, 15, 'shop', { limit: 10, health: 100, need: 'shop', price: 25, max: 50, stay: 4, research: 'souvenir', desc: 'Sells souvenirs, with an optional free gift.' }),
  B('bungalow', 'Rest Area', 'amenity', '', [3, 3], 1500, 10, 'shop', { inside: 8, model: [2, 2], limit: 10, health: 1500, need: 'energy', price: 3, max: 20, stay: 14, capacity: 8, research: 'restarea', desc: 'A shady courtyard with gazebos and vending machines where tired guests recover.' }),
  // Attractions (admission is set by the player)
  B('vent', 'Viewing Vent', 'attraction', '', [2, 2], 1500, 5, 'view', { inside: 16, model: [1, 1], limit: 20, health: 2000, view: 7, stay: 6, price: 5, max: 50, onFence: true, desc: 'A viewing gallery built into an enclosure fence. Place it on a fence.' }),
  B('platform', 'Viewing Platform', 'attraction', '', [2, 2], 3000, 10, 'view', { inside: 5, limit: 20, health: 2000, view: 11, stay: 8, price: 8, max: 50, desc: 'A tall lookout with views in every direction. Place it between enclosures.' }),
  B('dome', 'Viewing Dome', 'attraction', '', [1, 1], 5000, 25, 'view', { inside: 16, limit: 20, health: 1000, view: 15, stay: 12, fun: 1.6, price: 15, max: 50, research: 'dome', desc: 'An armoured glass dome with 360° views. Place its access door beside a path, then place the dome itself inside an enclosure; a tunnel joins them.' }),
  // the glass dome half of a Viewing Dome, placed inside an enclosure (not in the build menu)
  B('dome_pod', 'Viewing Dome', 'attraction', '', [3, 3], 0, 0, 'pod', { model: [2, 2], health: 2000, path: false, legacy: true }),
  B('balloon', 'Balloon Tour', 'attraction', '', [3, 3], 4000, 40, 'balloon', { limit: 5, health: 2000, price: 50, max: 200, research: 'balloon', desc: 'A hot-air balloon gives guests a bird\'s-eye tour of the park along a route of poles you place. Grounded in storms.' }),
  B('balloon_pole', 'Balloon Route Pole', 'attraction', '', [1, 1], 100, 0, 'pole', { path: false, legacy: true, research: 'balloon', limit: 40, desc: 'Marks the Balloon Tour route. The balloon flies from pole to pole in the order you place them. Poles can stand inside enclosures.' }),
  B('safari', 'Safari Adventure', 'attraction', '', [2, 4], 4000, 40, 'safari', { model: [3, 2], limit: 5, health: 2000, onFence: true, price: 40, max: 200, research: 'safari', desc: 'Land Cruisers drive guests along a track through your enclosures. Keep large carnivores off the route.' }),
  // Enclosures
  B('hatchery', 'Hatchery', 'enclosure', '', [3, 5], 6000, 50, 'hatchery', { model: [3, 3], limit: 8, health: 3000, path: false, slots: 5, desc: 'Clones up to five dinosaurs in a batch and releases them one at a time through its gate.' }),
  B('feeder_herb', 'Herbivore Feeder', 'enclosure', '', [1, 1], 1500, 4, 'feeder', { path: false, food: 'herb', stock: 20, restock: 1, meal: 45, desc: 'Raises bales of feed for herbivores: modern bales ($20) or paleo bales ($50). Place inside an enclosure.' }),
  B('feeder_goat', 'Carnivore Feeder', 'enclosure', '', [1, 1], 1500, 6, 'feeder', { path: false, food: 'carn', stock: 6, restock: 50, meal: 45, desc: 'Releases live goats ($50) or cattle ($80) for carnivores. Place inside an enclosure.' }),
  B('lure', 'Auto Lure', 'enclosure', '', [1, 1], 2000, 50, 'lure', { path: false, research: 'lure', range: 40, desc: 'Sprays a scent that draws herbivores or carnivores toward it. Set the gas and how often it fires.' }),
  // Security
  B('ranger', 'Ranger Station', 'staff', '', [3, 3], 6000, 250, 'ranger', { limit: 5, health: 3000, path: false, range: 34, desc: 'Home of the park rangers and their helicopter: repairs, vaccinations, sedation, rescues and recapturing escapes.' }),
  B('camera', 'Security Camera', 'staff', '', [1, 1], 600, 4, 'camera', { path: false, safety: 9, view: 16, research: 'camera', limit: 100, desc: 'Guests nearby feel safer. Warns you of breakouts and rampages it can see; without cameras you only hear about them from guests and staff.' }),
  B('beacon', 'Avoidance Beacon', 'staff', '', [1, 1], 2000, 6, 'beacon', { path: false, repel: 6, research: 'beacon', limit: 10, desc: 'An ultrasonic beacon that dinosaurs keep away from. Protects paths and shelters.' }),
  B('turret', 'Sentry Turret', 'staff', '', [2, 2], 10000, 20, 'turret', { path: false, range: 14, research: 'turret', limit: 10, desc: 'An automatic gun tower that shoots escaped or rampaging dinosaurs. Choose its targets.' }),
  B('shelter', 'Visitor Shelter', 'staff', '', [3, 3], 2000, 15, 'shelter', { model: [2, 2], limit: 10, health: 4000, research: 'shelter', capacity: 40, desc: 'A bunker for 40 guests during emergencies.' }),
  // Older buildings, kept so saves from earlier versions still load. They are not in the build menu.
  B('drinks', 'Drinks Kiosk', 'amenity', '', [1, 1], 600, 8, 'shop', { legacy: true, need: 'thirst', price: 2, stay: 2 }),
  B('restaurant', 'Burger Restaurant', 'amenity', '', [2, 2], 2500, 30, 'shop', { legacy: true, need: 'hunger', also: 'thirst', price: 8, stay: 8 }),
  B('hotel', 'Hotel', 'amenity', '', [3, 3], 15000, 120, 'shop', { legacy: true, need: 'energy', price: 60, stay: 30, capacity: 45 }),
  B('research', 'Genetics Lab', 'enclosure', '', [3, 3], 8000, 80, 'research', { legacy: true, path: false }),
  B('acu', 'Ranger Helipad', 'staff', '', [3, 3], 8000, 120, 'acu', { legacy: true, path: false }),
  B('weather', 'Weather Station', 'staff', '', [2, 2], 4000, 30, 'weather', { legacy: true, path: false }),
  B('feeder_cow', 'Cow Feeder', 'enclosure', '', [2, 2], 1500, 10, 'feeder', { legacy: true, path: false, food: 'carn', stock: 4, restock: 80, meal: 90 }),
  B('statue', 'Dino Statue', 'deco', '', [1, 1], 600, 1, 'deco', { legacy: true, path: false, joy: 8 }),
  B('flowers', 'Flower Bed', 'deco', '', [1, 1], 100, 1, 'deco', { legacy: true, path: false, joy: 3 }),
  B('lamp', 'Lamp Post', 'deco', '', [1, 1], 60, 1, 'deco', { legacy: true, path: false, joy: 1 }),
];
export const BLD = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
// Feeder food, as in the original: herbivore feeders drop modern bales or paleo bales, carnivore feeders
// release goats or cows. Cost is per drop. Modern food can give herbivores Gastric Poisoning.
export const FEED = {
  bale: { name: 'Modern Bale', cost: 20, meal: 30, modern: true },
  paleo: { name: 'Paleo Bale', cost: 50, meal: 50 },
  goat: { name: 'Goat', cost: 50, meal: 45 },
  cow: { name: 'Cow', cost: 80, meal: 90 },
};
export function feederFood(b) { return b.menu?.food || (BLD[b.type].food === 'herb' ? 'bale' : b.type === 'feeder_cow' ? 'cow' : 'goat'); }
// Site B allows only hatcheries, feeders and lures (plus landscaping).
export const SITEB_BUILDINGS = ['hatchery', 'feeder_herb', 'feeder_goat', 'feeder_cow', 'lure'];

export const FLORA = [
  null,
  { id: 1, name: 'Palm Tree', cost: 10, forest: true, modern: true },
  { id: 2, name: 'Tree Fern', cost: 30, forest: true, graze: true },
  { id: 3, name: 'Jungle Tree', cost: 10, forest: true, modern: true },
  { id: 4, name: 'Fern', cost: 30, forest: true, graze: true },
  { id: 5, name: 'Cycad', cost: 30, forest: true, graze: true },
  { id: 6, name: 'Boulder', cost: 15, forest: false },
];

// ---------- Research ----------
// Research as in the original: costs and times from its research tree (1 month = 2 game days).
// Vaccines can only be researched once a dinosaur has caught the disease (needCase).
// Research tree from the original (JP-Genesis Archives): ring 2 and ring 3 items open once the park has opened
// to the public; some need a building first.
export const RESEARCH = [
  { id: 'fence_med', name: 'Medium Security Fence', cat: 'Security', cost: 300, days: 2, req: [], desc: 'The medium security fence: for small carnivores and Triceratops.' },
  { id: 'fence_high', name: 'High Security Fence', cat: 'Security', cost: 5000, days: 4, ring: 3, req: ['fence_med'], desc: 'The high security fence: for large carnivores and other dangerous dinosaurs.' },
  { id: 'shelter', name: 'Visitor Shelter', cat: 'Security', cost: 2500, days: 3, ring: 2, built: 'ranger', req: [], desc: 'A safe haven for guests who feel threatened.' },
  { id: 'camera', name: 'Security Camera', cat: 'Security', cost: 1500, days: 2, ring: 3, built: 'ranger', req: [], desc: 'Cameras that raise park security and warn of breakouts.' },
  { id: 'turret', name: 'Sentry Turret', cat: 'Security', cost: 1500, days: 4, ring: 3, req: ['camera'], desc: 'Automatic gun towers that stop rampaging dinosaurs.' },
  { id: 'beacon', name: 'Avoidance Beacon', cat: 'Security', cost: 2000, days: 2, ring: 3, req: [], desc: 'Nearby dinosaurs are repelled by this device.' },
  { id: 'binoculars', name: 'Binoculars', cat: 'Attractions', cost: 600, days: 2, ring: 2, built: 'platform', req: [], desc: 'Better binoculars let guests see further from Viewing Platforms.' },
  { id: 'balloon', name: 'Balloon Tour', cat: 'Attractions', cost: 1500, days: 4, ring: 3, built: 'entrance', req: [], desc: 'Guests take a balloon ride around your park.' },
  { id: 'dome', name: 'Viewing Dome', cat: 'Attractions', cost: 1250, days: 4, ring: 3, req: [], desc: 'Guests see dinosaurs up close from inside an enclosure.' },
  { id: 'safari', name: 'Safari Adventure', cat: 'Attractions', cost: 2000, days: 4, ring: 3, req: ['balloon'], desc: 'Guests tour your enclosures in Land Cruisers.' },
  { id: 'weatherguard', name: 'Weather Guard', cat: 'Amenities', cost: 500, days: 2, built: 'entrance', req: [], desc: 'Umbrellas for guests, and lightning protection for buildings and fences.' },
  { id: 'fountain', name: 'Fountain', cat: 'Amenities', cost: 400, days: 2, ring: 2, built: 'entrance', req: [], desc: 'A calming water feature for your footpaths.' },
  { id: 'souvenir', name: 'Souvenir Stand', cat: 'Amenities', cost: 2000, days: 4, ring: 2, built: 'entrance', req: [], desc: 'Sell souvenirs to your guests.' },
  { id: 'restarea', name: 'Rest Area', cat: 'Amenities', cost: 1500, days: 2, ring: 2, built: 'entrance', req: [], desc: 'A place for weary guests to rest.' },
  { id: 'extract', name: 'Super Extractor', cat: 'Dinosaurs', cost: 4500, days: 2, req: [], desc: 'Speeds up DNA extraction and recovers more DNA from each find.' },
  { id: 'incub', name: 'Growth Booster', cat: 'Dinosaurs', cost: 3000, days: 3, req: ['extract'], desc: 'Dinosaurs grow faster in the Hatchery.' },
  { id: 'immunize', name: 'Hatchery Immunization', cat: 'Dinosaurs', cost: 5000, days: 4, req: ['incub'], desc: 'Newborn dinosaurs get every vaccine you have before release.' },
  { id: 'lure', name: 'Auto Lure', cat: 'Dinosaurs', cost: 1200, days: 3, req: [], desc: 'Dispenses scent lures that draw dinosaurs to a spot.' },
  { id: 'gyro', name: 'Gyro Stabilizer', cat: 'Vehicles', cost: 2000, days: 3.3, req: [], desc: 'Helicopters fly steadily in storms and take off on their own in bad weather.' },
  { id: 'battery', name: 'Double Battery', cat: 'Vehicles', cost: 1500, days: 2, req: [], desc: 'Helicopters stay airborne twice as long.' },
  { id: 'retire', name: 'Retire', cat: 'Vehicles', cost: 1500, days: 2, req: [], desc: 'Lets your rangers retire (kill) dinosaurs.' },
  { id: 'vac_tick', name: 'Tick Infestation', cat: 'Vaccines', cost: 1000, days: 2, req: [], needCase: 'tick', desc: 'A vaccine for Tick Infestation.' },
  { id: 'vac_bumble', name: 'Bumblefoot', cat: 'Vaccines', cost: 1000, days: 2, req: [], needCase: 'bumblefoot', desc: 'A vaccine for Bumblefoot.' },
  { id: 'vac_belly', name: 'Dino Belly', cat: 'Vaccines', cost: 1500, days: 3, req: [], needCase: 'belly', desc: 'A vaccine for Dino Belly.' },
  { id: 'vac_flu', name: 'Dinosaur Flu', cat: 'Vaccines', cost: 1750, days: 3, req: [], needCase: 'flu', desc: 'A vaccine for Dinosaur Flu.' },
  { id: 'vac_gastric', name: 'Gastric Poisoning', cat: 'Vaccines', cost: 2000, days: 4, req: [], needCase: 'gastric', desc: 'A vaccine for Gastric Poisoning.' },
  { id: 'vac_rabies', name: 'Rabies', cat: 'Vaccines', cost: 3000, days: 4, req: [], needCase: 'rabies', desc: 'A vaccine for Rabies.' },
];
// Research ids from earlier versions, mapped to their replacements when a save is loaded.
export const RESEARCH_RENAMED = { giftshop: 'souvenir', resting: 'restarea', weather: 'weatherguard', ranger2: null, generator: null, tranq: null, hotel: null, genome: null, teams: null };
export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

// ---------- Diseases ----------
export const DISEASES = {
  bumblefoot: { name: 'Bumblefoot', vaccine: 'vac_bumble', dmg: 6, comfort: 20, chance: 1.0, spread: 0, slow: 0.5, herbBias: 2, desc: 'An infected foot. The animal limps, moves slowly and is stressed.' },
  tick: { name: 'Tick Infestation', vaccine: 'vac_tick', dmg: 10, comfort: 15, chance: 0.9, spread: 0.2, fatal: true, manic: 1.25, paralyse: 15, desc: 'Ticks feed on the animal\'s blood, leaving it irritable and weak. Can be fatal.' },
  belly: { name: 'Dino Belly', vaccine: 'vac_belly', dmg: 8, comfort: 15, chance: 0.8, spread: 0, thirst: 2, appetite: 0.6, desc: 'A minor infection of the gut. Eats less and drinks more.' },
  gastric: { name: 'Gastric Poisoning', vaccine: 'vac_gastric', dmg: 20, comfort: 20, chance: 0.15, spread: 0, herbOnly: true, fatal: true, paralyse: 30, desc: 'Toxins from modern plants build up until the animal is paralysed. Fatal if untreated.' },
  flu: { name: 'Dino Flu', vaccine: 'vac_flu', dmg: 22, comfort: 25, chance: 0.3, spread: 0.35, appetite: 0.6, sleepy: true, desc: 'Sneezing, no appetite and tiredness. Spreads quickly through a herd.' },
  rabies: { name: 'Rabies', vaccine: 'vac_rabies', dmg: 18, comfort: 40, chance: 0.2, spread: 0.1, carnOnly: true, aggro: true, fatal: true, thirst: 2, coma: 3, slow: 0.8, desc: 'Shaking and great thirst, then the animal goes berserk. The most dangerous disease.' },
};

// ---------- Dig sites (lon/lat for the world map) ----------
// Each site has three excavation areas (kind, most teams at once) and a fixed number of gold ores (90 in all).
// Every dig takes 240 s (1.6 game days), whatever the site. From the JP-Genesis Archives site pages.
export const DIG_DAYS = 240 / 150;
export const QUALITY = ['Exhausted', 'Poor', 'Mediocre', 'Average', 'Good', 'Rich'];
export const SITES = [
  { id: 'judithA', starter: true, name: 'Judith River Group A', country: 'Montana, USA', lon: -112.2, lat: 49.4, areas: [['mountain', 4], ['plains', 2], ['river', 2]], gold: 10, species: ['albertosaurus', 'ankylosaurus', 'pachycephalosaurus'], stars: 0, cost: 1500, days: 1.2, quality: 3 },
  { id: 'judithB', name: 'Judith River Group B', country: 'Montana, USA', lon: -107.8, lat: 51.8, areas: [['plains', 4], ['plains', 2], ['river', 2]], gold: 10, species: ['tyrannosaurus', 'corythosaurus', 'styracosaurus'], stars: 3, cost: 3500, days: 1.8, quality: 3 },
  { id: 'flaming', starter: true, name: 'The Flaming Cliffs', country: 'Mongolia', lon: 103.7, lat: 44.1, areas: [['mountain', 4], ['mountain', 3], ['river', 2]], gold: 12, species: ['velociraptor', 'homalocephale', 'gallimimus'], stars: 0, cost: 1500, days: 1.4, quality: 3 },
  { id: 'hellA', starter: true, name: 'Hell Creek Formation Group A', country: 'Montana, USA', lon: -103.5, lat: 47.0, areas: [['mountain', 4], ['mountain', 2], ['plains', 2]], gold: 10, species: ['acrocanthosaurus', 'torosaurus', 'parasaurolophus'], stars: 2, cost: 2500, days: 1.5, quality: 3 },
  { id: 'hellB', name: 'Hell Creek Formation Group B', country: 'Montana, USA', lon: -100.2, lat: 44.6, areas: [['mountain', 4], ['mountain', 2], ['plains', 2]], gold: 10, species: ['triceratops', 'edmontosaurus', 'pachycephalosaurus'], stars: 1, cost: 2000, days: 1.5, quality: 3 },
  { id: 'morrisonA', starter: true, name: 'Morrison Formation Group A', country: 'Colorado, USA', lon: -110.8, lat: 39.0, areas: [['mountain', 4], ['plains', 3], ['plains', 2]], gold: 12, species: ['dryosaurus', 'ceratosaurus', 'stegosaurus'], stars: 0, cost: 1500, days: 1.3, quality: 3 },
  { id: 'morrisonB', name: 'Morrison Formation Group B', country: 'Utah, USA', lon: -106.0, lat: 36.2, areas: [['mountain', 4], ['plains', 3], ['plains', 2]], gold: 10, species: ['dilophosaurus', 'brachiosaurus', 'camarasaurus'], stars: 2, cost: 2500, days: 1.6, quality: 3 },
  { id: 'tendaguru', name: 'Tendaguru Beds', country: 'Tanzania', lon: 39.2, lat: -9.7, areas: [['mountain', 4], ['plains', 3], ['plains', 2]], gold: 8, species: ['allosaurus', 'brachiosaurus', 'kentrosaurus'], stars: 1, cost: 2500, days: 1.6, quality: 3 },
  { id: 'chenini', name: 'Chenini Formation', country: 'Tunisia', lon: 10.2, lat: 32.9, areas: [['mountain', 4], ['plains', 3], ['river', 2]], gold: 8, species: ['carcharodontosaurus', 'spinosaurus', 'ouranosaurus'], stars: 3, cost: 3500, days: 2.0, quality: 3 },
];
export const SITE_BY_ID = Object.fromEntries(SITES.map((s) => [s.id, s]));
export const TEAM_COSTS = [0, 5000, 10000, 15000, 20000];
export const TEAM_COST = TEAM_COSTS[1];
export const MAX_TEAMS = 5;
// Valuable finds dig teams sometimes bring back.
export const GEMS = { silver: 2500, gold: 6000, opal: 4000 };

// Rough continent outlines (lon, lat) for the expedition world map.
export const CONTINENTS = [
  [[-168, 66], [-140, 70], [-95, 72], [-80, 63], [-60, 55], [-53, 47], [-66, 44], [-76, 35], [-81, 25], [-97, 26], [-97, 18], [-87, 15], [-79, 8], [-83, 8], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 41], [-124, 49], [-133, 57], [-152, 58], [-165, 60]],
  [[-79, 9], [-60, 10], [-50, 0], [-35, -6], [-39, -14], [-48, -26], [-58, -35], [-65, -41], [-68, -52], [-74, -50], [-71, -30], [-70, -18], [-81, -5], [-78, 2]],
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [10, 57], [5, 62], [15, 69], [28, 71], [40, 67], [45, 45], [28, 41], [22, 36], [12, 38], [3, 43]],
  [[-17, 15], [-17, 21], [-10, 30], [-6, 35], [10, 37], [20, 32], [32, 31], [34, 28], [43, 12], [51, 12], [40, -2], [40, -15], [33, -26], [20, -35], [17, -29], [12, -17], [13, -6], [9, 4], [-8, 4], [-16, 11]],
  [[28, 41], [45, 45], [40, 67], [70, 73], [110, 77], [140, 72], [170, 70], [180, 66], [160, 58], [140, 52], [135, 43], [122, 40], [121, 30], [110, 20], [106, 10], [100, 13], [98, 8], [92, 22], [80, 15], [77, 8], [72, 20], [57, 25], [50, 30], [56, 26], [44, 13], [35, 30]],
  [[114, -22], [122, -18], [131, -12], [137, -12], [142, -11], [146, -19], [153, -28], [150, -37], [141, -38], [132, -32], [115, -34]],
  [[-50, 60], [-42, 60], [-20, 70], [-20, 80], [-60, 82], [-70, 77], [-55, 68]],
  [[-5, 50], [1, 51], [-3, 56], [-6, 58], [-5, 54]],
  [[130, 31], [136, 34], [141, 38], [142, 43], [140, 41], [135, 35]],
];

// ---------- Advisors (original characters) ----------
// Shop menus as in the original: each Kiosk picks a meal, a side order and a price; each Souvenir Stand
// picks a souvenir and an optional free gift. Options are [name, picture, appeal, cost to the park per sale,
// guest type it pleases most]. Sides are named for the guest types they appeal to.
export const MENUS = {
  snack: { labels: ['Meal', 'Side order'], main: [['Sandwich', '🥪', 1, 5], ['Dino Dog', '🌭', 2, 10], ['Rex Burger', '🍔', 3, 15]],
    side: [["Thrillin' Chili", '🌶️', 1, 1, 'violent'], ['Fun Fries', '🍟', 1, 1, 'nonviolent'], ['Paleo Salad', '🥗', 1, 1, 'environmental']] },
  giftshop: { labels: ['Souvenir', 'Free gift'], main: [['Park Balloon', '🎈', 1, 1], ['Fun Bag', '🛍️', 2, 10], ['Dinosaur Toy', '🦖', 3, 30]],
    side: [['No gift', '·', 0, 0], ['Raptor Button', '🔘', 1, 1], ['Snow Globe', '🔮', 1.5, 2], ['Amber Keychain', '🔑', 2, 3]] },
  drinks: { labels: ['Drink', 'Snack'], main: [['Cola', '🥤', 2, 1]], side: [['Popcorn', '🍿', 2, 1]] },
  restaurant: { labels: ['Main course', 'Dessert'], main: [['Steak Platter', '🥩', 3, 4]], side: [['Ice Cream', '🍨', 2, 1]] },
};
// Attraction themes ("bias") as in the original: each viewing building can be themed for one guest type.
export const BIAS = {
  vent: { neutral: 'Viewing Vent', violent: 'Thrill Window', nonviolent: 'Playpen', environmental: 'Wonder Window' },
  platform: { neutral: 'Viewing Platform', violent: 'Thrill Platform', nonviolent: 'Playtime Platform', environmental: 'Scenic Platform' },
  dome: { neutral: 'Viewing Dome', violent: 'Terror Dome', nonviolent: 'Dino Play Dome', environmental: 'Nature Dome' },
};

// What a building charges each guest: the player's price if set, else the default. As in the original,
// shops, rest rooms and attractions all charge, and the player sets the price up to a maximum.
export const CHARGEABLE = (type) => !!MENUS[type] || BLD[type]?.max != null;
export function buildingPrice(b) { return b.menu?.charge ?? BLD[b.type].price ?? 0; }

// Guest interest types, as in the original. Umbrella colours follow the original's scheme.
export const VTYPES = {
  violent: { name: 'Thrill Seeker', plural: 'Thrill Seekers', col: 0xc8302a, shirts: [0xc0281e, 0x1e1e22, 0x8a1810, 0x2a2a2e], likes: 'Carnivores hunting, eating and fighting', exp: 'Thrills' },
  nonviolent: { name: 'Fun Lover', plural: 'Fun Lovers', col: 0x3f9a3a, shirts: [0x46a040, 0x2f7a2c, 0x7ac060, 0xf0c030], likes: 'Herbivores playing and socialising', exp: 'Fun' },
  environmental: { name: 'Dino Nerd', plural: 'Dino Nerds', col: 0x2f6fc8, shirts: [0x3a78d0, 0x2a58a0, 0x6aa0e0, 0xd8d0b0], likes: 'Authentic enclosures: dinosaurs from the same era and place, natural scenery, no feeders or hatcheries in view', exp: 'Authenticity' },
  neutral: { name: 'Mainstream', plural: 'Mainstream guests', col: 0x9a9a9a, shirts: [0xf2f2ec, 0x8a8a8a, 0xa050c0, 0xe08a3a], likes: 'Just seeing real, live dinosaurs', exp: 'Overall' },
};

export const ADVISORS = {
  founder: { name: 'Edmund Carrow', role: 'Founder, GenTec', col: '#c9a24a' },
  finance: { name: 'Victor Hale', role: 'Finance Director', col: '#8aa0b8' },
  paleo: { name: 'Dr. Mara Okafor', role: 'Paleontologist', col: '#c0864a' },
  genetics: { name: 'Dr. Ken Ishida', role: 'Head Geneticist', col: '#6ab0a0' },
  vet: { name: 'Dr. Lucia Reyes', role: 'Veterinarian', col: '#8ac06a' },
  admin: { name: 'Tom Whitaker', role: 'Park Administrator', col: '#b0a080' },
  warden: { name: 'Jack Brannigan', role: 'Park Warden', col: '#a06a4a' },
  pr: { name: 'Nina Shaw', role: 'Public Relations', col: '#c07aa0' },
};

// ---------- Missions ----------
// Ten action missions in the original's four kinds: Safari (drive a Land Cruiser and take photos), Ranger Attack
// (retire carnivores from the helicopter), Dino Muster (herd herbivores with the helicopter's muster) and Ranger
// Rescue. Each mission's island is laid out by its `setup` in missions.js. Goal types are evaluated in park.js.
// Times are in seconds of game time.
export const MISSIONS = [
  {
    id: 'm1', kind: 'Safari', name: 'A Picture Is Worth 100 Points', setup: 'picture', control: 'cruiser', photos: 10, advisor: 'founder',
    brief: 'A documentary has called our park a fake. Drive the Land Cruiser and bring back ten photographs good enough to prove them wrong.',
    win: 'Splendid! Those pictures prove beyond doubt that our dinosaurs are real.', lose: 'These photos just are not good enough. The critics will keep doubting us unless you try again.',
    goals: [{ type: 'missionPoints', n: 100, text: 'Score 100 photo points with 10 photos' }, { type: 'cruiserAlive', text: 'Keep the Land Cruiser in one piece', fail: true }],
  },
  {
    id: 'm2', kind: 'Ranger Attack', name: 'When Carnivores Attack!', setup: 'attack', control: 'heli', ammo: 40, timeLimit: 240, advisor: 'warden', research: ['retire'],
    brief: 'Our carnivores have gone berserk and we cannot open the park. Take the ranger helicopter and retire every one of them before they eat the herbivores.',
    win: 'Good work. You stopped those carnivores in their tracks and the park is safe again.', lose: 'The carnivores have won this time. Maybe you should try again.',
    goals: [{ type: 'tagLeft', tag: 'target', n: 0, text: 'Retire all the rampaging carnivores' }, { type: 'minHerb', n: 1, text: 'Keep some herbivores alive', fail: true }],
  },
  {
    id: 'm3', kind: 'Dino Muster', name: 'Time to Get Moving', setup: 'muster', control: 'heli', timeLimit: 540, advisor: 'vet', research: ['retire'], muster: true,
    brief: 'Our herbivores have escaped from their paddock. Use the helicopter\'s muster to herd them back into the muster area before the tyrannosaurs find them.',
    win: 'Well done! Thank you for saving our herbivores.', lose: 'This is a tragedy. The tyrannosaurs will eat them all unless you try again.',
    goals: [{ type: 'mustered', species: 'edmontosaurus', n: 5, text: 'Herd 5 Edmontosaurus into the muster area' }, { type: 'mustered', species: 'parasaurolophus', n: 5, text: 'Herd 5 Parasaurolophus into the muster area' },
      { type: 'tagLeft', tag: 'target', n: 0, optional: true, text: 'Optional: retire the 4 Tyrannosaurus' }, { type: 'minHerb', n: 1, text: 'Keep some herbivores alive', fail: true }],
  },
  {
    id: 'm4', kind: 'Safari', name: 'Dinosaurs and Weather', setup: 'weather', control: 'cruiser', photos: 30, advisor: 'founder',
    brief: 'Our scientists are studying how weather changes dinosaur behaviour. Photograph each of these species in the heatwave or in the storm.',
    win: 'Excellent. The research team has everything it needs.', lose: 'We are missing photos. Try the expedition again.',
    goals: [{ type: 'photoWhen', species: 'gallimimus', weather: 'heat', text: 'Gallimimus in the heatwave' }, { type: 'photoWhen', species: 'dryosaurus', weather: 'heat', text: 'Dryosaurus in the heatwave' },
      { type: 'photoWhen', species: 'stegosaurus', weather: 'heat', text: 'Stegosaurus in the heatwave' }, { type: 'photoWhen', species: 'ceratosaurus', weather: 'heat', text: 'Ceratosaurus in the heatwave' },
      { type: 'photoWhen', species: 'corythosaurus', weather: 'storm', text: 'Corythosaurus in the thunderstorm' }, { type: 'photoWhen', species: 'homalocephale', weather: 'storm', text: 'Homalocephale in the thunderstorm' },
      { type: 'photoWhen', species: 'velociraptor', weather: 'storm', text: 'Velociraptor in the thunderstorm' }, { type: 'cruiserAlive', text: 'Keep the Land Cruiser in one piece', fail: true }],
  },
  {
    id: 'm5', kind: 'Ranger Rescue', name: 'Rescue the President', setup: 'president', control: 'heli', ammo: 60, timeLimit: 480, advisor: 'founder', research: ['retire'], storms: 9,
    brief: 'A visiting president is trapped in the park during a storm. Retire the rampaging dinosaurs, then fly him out of the shelter to the entrance helipad.',
    win: 'Thank goodness you came to the rescue. The president is safe and will make a full recovery.', lose: 'The president could not be saved. Our reputation is in ruins unless you try again.',
    goals: [{ type: 'tagLeft', tag: 'target', n: 0, text: 'Retire all the rampaging dinosaurs' }, { type: 'vip', n: 2, text: 'Fly the president from the shelter to the entrance' }, { type: 'vipAlive', text: 'Keep the president alive', fail: true }],
  },
  {
    id: 'm6', kind: 'Safari', name: 'Danger Club Photo Safari', setup: 'danger', control: 'cruiser', photos: 15, advisor: 'founder',
    brief: 'A club of wealthy thrill seekers will fund the park if you show them truly thrilling pictures. Only carnivores hunting, eating or fighting will do.',
    win: 'Well done. These photos are so frightening the Danger Club will be delighted.', lose: 'Not thrilling enough. The Danger Club wants more danger.',
    goals: [{ type: 'missionPoints', carn: true, n: 200, text: 'Score 200 points photographing carnivores in action' }, { type: 'cruiserAlive', text: 'Keep the Land Cruiser in one piece', fail: true }],
  },
  {
    id: 'm7', kind: 'Ranger Rescue', name: 'Rescue the Founder', setup: 'founder', control: 'cruiser', timeLimit: 420, advisor: 'admin', photos: 0,
    brief: 'The park is in emergency mode and our founder is stranded in a Visitor Shelter. The helicopter is grounded, so take the Land Cruiser: collect the rifle at the Ranger Station, pick him up and drive him to the Park Entrance.',
    win: 'Great work! You can bet you will get a bonus this year.', lose: 'We could not reach him in time. Try again.',
    goals: [{ type: 'rifle', text: 'Collect the rifle from the Ranger Station' }, { type: 'vip', n: 1, text: 'Pick up the founder at the Visitor Shelter' }, { type: 'vip', n: 2, text: 'Drive him to the Park Entrance' },
      { type: 'cruiserAlive', text: 'Keep the Land Cruiser in one piece', fail: true }],
  },
  {
    id: 'm8', kind: 'Ranger Attack', name: 'Cleanup Operation', setup: 'cleanup', control: 'heli', ammo: 60, timeLimit: 480, advisor: 'warden', research: ['retire'],
    brief: 'The automated hatcheries have gone haywire and keep turning out carnivores. Shoot out their power boxes, then retire every carnivore before the inspectors arrive.',
    win: 'Good work. The inspectors will never suspect a thing.', lose: 'This is not good. The inspectors have all the evidence they need unless you try again.',
    goals: [{ type: 'powerOff', n: 3, text: 'Shut down the 3 hatcheries (shoot their power boxes)' }, { type: 'tagLeft', tag: 'target', n: 0, text: 'Retire all the carnivores' }],
  },
  {
    id: 'm9', kind: 'Dino Muster', name: 'The Amazing Maze', setup: 'maze', control: 'heli', timeLimit: 600, advisor: 'vet', research: ['retire'], muster: true, ammo: 40,
    brief: 'A herd of Edmontosaurus and Ouranosaurus is lost in a maze of fences. The vets want to examine them: muster them out to safety, and watch for carnivores.',
    win: 'Fantastic! Once again you have saved our herbivores.', lose: 'Those herbivores will never get out of the maze unless you try again.',
    goals: [{ type: 'mustered', species: 'edmontosaurus', n: 4, text: 'Herd 4 Edmontosaurus into the muster area' }, { type: 'mustered', species: 'ouranosaurus', n: 4, text: 'Herd 4 Ouranosaurus into the muster area' },
      { type: 'tagLeft', tag: 'target', n: 0, optional: true, text: 'Optional: retire all the carnivores' }, { type: 'beaconsLeft', n: 0, optional: true, text: 'Optional: destroy the Avoidance Beacons' }, { type: 'minHerb', n: 1, text: 'Keep some herbivores alive', fail: true }],
  },
  {
    id: 'm10', kind: 'Safari', name: 'The Park Calendar', setup: 'calendar', control: 'cruiser', photos: 24, advisor: 'founder',
    brief: 'Guests want a park calendar. Bring back exciting pictures of dinosaurs drinking, eating, sleeping, hunting, fighting and playing.',
    win: 'Wonderful! The calendar will be a best-seller.', lose: 'We cannot print the calendar with these. Try again.',
    goals: [{ type: 'photoTag', tag: 'drinking', text: 'Dinosaurs drinking' }, { type: 'photoTag', tag: 'eating', text: 'Dinosaurs eating' }, { type: 'photoTag', tag: 'sleeping', text: 'Dinosaurs sleeping' },
      { type: 'photoTag', tag: 'hunting', text: 'Dinosaurs hunting' }, { type: 'photoTag', tag: 'fighting', text: 'Dinosaurs fighting' }, { type: 'photoTag', tag: 'playing', text: 'Dinosaurs playing' },
      { type: 'missionPoints', n: 350, text: 'Score 350 points' }, { type: 'cruiserAlive', text: 'Keep the Land Cruiser in one piece', fail: true }],
  },
];

// ---------- Exercises ----------
// Nine exercises as in the original: four tutorials, then five park scenarios. Park goal types are in park.js.
export const EXERCISES = [
  {
    id: 'e1', name: 'Welcome to the Park', setup: 'welcome', tutorial: true, advisor: 'founder', money: 50000, research: ['retire'],
    brief: 'Learn the basic controls. Be quick: trouble is just around the corner.',
    goals: [{ type: 'flag', flag: 'camMove', text: 'Move the camera (W A S D)' }, { type: 'flag', flag: 'camRotate', text: 'Rotate the camera (Q / E)' }, { type: 'flag', flag: 'camZoom', text: 'Zoom the camera (mouse wheel)' },
      { type: 'flag', flag: 'minimap', text: 'Open the island map' }, { type: 'flag', flag: 'sel:triceratops', text: 'Select the Triceratops' }, { type: 'flag', flag: 'sel:tyrannosaurus', text: 'Select the Tyrannosaurus' },
      { type: 'flag', flag: 'selb:ranger', text: 'Select the Ranger Station' }, { type: 'flag', flag: 'flyHeli', text: 'Fly the ranger helicopter' }, { type: 'flag', flag: 'sedateRex', text: 'Sedate the rampaging Tyrannosaurus' }],
  },
  {
    id: 'e2', name: 'Dinosaur Origins', setup: 'origins', tutorial: true, advisor: 'paleo', money: 100000,
    brief: 'Learn how to find dinosaur DNA, then create an Acrocanthosaurus for your park.',
    goals: [{ type: 'flag', flag: 'mail', text: 'Read your mail' }, { type: 'finds', n: 1, text: 'Get fossils from Hell Creek Formation Group A' }, { type: 'flag', flag: 'tab:dinosaurs', text: 'Open the Dinosaur Summary' },
      { type: 'built', b: 'hatchery', n: 2, text: 'Build 2 Hatcheries' }, { type: 'speciesCount', species: 'torosaurus', n: 5, text: 'Create 5 Torosaurus' }, { type: 'dna', species: 'acrocanthosaurus', n: 1, text: 'Extract Acrocanthosaurus DNA' },
      { type: 'research', id: 'fence_med', text: 'Research Medium Security Fences' }, { type: 'fencesAt', n: 2, text: 'Upgrade your fences to Medium Security' }, { type: 'dna', species: 'acrocanthosaurus', n: 50, text: 'Reach 50% Acrocanthosaurus DNA' },
      { type: 'speciesCount', species: 'acrocanthosaurus', n: 1, text: 'Create an Acrocanthosaurus' }, { type: 'built', b: 'feeder_goat', n: 1, text: 'Build a Carnivore Feeder' }, { type: 'built', b: 'feeder_herb', n: 1, text: 'Build a Herbivore Feeder' }],
  },
  {
    id: 'e3', name: 'What Visitors Want', setup: 'visitors', tutorial: true, advisor: 'pr', money: 120000,
    brief: 'Learn how to give your guests everything they need.',
    goals: [{ type: 'flag', flag: 'opened', text: 'Open the park' }, { type: 'flag', flag: 'passport', text: 'Check a guest\'s passport (click a guest)' }, { type: 'built', b: 'snack', n: 1, text: 'Build a Kiosk' }, { type: 'built', b: 'restroom', n: 1, text: 'Build Rest Rooms' },
      { type: 'research', id: 'weatherguard', text: 'Research Weather Guard (umbrellas)' }, { type: 'cleaners', n: 4, text: 'Build a Cleaner Station and hire 4 cleaners' }, { type: 'built', b: 'bungalow', n: 1, text: 'Build a Rest Area' },
      { type: 'built', b: 'platform', n: 4, text: 'Build 4 Viewing Platforms' }, { type: 'built', b: 'vent', n: 2, text: 'Build 2 Viewing Vents' }, { type: 'flag', flag: 'viewVent', text: 'Look through a Viewing Vent' },
      { type: 'flag', flag: 'tab:entertainment', text: 'Check the Entertainment report' }, { type: 'speciesCount', species: 'tyrannosaurus', n: 1, text: 'Create a Tyrannosaurus' }, { type: 'bias', b: 'vent', bias: 'violent', text: 'Make a Thrill Window' }],
  },
  {
    id: 'e4', name: 'Safe and Secure', setup: 'secure', tutorial: true, advisor: 'warden', money: 150000, research: ['fence_med', 'camera', 'beacon', 'turret', 'shelter', 'retire'],
    brief: 'Make your park a safe and secure experience for the whole family.',
    goals: [{ type: 'flag', flag: 'tab:dinosaurs', text: 'Examine the Dinosaur report' }, { type: 'flag', flag: 'tab:security', text: 'Examine the Security report' }, { type: 'research', id: 'fence_high', text: 'Research High Security Fences' }, { type: 'fencesAt', n: 3, text: 'Upgrade your fences to High Security' },
      { type: 'built', b: 'camera', n: 4, text: 'Build 4 Security Cameras' }, { type: 'built', b: 'beacon', n: 2, text: 'Build 2 Avoidance Beacons' }, { type: 'built', b: 'turret', n: 2, text: 'Build 2 Sentry Turrets' },
      { type: 'built', b: 'shelter', n: 1, text: 'Build a Visitor Shelter' }, { type: 'built', b: 'ranger', n: 1, text: 'Build a Ranger Station' }, { type: 'flag', flag: 'emergency', text: 'Declare an emergency' }, { type: 'carnLeft', n: 0, text: 'Retire all the carnivores' }],
  },
  {
    id: 'e5', name: 'Open Range Safari', setup: 'openRange', advisor: 'founder', money: 250000, research: ['balloon', 'safari'],
    dna: { dryosaurus: 70, stegosaurus: 65, camarasaurus: 60, parasaurolophus: 65, torosaurus: 65, brachiosaurus: 60 },
    brief: 'Create an open-range wonderland for your herbivores and let guests drive through it.',
    goals: [{ type: 'speciesCount', species: 'dryosaurus', n: 6, text: 'Exhibit 6 Dryosaurus' }, { type: 'speciesCount', species: 'stegosaurus', n: 3, text: 'Exhibit 3 Stegosaurus' }, { type: 'speciesCount', species: 'camarasaurus', n: 2, text: 'Exhibit 2 Camarasaurus' },
      { type: 'speciesCount', species: 'parasaurolophus', n: 4, text: 'Exhibit 4 Parasaurolophus' }, { type: 'speciesCount', species: 'torosaurus', n: 4, text: 'Exhibit 4 Torosaurus' }, { type: 'speciesCount', species: 'brachiosaurus', n: 2, text: 'Exhibit 2 Brachiosaurus' },
      { type: 'built', b: 'feeder_herb', n: 4, text: 'Build 4 Herbivore Feeders' }, { type: 'built', b: 'safari', n: 1, text: 'Build a Safari Adventure' }, { type: 'rideExp', b: 'safari', exp: 'aut', n: 70, text: 'Score 70% Authenticity on the Safari Adventure' }],
  },
  {
    id: 'e6', name: 'Island Classic', setup: 'classic', advisor: 'founder', money: 250000, research: ['fence_med', 'fence_high', 'balloon', 'safari'],
    dna: { dilophosaurus: 65, gallimimus: 70, brachiosaurus: 60, velociraptor: 60, tyrannosaurus: 55 },
    brief: 'Recreate the dinosaur population of the very first island park.',
    goals: [{ type: 'speciesCount', species: 'dilophosaurus', n: 4, text: 'Exhibit 4 Dilophosaurus' }, { type: 'speciesCount', species: 'gallimimus', n: 5, text: 'Exhibit 5 Gallimimus' }, { type: 'speciesCount', species: 'brachiosaurus', n: 2, text: 'Exhibit 2 Brachiosaurus' },
      { type: 'speciesCount', species: 'velociraptor', n: 6, text: 'Exhibit 6 Velociraptor' }, { type: 'speciesCount', species: 'tyrannosaurus', n: 1, text: 'Exhibit a Tyrannosaurus' }, { type: 'built', b: 'safari', n: 1, text: 'Build a Safari Adventure' }],
  },
  {
    id: 'e7', name: 'The Lost World', setup: 'lostWorld', advisor: 'founder', money: 150000, research: ['fence_med', 'fence_high', 'retire', 'balloon', 'safari'],
    dna: { velociraptor: 60, tyrannosaurus: 55, homalocephale: 70, styracosaurus: 70, corythosaurus: 70, ankylosaurus: 65 },
    brief: 'Clean up the old breeding island and build a park there, with a photo portfolio for the scientific community.',
    goals: [{ type: 'tagLeft', tag: 'wildRaptor', n: 0, text: 'Eliminate the wild raptors' }, { type: 'stars', n: 2, text: 'Build a 2-star park' },
      { type: 'photoOf', species: 'homalocephale', text: 'Photograph a Homalocephale' }, { type: 'photoOf', species: 'styracosaurus', text: 'Photograph a Styracosaurus' }, { type: 'photoOf', species: 'corythosaurus', text: 'Photograph a Corythosaurus' }, { type: 'photoOf', species: 'ankylosaurus', text: 'Photograph an Ankylosaurus' },
      { type: 'speciesCount', species: 'velociraptor', n: 6, text: 'Exhibit 6 Velociraptor' }, { type: 'speciesCount', species: 'tyrannosaurus', n: 2, text: 'Exhibit 2 Tyrannosaurus' },
      { type: 'photoOf', species: 'velociraptor', text: 'Photograph a Velociraptor' }, { type: 'photoOf', species: 'tyrannosaurus', text: 'Photograph a Tyrannosaurus' }],
  },
  {
    id: 'e8', name: 'Dangerous Abodes', setup: 'abodes', advisor: 'founder', money: 300000, research: ['fence_med', 'fence_high', 'balloon', 'safari'],
    dna: { tyrannosaurus: 65, carcharodontosaurus: 60, acrocanthosaurus: 60, spinosaurus: 55 },
    brief: 'Can you manage an island of the most dangerous carnivores?',
    goals: [{ type: 'built', b: 'platform', n: 4, text: 'Build 4 Viewing Platforms' }, { type: 'built', b: 'safari', n: 1, text: 'Build a Safari Adventure' }, { type: 'built', b: 'balloon', n: 1, text: 'Build a Balloon Tour' },
      { type: 'rideExp', b: 'platform', exp: 'thr', n: 50, text: 'Score 50% Thrills on the Viewing Platforms' }, { type: 'rideExp', b: 'balloon', exp: 'thr', n: 65, text: 'Score 65% Thrills on the Balloon Tour' }, { type: 'rideExp', b: 'safari', exp: 'thr', n: 80, text: 'Score 80% Thrills on the Safari Adventure' }],
  },
  {
    id: 'e9', name: 'Any Port in a Storm', setup: 'storm', advisor: 'founder', money: 100000, storms: 3, dna: { camarasaurus: 69 },
    brief: 'Constant storms will hinder your efforts to run a park here. Reach three stars within three years.',
    goals: [{ type: 'stars', n: 3, text: 'Reach a 3-star rating' }, { type: 'withinMonths', n: 36, text: 'Within 3 years', fail: true }],
  },
];

export const CAREER = {
  id: 'career', name: 'Isla Genesis', seed: 4242, money: 60000,
  brief: 'Your investors have given you $60,000 to build a park. Start small, keep your guests safe, and grow Isla Genesis into a 5-star attraction.',
  dna: {},
  goals: [{ type: 'stars', n: 5, text: 'Reach a 5-star rating' }],
  advisor: 'founder', win: 'Five stars! The park is everything I dreamed it could be. The board is delighted.',
};

export const STARTING_UNLOCKED = new Set();
