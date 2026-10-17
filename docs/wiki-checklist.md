# Claim-by-claim checklist (wiki + archive)

Every gameplay claim found in the saved wiki pages (jpog.fandom.com) and the JP-Genesis Archives, checked against our code.
[x] matches, [~] partly / approximated, [ ] open, [-] not doing (reason). Facts only; no text copied.

## Species behaviour (dinosaur pages)
- [x] Each predator has its own prey list (`huntable` in js/dino.js): Dilophosaurus only unarmed small herbivores (Kentrosaurus when hungry); raptors anything but Ankylosaurus and Brachiosaurus (Camarasaurus included); Ceratosaurus small herbivores; Albertosaurus hadrosaurs except Edmontosaurus, Pachycephalosaurus, Styracosaurus when hungry; Allosaurus not Ankylosaurus/Triceratops; Spinosaurus and T. rex anything; Acro/Carcharo Ankylosaurus only when hungry.
- [x] Brachiosaurus never hunted except by a rampaging Spinosaurus; rears up and scares carnivores away; stomping does no damage.
- [x] Allosaurus is food for the other large carnivores; small carnivores are prey for hungry large ones.
- [x] Cannibalism: Ceratosaurus when starving; Albertosaurus picks off weak or sick members of its own kind.
- [x] Dilophosaurus kills raptors only when desperate; a rampaging raptor may attack a sleeping or sedated T. rex.
- [x] Acrocanthosaurus and Carcharodontosaurus share an enclosure peacefully.
- [x] Allosaurus is cowardly: never picks territorial fights with large carnivores and runs rather than fights back.
- [x] Ceratosaurus lives peacefully with raptors; Dilophosaurus with raptors while both are fed.
- [x] Acro / T. rex / Carcharo get discouraged after several lost fights and run instead; Spinosaurus never does.
- [x] A territorial fight relieves a large carnivore's urge to hunt for a while.
- [x] Prey reacts before it is hit: unarmed animals flee (Gallimimus and Dryosaurus scatter early); everything but its rivals runs from T. rex.
- [x] Triceratops charges any carnivore nearby (except T. rex, its duel rival); Stegosaurus panics and swings its tail when carnivores are near.
- [x] Styracosaurus and Pachycephalosaurus attack small carnivores except Albertosaurus; Torosaurus only defends against small carnivores.
- [x] Kentrosaurus is the only small herbivore that fights back against large carnivores (when attacked).
- [x] One-blow kills: Triceratops kills any small carnivore but Albertosaurus; Torosaurus kills a raptor; Stegosaurus/Ankylosaurus kill an attacking Ceratosaurus; Ankylosaurus kills a Kentrosaurus.
- [x] Tail swings of a panicking Stegosaurus / Kentrosaurus / Ankylosaurus can hit herbivores nearby.
- [x] Kentrosaurus panics around large herbivores (not Stegosaurus).
- [x] Death duels: T. rex vs Spinosaurus / Triceratops / Ankylosaurus / Stegosaurus.
- [x] Herd-leader head-butting: Pachycephalosaurus, Torosaurus (crown).
- [x] Rampagers: large carnivores, raptors, Triceratops; Dilo/Cerato/Alberto go comatose; only T. rex / Spino / Carcharo break High fences; raptors climb Low/Medium.
- [x] Dilophosaurus spits (blinds prey, kills guests); Gallimimus is the only herbivore that can catch rabies.
- [x] Brachiosaurus / Camarasaurus stressed when alone (herd minimum); sauropods browse trees before feeders.
- [x] Large carnivores and Triceratops charge Land Cruisers; Torosaurus rarely (missions).
- [x] Live goats and cattle: the Carnivore Feeder releases one animal at a time and the carnivores hunt it; cows can kick back.
- [x] Sauropods never use feeders (trees only).
- [x] Diseases: Bumblefoot slows, Belly and Flu cut appetite, Belly and Rabies raise thirst, ticks make animals restless and can paralyse, Gastric Poisoning paralyses before death, untreated Rabies ends in a coma; rabid carnivores attack anything, even their own kind. Sick dinosaurs are less appealing and guests complain.
- [x] Thunderstorms and twisters stress dinosaurs; heat stresses thirsty ones.
- [x] Veteran T. rex (more kills) fights better; a young T. rex that has lost to a Spinosaurus backs down.
- [x] Rampaging dinosaurs ignore Avoidance Beacons and can smash them.
- [x] Gallimimus (and Dryosaurus) herds split when larger than six or seven.
- [x] At most four raptors on one animal; raptors riding big prey sometimes fall and hurt themselves.
- [-] Dilophosaurus pack leader frill open: visual only, our model has no frill animation.

