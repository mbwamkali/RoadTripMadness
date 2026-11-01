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

Other bundled data: the offline atlas and US state outlines come from Natural Earth (public domain); classic routes and map features from OpenStreetMap (© OpenStreetMap contributors, ODbL); live weather from Open-Meteo (CC BY 4.0).
