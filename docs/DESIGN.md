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
- When either service is unreachable, the game offers an offline demo route through a made-up desert.
- The screens credit OpenStreetMap contributors as the licence requires.

Before a public release, routing and search should move to our own OSRM/Nominatim instances or a commercial provider, because the free public servers are for light use only.

## Ideas for next steps

- Pull real buildings and road names along the route from OpenStreetMap (Overpass) instead of procedural scenery.
- A proper "town map" explore screen: a small top-down map of the stop where you pick which building to walk into.
- Car upgrades (armour plates, bigger tank, turret types) bought with scrap.
- More enemy types, boss fights at the destination, and weather/day-night.
- Sound and music, haptics on hits.
- Package for app stores with Capacitor, and add offline caching of a planned route.
