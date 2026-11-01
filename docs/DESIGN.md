# Road Trip Madness: design notes

This is the living design doc. It describes what the first playable build does and where it is headed.

## Core loop

1. **Plan the trip.** The player searches for a start and a destination (or uses their phone's location for the start). The game asks a routing service for the fastest driving route and shows a preview: the route shape, real distance, and how many places there are to stop.
2. **Drive on rails.** The car follows the real route automatically. The player cannot steer off it. Fuel burns as you go, and a fast-forward button speeds up quiet stretches.
3. **Turn off, or don't.** At specific points along the route a sign and a prompt appear: "Gas station · Dry Creek on the right in 400 m". The player taps **Turn left / Turn right** to pull off, or **Keep driving**. If they do nothing, they pass it. These turn-offs are the only way to leave the road.
4. **Explore the stop.** A stop is a small menu-driven location with places to visit (gas pumps, garage, grocery, gun shop, police station, junkyard, barn, motel and so on). The player can buy fuel, pay for repairs, or search places for supplies. Searching the same place again finds less and is more likely to draw an ambush.
5. **Fight.** Every so often on the road (and sometimes while scavenging) the game cuts to the action view. The car keeps barrelling down the road while enemies close in. The player taps or holds on an enemy to target and shoot it, switches weapons, and uses defensive moves. The fight ends when every enemy is down or when the player gets away (the escape meter fills).
6. **Arrive, or don't.** You win by reaching the destination. You lose if the tank runs dry or the car is wrecked.

## Pacing

Real routes range from a few kilometres to thousands. The game rescales every route so the driving part takes roughly 5 to 25 minutes (about 5 minutes plus a minute per 60 km, capped). Shape is preserved; the world is just shrunk or stretched.

- A full tank lasts about a third of the trip, so every trip needs about three fuel stops.
- There are 6 to 14 turn-off stops per trip. Every third stop is guaranteed to have gas pumps so bad luck can't strand the player. Where the real route has a named left or right turn near a stop slot, the stop snaps to it and takes the road's name.
- Fights come every 7 to 13% of the trip and get bigger and nastier further along.

## Resources

| Resource | Used for | Found at |
| --- | --- | --- |
| Fuel | Driving, Boost in combat | Gas pumps (buy or siphon), garages, barns |
| Car condition | Lose it all and the trip is over | Repaired at garages with scrap or cash |
| Cash | Fuel and repairs | Groceries, pharmacies, motels, outlaws |
| Scrap | Repairs (cheaper than cash) | Junkyards, garages, hardware stores, wrecked enemies |
| Bullets | Machine gun | Gun shops, police stations, outlaws |
| Shotgun shells | Shotgun (splash damage) | Gun shops, hardware stores, police |
| Catnip bombs | Area attack, triple damage to alien cats, stuns others | Pharmacies, groceries, barns, downed saucers |

With no ammo left for a weapon, the player throws rocks. They are weak, but never run out.

## Enemies

- **Zombies** shamble onto the road ahead and drift into your lane. Hitting one hurts the car unless you Boost through it.
- **Outlaw bikers** come up from behind, ride alongside and shoot every couple of seconds.
- **Alien cat saucers** hover ahead, glow purple while they charge, then fire a laser. The Horn interrupts the charge (cats hate loud noises), and catnip bombs hit them three times as hard.

## Defensive actions

- **Steer** left and right across the lanes to dodge zombies.
- **Horn**: stuns zombies and saucers for a few seconds. 8 second cooldown.
- **Boost**: burns 4 fuel for 2.5 seconds of nitro. Plough through zombies without damage, leave bikers behind, and fill the escape meter faster. 6 second cooldown.

## Map data

- Place search: Nominatim (OpenStreetMap). Searches only run when the player presses Search, to respect the one-request-per-second usage policy.
- Routing: the game's own router on the device, over road files built from OpenStreetMap (see "Road files from OpenStreetMap" below). No routing server is used.
- When search or the road files are unreachable, the game falls back to the offline options below, and as a last resort offers a demo route through a made-up desert.
- The screens credit OpenStreetMap contributors as the licence requires.

The game is free and non-commercial, which the public Nominatim and Overpass servers allow at light use. A paid release would need search and the local-streets lookup moved off them.

## Offline play

Phones lose signal on exactly the kind of long drives this game is about, so the game has to work with no connection. The full OpenStreetMap extract for the US is about 10 GB, far too big for a phone, but the game only needs a thin slice of it. Three layers make that work:

1. **Saved trips.** Every route planned online is saved on the device in a slimmed form: the route line simplified to about 25 m, packed as integers, plus the stops, turns and any landmark features that came with it. A cross-country trip is 20 to 60 KB. Up to 25 trips are kept, and the least recently played ones are dropped first when there are more or when storage is full. The title screen lists them under **Saved trips**. When planning fails because there's no connection, a saved trip between the same two places is used automatically.
2. **Offline highway atlas.** The game ships a compact network of US interstates and US and state highways (about 309,000 km of road), built from [Natural Earth](https://www.naturalearthdata.com/) 1:10m data, which is public domain. It holds about 680 cities, plus national parks, peaks and the points where highways cross named rivers. It's about 1.1 MB, or 450 KB gzipped. With no connection:
   - Place search looks up cities and parks in the atlas instead of Nominatim.
   - Route planning runs A* over the atlas on the device. A cross-country trip takes around 40 ms, and its distances come within a few percent of real road distances. The start and end join the nearest highways with a short straight stretch.
   - Cities beside the route become the named turn-offs, on the side of the road they are actually on, and highway changes (for example onto I-40) become left and right turns.
   - The preview tells the player the trip was planned offline and follows the major highways.
3. **Classic road trips.** A handful of famous drives are pre-baked from OpenStreetMap with the game's own router and ship with the game, so they always work: Route 66, the Pacific Coast Highway, New York to Los Angeles, the Overseas Highway to Key West, and the Vegas Run. They carry real exits and speed limits too, and all five together come to about 285 KB.

The game itself is installable. A service worker, generated at build time, precaches the app, the atlas and the classic routes. After one visit, the game opens and plays with no connection, and players can add it to their home screen. Map service requests are never cached by the service worker, because the game saves the trips it plans itself.

Possible later steps are downloadable region packs for detailed routing in one state, and atlases for other countries.

### Rebuilding the offline data

```
sh scripts/fetch-natural-earth.sh data-src/ne        # ~90 MB of Natural Earth GeoJSON
node scripts/build-atlas.mjs data-src/ne public/data/atlas-us.json
npx vite-node scripts/bake-routes.ts                 # uses the road files on the live site (or ROADS=<folder>)
```

### Road files from OpenStreetMap (own routing)

The game plans trips with its own road network instead of the public OSRM server: highways down to US and state routes, built from OpenStreetMap into static files and routed on the phone (`src/offline/roadNet.ts`, A* over the backbone plus the tiles around the start and end). Trips get real exit numbers and posted speed limits from the same data. `src/offline/planner.ts` tries, in order: the road files, a saved trip, and the Natural Earth atlas. When a start or end is more than 300 m from a junction, the router also joins the nearest road part way along, so places on long rural roads (Big Sur, say) start on the road itself. The game no longer uses the OSRM server; it was dropped once the router matched it (New York to Los Angeles 4,472 km against OSRM's 4,497, Route 66 3,516 against 3,503). The service worker keeps road files in their own cache (`roads-osm`) that survives app updates; a new road build replaces them. See the "Own routing plan" doc in the project.

- `.github/workflows/osm-roads.yml` runs monthly (or by hand from the Actions tab). It runs `scripts/fetch-osm-roads.sh` (state-by-state OpenStreetMap extracts, filtered with osmium) and `scripts/build-osm-roads.py`, and stores the result on the `osm-roads` release as `osm-roads.tar.gz`.
- The Pages deploy unpacks that release into `data/osm/` on the site: `index.json`, `backbone.json` (interstates and major highways), `tiles/<x>_<y>.json` (US and state routes per 2° square), `towns.json` and `LICENSE-ODbL.txt`. They are copied in after the build so the service worker doesn't precache them all.
- These files are OpenStreetMap data and stay under the ODbL; the game's code is not affected.
- **Local streets at each end** (`src/geo/localStreets.ts`). When online, the planner asks Overpass once per trip for the streets around the start and end (side streets within 2 km, bigger roads within 6 km), while the road files load. The answer becomes a small road file in the same format (extra classes: secondary, tertiary, minor). It joins the highways at the junctions they share, and streets that never reach a highway are dropped. So a trip from a home address starts on its own street instead of a straight line to the nearest highway. If the lookup fails or takes over 12 seconds, the trip keeps that straight link. A saved trip keeps its streets for offline play.

Build them locally (needs osmium-tool and `pip install osmium`; about 14 GB of downloads):

```
sh scripts/fetch-osm-roads.sh data-src/osm
python3 scripts/build-osm-roads.py data-src/osm/roads-*.osm.pbf public/data/osm
STATES="VA WV" sh scripts/fetch-osm-roads.sh data-src/osm-test   # a quick test with two states
```

## Added since the first playable

- **Landmarks and turn signals.** Real rivers, peaks, monuments and attractions from OpenStreetMap (Overpass) are placed along the route, with procedural roadside sights filling the gaps. Choosing a turn starts the blinker on that side.
- **Sound.** Synthesized engine, weapons, enemies and a two-station radio (Web Audio, no files).
- **Car upgrades.** Armour, fuel tank, engine, roof turret and ram plate, three levels each, bought with scrap and cash at garages.
- **Road events and crew.** Oregon Trail-style choices (flat tires, hitchhikers, traders, roadblocks, tractor beams). A gunner, a road dog and a mechanic can join and each helps in their own way.
- **Day, night and weather.** A clock that moves as you drive and search; nights are more dangerous but searches pay more. Rain, dust, fog and snow by region.
- **Town map.** Stops show a small top-down map; tap a building and you walk over to it.
- **Boss fights.** Halfway through the trip either Big Rotten Earl (giant zombie) or Mad Maxine's war rig blocks the road; the Cat Queen's mothership waits just outside the destination. There is no escaping a boss. Its big attack lights a lane red first, so steering out of it dodges the hit, and it calls in minions of its kind.
- **Difficulty and high scores.** Sunday drive, Road trip and Madness change starting supplies, enemy health and damage, fuel use and how often fights happen. A score (distance, kills, bosses, a finish bonus) is scaled by difficulty and the top ten are kept on the device.
- **Real places.** Stops sit at real towns from the map, or borrow a nearby town's name ("Tulsa Quik Fill"). Fuel stops are real gas stations from OpenStreetMap when online. Green guide signs with interstate/US/state shields mark where the route changes road, and the HUD shows the road you're on.
- **Lanes by road type.** From the real road names: interstates and freeways are divided, two lanes each way in the country and four each way near cities (see phase 2 below); US and state highways are four lanes with a double yellow; other roads are two-lane. Widths taper between types and interstate exits are always on the right.
- **Climate.** Ten biomes from a rough US climate map (latitude bands elsewhere) set the ground, plants (saguaros, sagebrush, prairie grass, cornfields, oaks, pines, palms), sky tint and weather as you drive.
- **Graphics quality (build plan phase 1).** Low, Medium or High, picked for the device (weak devices Low, phones Medium, computers High) and changeable in the pause menu. It sets the pixel ratio, sun shadows (Medium and High), how far ahead scenery is built, how many plants line the road, and a soft bloom glow (High only, loaded on demand). A sky dome blends from the horizon colour to a deeper overhead colour, with a sun that crosses the sky with the clock and a moon at night. The light and shadows follow the sun's position, and the hour and weather now blend smoothly every frame instead of jumping.
- **Real road details (build plan phase 2).** Interstates are two lanes each way in the country and four each way within about 25 km of the start and end and 12 km of any city of 50,000+. The car cruises faster on interstates and slower in town, and the HUD shows the usual speed limit. State lines come from simplified Natural Earth outlines (`public/data/states-us.json`, built by `scripts/build-states.mjs`): a blue "Welcome to" sign marks each one, and interstate turn-offs get an exit number worked out the US way (miles from the state's west border for even interstates, south border for odd ones; approximate, since the real count starts where the interstate enters the state). Real sights link to Wikipedia from their map tags, or to a Wikipedia search. The trip preview looks up the current weather along the route and the real local time at the start from Open-Meteo (one request, can be turned off; falls back to the climate weather and 8 AM). Turn-offs show the real cross street from OpenStreetMap; that lookup sits behind a `StreetSource` interface so it can move to the static road files later.
- **Surfaces and models (build plan phase 3).** On Medium and High the asphalt, ground and gravel shoulders use CC0 photo textures from Poly Haven (greyscale detail maps, so the biome still sets the colour; credits in docs/CREDITS.md). The car is shaped from side profiles (sloped hood, raked windshield, mirrors, spoked wheels). Bigger roads have amber reflector posts, interstates have mile markers numbered like the exits, and town buildings have windows that light up after dark.
- **Proper models.** On Medium and High the game loads CC0 low-poly models by Quaternius (credits in docs/CREDITS.md): six traffic cars, the zombie (on the road and in fights), town houses, shops, flats and a hospital facing the road, crops, bushes, cacti and rocks. Trees (oaks, pines, palms, dead trees) are heavier, so they swap in on High only. Each model is one vertex-coloured mesh with no textures, about 1 MB for all 35, shared and instanced. Low keeps the hand-built shapes, and if the models fail to load the game falls back to them too. City towers taller than the models stay as boxes. `scripts/build-models.py` rebuilds the files.
- **Models built in code.** Things the CC0 packs don't cover are modelled in code (src/scenes/samples.ts) and used on Medium and High: the biker outlaw on a chopper, the tabby alien cat in its saucer, the Cat Queen's two-deck mothership, the brute in overalls with a stop sign, the war rig (spiked plough, skull, armoured trailer, turret), traffic pickups, box vans, semis and motorcycles (new to traffic, about 1 in 20 vehicles), and a smoking wreck. Low keeps the box shapes.
- **Traffic and driving control (build plan phase 4).** Cars, pickups, vans and trucks drive both ways, busier on city interstates and near the start, end and big cities (`src/game/traffic.ts`, pure logic with tests). The player changes lanes with the ◀ ▶ buttons (or arrow keys / A and D) and sets a speed with − and + (60–130% of the road's cruise speed). The car brakes on its own behind slower traffic. On undivided roads you can pull into the oncoming lane to pass; a head-on hit costs more than a rear-end, trucks hurt more, and the ram plate softens it. Fast-forward drives through traffic.
- **Road obstacles (build plan phase 4).** Small threats sit in your lanes: junk, a lone zombie, a burnt-out wreck or a barricade (`src/game/obstacles.ts`). Change lanes to dodge, drive through to ram (costs car health: a roadblock hurts most, the ram plate softens it, and a full plate shrugs off zombies), or tap the 🔫 button that appears (space or F on a keyboard) to shoot: bullets first, then shells, the roof turret adds damage, and big ones take several hits and pay scrap. Easier settings space them further apart. Traffic swerves around them. Big fights and bosses still use the separate fight view.
- **Vehicle types (build plan phase 4).** Pick a ride on the trip preview (`src/game/rides.ts`): the muscle car is the all-rounder; the motorcycle is faster, changes lanes and steers quicker, uses little gas and dodges about a third of hits in fights, but has 60% of the car's health, a small tank, less ammo and hurts more when it crashes; the pickup truck is slower and thirstier but has 150% health, a bigger tank, half again the ammo, a heavier gun and shrugs off rams. A full tank takes every ride about the same distance. Older saves default to the car.
- **Bike rescue (build plan phase 4).** The first time the tank runs dry there's an old bicycle in the ditch (`src/game/rescue.ts`). Ride it to the nearest stop with pumps, ahead or behind, and bring back a can holding 30% of a tank: bought at the normal price, or a smaller siphoned can when you're broke. It takes hours of game time (16 km/h with the can, both ways), and the ride back can go wrong (a zombie spills some of the gas, raiders take cash), more often at night and on long rides. Run dry a second time and the trip is over.
- **Procedural scenery offline (build plan phase 5).** When the map has little to show (offline atlas trips, or quiet stretches online), the made-up sights come closer together and suit the land: buttes and ghost towns in the desert, farmsteads (red barn, silo, farmhouse) and grain elevators on the plains and in farm country, fire lookouts in the woods and mountains (`SIGHTS_BY_BIOME` in `src/game/landmarks.ts`). Every town sign, real or made up, now grows a town around it, with a bigger, taller spread for cities of 50,000+. Turn-offs the map doesn't name get a fitting made-up cross street (Main St in town, Frontage Rd at an interstate exit, County Rd 12 or Mesa Rd out in the country), and a real name from the map replaces it when one is found. Made-up sights never get Wikipedia links.

## Ideas for next steps

- Real building footprints and road names at stops.
- More enemy types and bosses that change with the region.
- Online leaderboards.
- Package for app stores with Capacitor.
- Offline region packs for detailed routing in one state, and atlases beyond the US.

## Round two (build plan, 2026-11-01)

- **Dashboard and swipes (phase 1).** A dashboard above the driving buttons shows your speed in big numbers, the clock and live fuel economy (mpg, from the ride, engine upgrades and difficulty). Swipe on the road to drive: sideways changes lanes, up speeds up, down slows down. The lane and speed buttons stay as a backup, and the middle one now shows the posted limit. A one-time hint explains the swipes.
- **Speed costs fuel (phase 2).** Fuel use per mile follows the throttle: flat out (130%) burns 60% more, and easing off to 60% saves 20%. The mpg readout shows it live. Speeding also adds risk: the car notices slower traffic later (brake range shrinks with the square of the throttle), so you can rear-end someone, and crash damage grows the same way. A tip explains it the first time you speed.
- **Road rage (phase 3).** The gun can hit traffic as well as obstacles: the nearest thing in your lane, or a hostile driver close by in any lane. A car takes 3 shots (bike 1, pickup or van 4, big rig 8), leaves a wreck in the road and gives scrap. Every driver you hit turns hostile, and every hit and wreck fills a rage meter (😡, shown only when above zero). Above 40 rage, up to 60% of the drivers you meet are hostile too (a red marker over the roof). Hostile drivers pace you and shoot while they are within 45 units, with no fight scene; motorcycles dodge more. Rage cools by 30 per 1000 units driven. Fast-forward pauses the shooting.
- **Fights match the road (phase 4).** The fight view is laid out like the road you were on (src/game/fightRoad.ts): a two-lane road with a yellow centre line, a four-lane highway with a double yellow line, or a divided interstate with shoulders, a grass median and the oncoming carriageway beyond (city interstates get four lanes). The roadside has the biome's plants and rocks (CC0 models on Medium and High, trees on High; simple shapes on Low), and the ground colour, time of day and weather already followed the trip. Fight rules are unchanged: your side of the road is centred where the car swings.
- **Bridges and tunnels (phase 5).** The road build (scripts/build-osm-roads.py) now keeps OpenStreetMap bridge and tunnel spans of 60 m or more on each road piece (an optional 11th edge field, `[startMeters, endMeters, kind]`). The on-device router turns them into points along the trip, and src/game/structures.ts keeps the notable ones: bridges of 250 m or more (mostly rivers and valleys) and tunnels of 100 m or more, at least 700 units apart, each drawn long enough to read at speed. Bridges get water on both sides, girders, piers and railings; tunnels get a hill over the road, concrete portals and a lit, square-arched tube that the chase camera stays inside. Scenery keeps clear of both, and a bridge is skipped where a river landmark already draws its own crossing. Offline (atlas) trips keep the atlas's river crossings, which draw a bridge. Older road files without spans still work.
- **Fast landmark scouting (phase 6).** Landmarks no longer come from the public Overpass server on every trip, which took a minute or more when it was busy. The monthly road build now also keeps named towns and villages, peaks, sights (attractions, viewpoints, monuments, towers, lighthouses, windmills, castles), gas stations and river crossings near the highways (scripts/osm_features.py), in `features/<x>_<y>.json` files on the same 2 × 2 degree grid as the road tiles. A trip loads the squares it passes through and keeps what is near its route at the old lookup's distances (src/offline/features.ts), so scouting takes a moment and works offline once cached. Rivers are kept only as short pieces around each highway crossing. With a road build made before this, the live lookup still runs, but planning waits at most 8 seconds for it and offers a "Skip landmark scouting" button; the atlas's sights fill in when it gives up.

## Round three (build plan, 2026-11-01)

- **Controls and install (phase 1).** Fights take swipes on the screen: a quick sideways swipe steers (and keeps steering while the finger stays down, plus a moment after), swipe up boosts and swipe down eases off. Only a drag of 36 px or more within half a second counts as a swipe, so taps and held aim still shoot. On the road, double-tap a car or obstacle to shoot it (src/game/gestures.ts; `DriveScene.pick` finds what is drawn nearest the tap, with a forgiving radius); the side gun button is gone, and the F key still fires at what is ahead. The title screen has an Install app button: the browser's own install prompt on Android and desktop Chrome, a picture guide (Share, then Add to Home Screen) on iPhone and iPad, and nothing once the game runs as an installed app (src/ui/install.ts).
- **Fixes.** The turn signal stops once the car has turned in (it kept blinking and ticking in town). Opening a "read about it" link, or leaving the page any other way, pauses the trip with the pause menu open.
- **Narration (phase 2).** The device's own voice (speechSynthesis, no network needed) reads road events with their choices and outcomes, every card that pops up (arrivals, boss intros, fight results), the name of each stop as you reach it, the turn-off signs, fight titles and tips (src/audio/narrator.ts). Emoji are dropped so the voice reads plain words, and a new line cuts off the last so it never falls behind. Tap a card anywhere but its buttons to hear it again. It is off by default, switched in the pause menu ("Narration"), and kid mode turns it on. The pause menu and the garage stay quiet.
- **Animated event scenes (phase 3).** Each road event card opens with a 4-second 3D scene acting it out (src/scenes/eventScene.ts): a tyre bursting, a hitchhiker or dog waving you down, crates flying out of a wreck, coins and goods trading hands at a stall, a saucer's tractor beam lifting the car, outlaws popping up behind a barricade, a bridge crumbling ahead, and a bicycle with a gas can when you run dry. Then the event's big icon pops in. Tap the scene to skip it. It draws in its own small canvas, freed as soon as it ends; scene time is paced per frame, so a slow phone plays it whole rather than skipping. Medium and High use the game's models (car, outlaws, saucer, wreck); Low uses simple shapes. On by default, with "Event scenes" in the pause menu; kid mode keeps them on.
- **Kid mode (phase 4).** One switch on the title screen (src/game/kidMode.ts), remembered on the device. It turns narration and event scenes on, starts every trip on the easiest difficulty (the difficulty picker is replaced by a note), cuts event and outcome text to its first sentence, shows at most three big choices, each with a picture (the ones you can pick first, and the way out always kept), shows supplies as pictures with little bars instead of numbers, brings back a big shoot button for whatever is ahead instead of double-tap, and shortens the fight hint to "Tap the bad guys!".
- **Enemies fight back, zombie hordes (phase 5).** Every attack is readable before it lands: an enemy about to strike blinks a yellow marker for a wind-up (0.6 s), its shot or throw is drawn (tracer and muzzle flash, or an arcing piece of junk), and a hit flashes the screen red. Some zombies stand up the road and throw junk (5 damage; steer out of the landing spot), and some grab onto the car and claw it (3 damage every 1.6 s) until you shake them off by steering for most of a second or boosting. More zombies fight back later in a fight. Outlaws wind up before each shot. A zombie fight may instead be a **ZOMBIE HORDE!**: 20 to 40 one-hit zombies in 3 or 4 waves that spread across the road and close in on the car. Running one over is a small bump (a quarter of a normal ram) and counts as a kill. Hordes are likelier on harder difficulty (20, 35, 50 %) and on city roads (+25 %), and are capped at 20 on Low graphics and in kid mode. They are drawn as one instanced mesh (the zombie model on Medium and High, merged boxes on Low).
