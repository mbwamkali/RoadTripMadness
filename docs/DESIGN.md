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
- Routing: the public OSRM demo server, asking for full geometry and turn-by-turn steps.
- When either service is unreachable, the game falls back to the offline options below, and as a last resort offers a demo route through a made-up desert.
- The screens credit OpenStreetMap contributors as the licence requires.

Before a public release, routing and search should move to our own OSRM/Nominatim instances or a commercial provider, because the free public servers are for light use only.

## Offline play

Phones lose signal on exactly the kind of long drives this game is about, so the game has to work with no connection. The full OpenStreetMap extract for the US is about 10 GB, far too big for a phone, but the game only needs a thin slice of it. Three layers make that work:

1. **Saved trips.** Every route planned online is saved on the device in a slimmed form: the route line simplified to about 25 m, packed as integers, plus the stops, turns and any landmark features that came with it. A cross-country trip is 20 to 60 KB. Up to 25 trips are kept, and the least recently played ones are dropped first when there are more or when storage is full. The title screen lists them under **Saved trips**. When planning fails because there's no connection, a saved trip between the same two places is used automatically.
2. **Offline highway atlas.** The game ships a compact network of US interstates and US and state highways (about 309,000 km of road), built from [Natural Earth](https://www.naturalearthdata.com/) 1:10m data, which is public domain. It holds about 680 cities, plus national parks, peaks and the points where highways cross named rivers. It's about 1.1 MB, or 450 KB gzipped. With no connection:
   - Place search looks up cities and parks in the atlas instead of Nominatim.
   - Route planning runs A* over the atlas on the device. A cross-country trip takes around 40 ms, and its distances come within a few percent of real road distances. The start and end join the nearest highways with a short straight stretch.
   - Cities beside the route become the named turn-offs, on the side of the road they are actually on, and highway changes (for example onto I-40) become left and right turns.
   - The preview tells the player the trip was planned offline and follows the major highways.
3. **Classic road trips.** A handful of famous drives are pre-baked from OpenStreetMap and OSRM and ship with the game, so they always work: Route 66, the Pacific Coast Highway, New York to Los Angeles, the Overseas Highway to Key West, and the Vegas Run. All five together come to about 115 KB.

The game itself is installable. A service worker, generated at build time, precaches the app, the atlas and the classic routes. After one visit, the game opens and plays with no connection, and players can add it to their home screen. Map service requests are never cached by the service worker, because the game saves the trips it plans itself.

Possible later steps are downloadable region packs for detailed routing in one state, and atlases for other countries.

### Rebuilding the offline data

```
sh scripts/fetch-natural-earth.sh data-src/ne        # ~90 MB of Natural Earth GeoJSON
node scripts/build-atlas.mjs data-src/ne public/data/atlas-us.json
node scripts/bake-routes.mjs                          # needs router.project-osrm.org
```

### Road files from OpenStreetMap (own routing, in progress)

To stop depending on the public OSRM server, the game is getting its own road network: highways down to US and state routes, built from OpenStreetMap into static files and routed on the phone. Phase 1 builds the files; the router comes next. See the "Own routing plan" doc in the project.

- `.github/workflows/osm-roads.yml` runs monthly (or by hand from the Actions tab). It runs `scripts/fetch-osm-roads.sh` (state-by-state OpenStreetMap extracts, filtered with osmium) and `scripts/build-osm-roads.py`, and stores the result on the `osm-roads` release as `osm-roads.tar.gz`.
- The Pages deploy unpacks that release into `data/osm/` on the site: `index.json`, `backbone.json` (interstates and major highways), `tiles/<x>_<y>.json` (US and state routes per 2° square), `towns.json` and `LICENSE-ODbL.txt`. They are copied in after the build so the service worker doesn't precache them all.
- These files are OpenStreetMap data and stay under the ODbL; the game's code is not affected.

Build them locally (needs osmium-tool and `pip install osmium`; about 14 GB of downloads):

```
sh scripts/fetch-osm-roads.sh data-src/osm
python3 scripts/build-osm-roads.py data-src/osm/us-roads.osm.pbf public/data/osm
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
- **Traffic and driving control (build plan phase 4).** Cars, pickups, vans and trucks drive both ways, busier on city interstates and near the start, end and big cities (`src/game/traffic.ts`, pure logic with tests). The player changes lanes with the ◀ ▶ buttons (or arrow keys / A and D) and sets a speed with − and + (60–130% of the road's cruise speed). The car brakes on its own behind slower traffic. On undivided roads you can pull into the oncoming lane to pass; a head-on hit costs more than a rear-end, trucks hurt more, and the ram plate softens it. Fast-forward drives through traffic.

## Ideas for next steps

- Real building footprints and road names at stops.
- More enemy types and bosses that change with the region.
- Online leaderboards.
- Package for app stores with Capacitor.
- Offline region packs for detailed routing in one state, and atlases beyond the US.
