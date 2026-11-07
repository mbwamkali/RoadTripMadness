# Credits for bundled assets

Greyscale detail maps made from CC0 (public domain) photos on Poly Haven
(https://polyhaven.com/license). They are resized and their contrast is
adjusted so the biome colour still sets the hue.

| File | Source |
| --- | --- |
| asphalt.jpg | Asphalt 02, Rob Tuytel: https://polyhaven.com/a/asphalt_02 |
| ground.jpg | Aerial Grass Rock: https://polyhaven.com/a/aerial_grass_rock |
| gravel.jpg | Gravel Road: https://polyhaven.com/a/gravel_road |

Textures live in `public/textures/`; the originals are fetched into `data-src/tex/`, which is not committed.

## 3D models

Low-poly models by Quaternius (https://quaternius.com), released as CC0 (public domain). They are converted by `scripts/build-models.py` into small vertex-coloured GLB files in `public/models/` (originals are fetched into `data-src/models/`, which is not committed).

| Files | Pack |
| --- | --- |
| car-*.glb | Cars pack |
| zombie.glb | Animated Zombie pack |
| oak-*, pine-*, palm-*, tree-dead, cactus-*, bush-*, grass, corn, wheat, rock-*.glb | Ultimate Nature pack |
| shop, flat-*, hospital, house-*.glb | Simple Buildings pack |

## Detailed models (visual overhaul)

Files in `public/models/hd/` were generated for this game from its own concept pictures (FLUX.1 schnell, Apache 2.0, on Comfy Cloud and locally):

| Files | Made with |
| --- | --- |
| car, pickup, saucer, earl, warrig, hermit, pizza, sweeper, karen, drone, zombie, outlaw, alien_cat, cow, armadillo, sedan, van, semi | Tripo image-to-3D via Comfy Cloud (https://www.tripo3d.ai) |
| b/*.glb, b/lod/*.glb (buildings, houses, landmarks) | Microsoft TRELLIS.2 (MIT, https://github.com/microsoft/TRELLIS.2) in ComfyUI on our own PC |

All were shrunk for phones with glTF Transform (MIT, https://gltf-transform.dev): quantised meshes, WebP textures, and for buildings simplified to about 6k triangles (3.5k for the roadside copies in `b/lod/`).

The people in `people/` (the player on foot, the hitchhiker, the cyclist and the Cat Queen) were rigged and given their looping moves for this game with Blender (https://www.blender.org), by `scripts/rig-people.py`.

`ground_n.jpg` and `asphalt_n.jpg` are bump (normal) maps computed from `ground.jpg` and `asphalt.jpg`.

## Car radio (public/audio)

The four songs (Home Stretch, Evening Drive, Desert Highway, Cat Queen Creep) are written for this game in `src/audio/songs.ts` and played on recorded sounds:

| Files | Source | Licence |
| --- | --- | --- |
| `inst/<instrument>/<midi>.mp3` | FluidR3 GM soundfont by Frank Wen, pre-rendered by Benjamin Gleitzman (https://github.com/gleitz/midi-js-soundfonts). Only the notes the songs use, picked by `scripts/build-music-samples.mjs`. | CC BY 3.0 |
| `drums/*.mp3` | Versilian Community Sample Library (https://github.com/sgossner/VCSL): Bass Drum 1, Snare Drum Modern 1, Hi-Hat, Suspended Cymbal 1, Shaker Small, Tom 1. Trimmed and levelled. | CC0 |
| `cats/meow4.mp3`, `cats/purr.mp3` | "Cat purr & meow" by kerzoven (https://opengameart.org/content/cat-purr-meow) | CC0 |
| `cats/meow1.mp3` | "Meow" by ignasd (https://opengameart.org/content/meow) | CC0 |
| `cats/mew2.mp3` | "Kitten mew" by antumdeluge (https://opengameart.org/content/kitten-mew) | CC0 |
| `cats/meow3.mp3`, `cats/screech1.mp3`, `cats/screech2.mp3`, `cats/hiss.mp3` | "Cat SFX" by macro (https://opengameart.org/content/cat-sfx) | CC BY 3.0 |

The cat sounds are trimmed, cleaned of low hum and levelled; in the game each meow is retuned to the note it lands on.

Other bundled data: the offline atlas and US state outlines come from Natural Earth (public domain); classic routes, map features and each town's streets and shops from OpenStreetMap (© OpenStreetMap contributors, ODbL); live weather from Open-Meteo (CC BY 4.0); the weekly U.S. average gas price from the U.S. Energy Information Administration (public domain, https://www.eia.gov/petroleum/gasdiesel/), which game prices follow.
