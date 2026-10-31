#!/bin/sh
# Downloads the Natural Earth layers that scripts/build-atlas.mjs needs.
# Natural Earth is public domain: https://www.naturalearthdata.com/about/terms-of-use/
set -e
DIR="${1:-data-src/ne}"
BASE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
mkdir -p "$DIR"
for f in ne_10m_roads ne_10m_populated_places_simple ne_10m_parks_and_protected_lands_point \
         ne_10m_geography_regions_elevation_points ne_10m_rivers_lake_centerlines ne_10m_rivers_north_america; do
  [ -s "$DIR/$f.geojson" ] || curl -fsSL -o "$DIR/$f.geojson" "$BASE/$f.geojson"
done
echo "Natural Earth layers in $DIR"
