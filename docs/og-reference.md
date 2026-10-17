# Original game reference notes

Gameplay numbers and rules from the user's own copy of *Operation Genesis* (2003): the config files that survived a partial download.
They are used only to cross-check and tune Operation Dino Park's behaviour. No text, art, audio or code from the original is copied into this project.

## Time
- 1 game year = 3600 real s; 1 month = 300 s; 1 week = 75 s; 1 day = 10 s.
- The date display is month + year (e.g. JAN 2000). Missions often run for a set number of months.

## Visitors
- Arrive by helicopter in loads of up to 25; arrival interval shortens as the park improves (30 s → 1800 s descriptor range).
- Drives (0..1): hunger, waste (bladder), fatigue, security, satisfaction. Base rates per second: hunger 0.0033, waste 0.0021, fatigue 0.0028, security recovers 0.0017.
- Thresholds: low 0.15–0.2, high 0.85, "bad" 0.95. High hunger/waste costs satisfaction ~0.0033/s; low security costs 0.0167/s (panic below 0.05, calm above 0.5).
- Stay 30–420 s normally (up to 900 s in a full-rated park; hard limit 600 s on the road).
- Starting satisfaction 0.4–0.5, security 0.5. Low entry fee gives a starting bonus.
- Weather: light rain, heavy rain and heat all reduce satisfaction. Crowded roads reduce it too.
- Seeing few dinosaurs for 4+ minutes lowers satisfaction.
- Four visitor interest types: violent (likes carnivores hunting), non-violent (herbivores), environmental (natural, era-correct scenery: water, paleo trees, hills; dislikes buildings/fences/roads in view), neutral (start weighting 1/1/1/3).
- Benches let visitors rest on the road. Security cameras and passing a shelter boost security.
- Litter: roads get dirty (more with more visitors); bins and cleaners reduce it. Cleanliness is noticed below 0.75.
- Off-road visitors get lost, then sick, then may die.

## Dinosaurs
- Cost = class base + 750 × star rating. Bases: small herbivore 500, small carnivore 600, large herbivore 1000, large carnivore 1200. Extra eggs in one batch cost 50%.
- Incubation: 30 s (small) / 40 s (large) real time.
- Lifespan minimum 1800 s (half a game year) at 50% DNA, rising non-linearly with DNA; old age drains health.
- Sleep lasts ~90 s. Grass is poor food (0.1), modern plants 0.5, paleo plants 2.0.
- Unmet hunt need, sickness and panic raise stress. Hunger/thirst drain health.
- Fence damage per hit: small dinosaur 200, large 550. Electric shock back: 30 small / 60 large.
- Rain doubles stress and socialising; heatwaves double water use.
- Disease is checked every 6 s.
- Rangers subdue a rampage over ~100–120 s. Comatose animals slowly lose health.

### Species table (popularity stars, length m, era, dig site, rarity, security)
| Species | ★ | len | era | dig | rarity | security |
|---|---|---|---|---|---|---|
| Acrocanthosaurus | 4 | 13 | Early Cret. | Hell Creek A | uncommon | extreme |
| Albertosaurus | 3 | 8 | Late Cret. | Judith River A | common | low |
| Allosaurus | 4 | 11 | Late Jur. | Tendaguru | common | high |
| Ankylosaurus | 4 | 7 | Late Cret. | Judith River A | uncommon | low |
| Brachiosaurus | 5 | 25 | Late Jur. | Morrison B / Tendaguru | uncommon | low |
| Carcharodontosaurus | 4 | 14 | Early Cret. | Chenini | rare | high |
| Camarasaurus | 3 | 19 | Late Jur. | Morrison B | common | low |
| Ceratosaurus | 2 | 6 | Late Jur. | Morrison A | uncommon | high |
| Corythosaurus | 3 | 9 | Late Cret. | Judith River B | common | low |
| Dilophosaurus | 2 | 7 | Early Jur. | Morrison B | uncommon | medium |
| Dryosaurus | 1 | 3 | Late Jur. | Morrison A | common | low |
| Edmontosaurus | 3 | 13 | Late Cret. | Hell Creek B | uncommon | low |
| Gallimimus | 3 | 6 | Late Cret. | Flaming Cliffs | uncommon | low |
| Homalocephale | 3 | 3 | Late Cret. | Flaming Cliffs | rare | low |
| Kentrosaurus | 2 | 4 | Late Jur. | Tendaguru | uncommon | low |
| Ouranosaurus | 2 | 7 | Early Cret. | Chenini | rare | low |
| Pachycephalosaurus | 2 | 8 | Late Cret. | Hell Creek B / Judith River A | uncommon | low |
| Parasaurolophus | 3 | 10 | Late Cret. | Hell Creek A | uncommon | low |
| Spinosaurus | 5 | 15 | Early Cret. | Chenini | rare | extreme |
| Stegosaurus | 4 | 9 | Late Jur. | Morrison A | common | low |
| Styracosaurus | 2 | 5 | Late Cret. | Judith River B | uncommon | low |
| Torosaurus | 2 | 8 | Late Cret. | Hell Creek A | common | low |
| Triceratops | 5 | 9 | Late Cret. | Hell Creek B | common | high |
| Tyrannosaurus | 5 | 13 | Late Cret. | Judith River B | common | extreme |
| Velociraptor | 5 | 3 | Late Cret. | Flaming Cliffs | uncommon | high |

