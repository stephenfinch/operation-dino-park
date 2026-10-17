# Isla Genesis

A dinosaur park builder for the browser, made as a from-scratch homage to *Jurassic Park: Operation Genesis* (2003). All names and sounds are original. The 3D art uses three public-domain (CC0 1.0) packs:

- Dinosaurs: Quaternius' [Animated Dinosaur Pack](https://quaternius.com/packs/animateddinosaurs.html), recoloured per species (`assets/models/quaternius/`).
- Trees, plants and rocks: Quaternius' [Ultimate Nature Pack](https://quaternius.com/packs/ultimatenature.html) (`assets/models/quaternius-nature/`).
- Feeder goats and cattle: Quaternius' animated Cow, from the official Quaternius account on [Poly Pizza](https://poly.pizza/u/Quaternius) (`assets/models/quaternius-farm/`, unused animations trimmed). The goat is the same model, smaller and recoloured.
- Guests: Quaternius' Animated Men and Animated Women packs, from the official Quaternius account on [Poly Pizza](https://poly.pizza/u/Quaternius) (`assets/models/quaternius-people/`). Shirts and dresses are tinted per guest.

Each folder keeps the pack's licence file. Buildings, fences, vehicles and terrain are built procedurally, textures are drawn on canvas at load time, and sound is synthesized with the Web Audio API.

Version 2 moves the look, interface and rules much closer to the original. The timings and balance numbers come from the owner's own copy of the game, written up in [docs/og-reference.md](docs/og-reference.md). No art, text, audio or code from the original is included.

Build fences and paths, fund fossil digs around the world, extract DNA, hatch 25 species, keep them comfortable, and keep your guests alive. Progress saves to the browser's local storage.

## Play

**Local, no build step:**

```bash
npm start
```

Then open http://localhost:8765. (`npm start` runs `tools/serve.py`, a tiny no-cache static server. Any static server works. ES modules can't load from `file://`.)

**Single-file build** (bundles Three.js, runs offline by double-clicking):

```bash
npm install
npm run build
```

This writes `dist/standalone.html` (open directly) and `dist/isla-genesis.html`. Both embed the dinosaur models. `dist/isla-genesis.html` is the same page without the `<html>`/`<head>` wrapper, for publishing as a claude.ai artifact.

## Game modes

| Mode | What it is |
|---|---|
| Operation Genesis | Generate an island (size; round, square, star, long, crescent, twin peaks, deep bay, peninsula, lagoon or separate islands; trees, rivers, mountains). Start with $60,000, one hunting ground already owned with a team digging there, and enough DNA for one small herbivore and one small carnivore. Place your Park Entrance, build, open the park, and aim for 5 stars. A board meeting reviews you every quarter. |
| Exercises | Nine, as in the original: four tutorials (controls; fossils and DNA; what visitors want; safety) and five scenarios (open-range herbivores, a classic island, cleaning up a breeding island, a carnivore island, a stormy island). |
| Missions | Ten action missions in the original's four kinds. Safari: drive a Land Cruiser freely and photograph dinosaurs (by behaviour, weather or points; carnivores charge the car). Ranger Attack: retire carnivores from the helicopter with limited ammunition and a timer, or shoot out haywire hatcheries. Dino Muster: herd herbivores into a muster area with the helicopter's muster (press M). Ranger Rescue: fly or drive a VIP to safety. |
| Site B | Unlocked by finishing every mission or reaching 5 stars (or type `genesis` on the main menu). No fences, no visitors; only hatcheries, feeders and lures. |
| Sandbox | Unlimited money, all research done, every genome at 100%. |

## What's simulated

Rules, prices and behaviour follow the original as documented by its fan wiki and archive (see [docs/wiki-gaps.md](docs/wiki-gaps.md)) and the owner's own game files ([docs/og-reference.md](docs/og-reference.md)).