## Park systems (building and mechanics pages)
- [x] Fence upgrades go one step at a time (Low → Medium → High), at the price difference.
- [x] Guests on a path see less through Medium and High fences than from an attraction.
- [x] Removing a path under a guest strands them for the helicopter.
- [x] Cameras report breakouts; "also warn of rampages" is a per-camera setting.
- [x] Ranger Station: Muldoon-style welcome message, vaccine list in its panel.
- [x] Research tree rings: ring 2 and 3 items open once the park has opened; Shelter and Camera need a Ranger Station, Binoculars a Viewing Platform, Balloon / Fountain / Souvenir / Rest Area / Weather Guard a Park Entrance.
- [x] Controls: R/F zoom, Q/E rotate, WASD move, Tab island map.
- [x] The original's 32 PC cheat codes (same key sequences of arrows and [ ]), with our own effect names.
- [x] Footpaths limited to 500 pieces (Operation Genesis mode).
- [x] The finance director's board closes a park still in debt at two quarterly meetings in a row.
- [x] Take manual control of a Sentry Turret (aim and fire; it only kills).
- [x] Released carnivores get a live cow (goat for small ones), herbivores a hay bale; newborns stay near the hatchery for about two months.
- [x] Fossil Hunt: every dig takes 240 s; each site has three areas (mountain / plains / river) holding 2–4 teams; gold ores per site (8–12, 90 in all).
- [x] Balloon Tour and Safari get Thrills / Fun / Authenticity scores (Entertainment report, exercise 8).
- [x] Exercises 2 and 4 ask for the fence upgrade itself.

- [x] Building sizes, unit limits and toughness from the archive's building pages; Safari station sits on a fence; cleaners $150 a month, five per station.

- [x] Species numbers from the archive's species pages: cloning cost by stars, health, lifespan at a full genome, largest herd; bites rescaled to the wiki's "two or three bites".

- [x] Occupancy: Viewing Platform 5, Viewing Vent 16, Rest Area 8 guests at once; souvenir costs $1 / $10 / $30.

## Guests
- [x] Four types with the original's tastes; Thrill Seekers in red/black; Dino Nerds dislike feeders/hatcheries in view and mixed eras.
- [x] Freeze in fear before T. rex / Spinosaurus / Acrocanthosaurus / Allosaurus; medium/small carnivores make guests run.
- [x] Deaths: carnivores, twisters, exposure off-path; fines unless an emergency is declared.
- [x] Rides with many species impress (Thrill Seekers most).

## Buildings / park
- [x] Build menu categories, prices, limits, research gates (see wiki-gaps.md).
- [x] Viewing Dome in two parts; Balloon route poles; safari track 800 m; fences in 3-panel sections; fence-line upgrades at the difference.
- [x] Security cameras raise escape / rampage alarms; turrets target none / carn / herb / all; beacons 20 s on / 20 s recharge.
- [x] Visitor Shelter holds 40, shuts when badly damaged; cleaners ignore emergencies.
- [x] Fossil Market opens 15 weeks after the park opens; unaffordable items dimmed; max 20 items.
- [x] Menus: Reports / Dinosaurs / Actions as in the original.
- [x] Building lights on at night and in rain; heatwave kills trees; rain spreads jungle.

## Let's Play archive (lparchive.org)
- [x] At most 100 guests and 60 dinosaurs; entry fees in the hundreds.
- [x] Carnivore Feeders drop a goat or cow every month even with no carnivores; raptors kill livestock for sport.
- [x] Fossils of species with a complete genome are sold automatically.
- [x] Land Cruisers and balloons break down at random; tour cars stop and honk for dinosaurs on the track; driving yourself, you can run over small dinosaurs.
- [x] Rabies makes animals limp and attack anything; shooting healthy dinosaurs upsets guests.
- [x] Five stars completes Operation Genesis (you can continue).
- [x] You can look out from inside the viewing attractions yourself.
- [x] Island generator: shape (4 steps), trees (3), rivers (5), mountains (5), next-island button.
- [-] Raptor toilet animation: cosmetic only.

## Missions (wiki mission pages)
- [x] Ten missions in four kinds with the original's species and goals (see js/data.js MISSIONS).

## Not copied (by design)
- [-] Art, models, textures, voice acting, music, sound effects and on-screen text of the original: copyrighted. We use CC0 models and our own text.
- [-] Characters' names: our own advisors fill the same roles (founder, finance, control room, warden, geneticist, paleontologist, vet, PR, assistant).
- [-] Cut content (Hunting Platform, Petting Zoo, baby dinosaurs, serums, JP Institute): not in the released game.