## Fossils and DNA
- Each of 9 hunting grounds has three dig spots needing 2–4 teams. Base dig time 240 s. Sites are free; each has a small gold chance.
- A dig yields amber 10% / fossil 90%. Failure probability ranges 5–75% as a site is worked out.
- Fossil market opens 15 s after the park opens; buying DNA items costs a 2× premium. Sell prices drift between 0.5× and 1.5×.
- DNA sequencing takes ~60 s per item.

## Park rating and security
- Rating combines dinosaur quality (popularity stars, ramping up over the first hour), visitor satisfaction and security.
- Visitor and staff deaths cut security sharply (0.5 / 0.25). Damaged buildings lower it a little.
- An empty park slowly bleeds rating.

## Weather
- Thunder roughly every 10 s in storms; 20% of thunder brings lightning, which can hit a dinosaur (20%), structure (15%) or fence (15%) for 200 damage.
- Helicopters fly at half speed in bad weather.

## Misc
- Avoidance beacon: radius 100 (world units), emits 20 s then recharges 20 s.
- Safari photos: at most 10 per ride, max payment 200. Photo scoring weights: eating 0.5, hunting 0.6, territory display 0.8, attacking the jeep 1.0, stressed 0.65; already-photographed species ×0.1; idle ×0.4.
- World camera pitch −52° to −5°, distance 12–100, FOV widens from 35° low to 55° high.
- Flora is all tropical/paleo: palms (several kinds), tree ferns, cycads, sago palms, small ferns.

## From the developers' saved test parks (second download)

- World is about 1 km square; buildings sit on a 4 m grid. Unit positions in the saves span roughly 80–900 m on each axis, so playable islands are several hundred metres across.
- New parks start with an entry fee of $200. The fee is set on the park entrance. Fee satisfaction constants: K fee 700, K value 87,500.
- Park state can be closed or open (ParkState field); the park starts closed and is opened by the player.
- Tourist helicopter: period about 134 s with 4 guests per load early on; maximum 25 per trip and at most one trip every 10 s.
- Every hatchery in the saves has a paired power building next to it.
- Building roster seen in saves: visitor centre, toilet, kiosk, drinks fountain, picnic area, gift shop, viewing platform, viewing vent, viewing dome (with hotel-style entry), safari ride, balloon ride, ranger depot, maintenance depot, cleaner, camera, security camera, avoidance beacon, lure, shelter, herbivore and carnivore feeders (bale, goat).
- Visitor models come in 5 kinds: neutral, novice, environmental, violent and VIP. Umbrella colours mark the interest type: red violent, green non-violent, blue environmental, grey neutral.
- Guests near a security camera get a +0.05 security boost (checked every 4 s).
- A guest with heavy rain may think about it (10% chance); 75% chance to skip an attraction already seen.
- Environmental authenticity: base 0.08; water +0.08, paleo trees +0.2, modern trees +0.04, hills (3 m+) +0.15; buildings −0.2, fences −0.1, roads −0.1; wrong-era dinosaurs ×0.15.