- **Build menu** in the original's eight categories: Paths (path, Trash Can, Bench, Fountain), Cleaner Station, Attractions, Environment, Amenities, Enclosures, Security, Demolish, at the original's prices.
- **Park Entrance**: you place it ($5,000; more than one allowed). Guests fly in to its helipad. Open and close the park, set the entry fee, or **declare an emergency** (guests run to Visitor Shelters; no fatality fines while it lasts).
- **Amenities**: Kiosk (meal, side order and price; each sale has a production cost), Rest Rooms, Souvenir Stand (souvenir plus optional free gift), Rest Area.
- **Attractions**: Viewing Vent (built against a fence), Viewing Platform, Viewing Dome (access door on the path, glass dome inside the enclosure), Balloon Tour (route poles; grounded in storms; lightning can bring it down and strand guests), Safari Adventure (station on a fence, up to 800 m of track; large carnivores and Triceratops wreck Land Cruisers). Viewing buildings take a **theme** for one kind of guest (Thrill Window, Playpen, Wonder Window and so on).
- **Guests**: Mainstream, Thrill Seekers, Fun Lovers and Dino Nerds, each judging enclosures by thrills, fun or authenticity (same era and dig site, friend species together). Needs: food and drink, rest rooms, rest (benches, Rest Areas), clean paths. Litter builds up on busy paths; Trash Cans and cleaners deal with it. Each guest has a passport of remarks.
- **Enclosures**: Low, Medium and High fences in sections of three panels (Medium and High need research; clicking a weaker fence upgrades the whole line one step for the difference). Hatchery batches of up to five (extra eggs half price), released one at a time, full-grown. Herbivore Feeders (modern or paleo bales) and Carnivore Feeders release live goats or cows that the carnivores hunt. Auto Lures.
- **Security**: Ranger Station ($6,000, $500 a month) with rangers (repairs, vaccinations, adrenaline for animals in a coma) and a helicopter (sedate, move, retire, rescue stranded guests; limited fuel). Security Cameras (raise the breakout alarm), Avoidance Beacons, Sentry Turrets (automatic or under your control), Visitor Shelters (40 guests).
- **Research**: the original's tree and costs, one project at a time; vaccines need a case of the disease first; Hatchery Immunization, Super Extractor, Growth Booster, Weather Guard (umbrellas, lightning protection), Retire, Gyro Stabilizer, Double Battery, Binoculars.
- **Dinosaurs**: 25 species in the original's four classes, with the original's costs, health, lifespans, herd sizes, friend species and favourite prey. Each predator hunts only its own kinds of prey; prey flees early or fights back (Triceratops, Ankylosaurus, Stegosaurus, Styracosaurus and others, with the original's one-blow kills). Only certain species rampage (others fall into a coma); only Tyrannosaurus, Spinosaurus and Carcharodontosaurus break High fences; raptors climb lower fences at weak spots; Brachiosaurus is never hunted; Kentrosaurus panics near big herbivores; content herbivores play; Pachycephalosaurus and Torosaurus butt heads to lead the herd; Tyrannosaurus fights death duels. Six diseases (three can kill); modern plants cause Gastric Poisoning; vaccinated animals are immune for life.
- **Fossils**: you hold up to five hunting grounds (one more per star); each has three areas holding 2–4 teams; every dig takes 240 s; areas wear from Rich to Exhausted; teams cost $0 / 5k / 10k / 15k / 20k; finds include fossils, amber, gold, silver and opals; the Fossil Market sells 1–5 star finds and opens 15 weeks after the park opens.
- **Weather**: sunny, overcast, rain (plants spread), heatwave (thirst, trees die), thunderstorm (lightning, power cuts), twister. A forecast warns of twisters two months ahead.
- **Reports**: Performance (plus a quarterly board meeting), Visitors, Security, Dinosaurs (genome, population, lifespan), Finance, Structures, Entertainment (thrills, fun and authenticity per attraction).
- **Dinopedia** on the main menu and the Dinosaurs menu.
- **Board**: a park still in debt at two quarterly meetings in a row is closed.
- **Cheat codes**: the original's PC key sequences (arrow keys and [ ]).

## Controls

| Input | Action |
|---|---|
| W A S D / arrows | Move the camera |
| Q / E | Rotate |
| R / F, mouse wheel | Zoom in / out |
| Page Up / Page Down | Tilt |
| Tab | Island map |
| Right-drag | Rotate and tilt |
| Left-drag (select mode), middle-drag | Pan |
| Shift-drag with a fence tool | Straight fence line |
| Right-click | Cancel tool / deselect |
| R | Rotate a building while placing |
| X or Delete | Bulldoze tool |
| G | Toggle grid |
| Space | Pause (take a photo while riding) |
| 1 / 2 / 3 | Game speed |
| C | Centre on selection |
| Esc | Close / cancel / exit ride |
| H | Help |

## Code layout

| File | Role |
|---|---|
| `js/main.js` | Boot, main loop, game lifecycle |
| `js/game.js` | World ownership, building/fence/path rules, ACU tasks, escapes, disasters, photos, presets, save serialization |
| `js/park.js` | Clock, economy ledger, rating, weather, research, expeditions, hatcheries, missions |
| `js/dino.js` | Dinosaur AI and animation |
| `js/visitors.js` | Guests (instanced rendering) |
| `js/staff.js` | Rangers, ACU helicopter, safari jeeps, balloon |
| `js/map.js` | Tile map, fences on edges, regions, A*, BFS fields |
| `js/models.js` | Procedural low-poly models |
| `js/world.js` | Terrain, paths, instanced fences and flora, building meshes |
| `js/engine.js` | Renderer, camera, lighting, sky, water, rain, twister |
| `js/ambient.js` | Clouds, pterosaurs, helipad |
| `js/ui.js`, `js/hud.js`, `js/icons.js`, `js/thumbs.js` | Menus and modals; in-game HUD (medallions, build wheel, mailbox); SVG icons; 3D-rendered thumbnails |
| `js/textures.js` | Canvas-generated textures (grass, skin, flagstone, foliage, bark, water) |
| `js/tools.js` | Mouse/keyboard tools with previews |
| `js/audio.js` | Synthesized sound and music |
| `js/save.js` | Local storage save slots, autosave, import/export |
| `js/data.js` | Species, buildings, research, dig sites, diseases, missions |

Dev helpers: `tools/gallery.html?show=species|buildings|misc` renders every model; `tools/bot.js` plays a park for balance testing (`const bot = await import('/tools/bot.js'); bot.setup(); bot.run(5)` in the console).
