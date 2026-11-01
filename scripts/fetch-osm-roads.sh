#!/bin/sh
# Downloads OpenStreetMap data for the lower 48 states and DC, one state at a
# time, and keeps only what scripts/build-osm-roads.py needs: highways down to
# primary roads, motorway exits, and towns. Each full state file is deleted as
# soon as it is filtered, so this needs only about 2 GB of free disk.
#
# usage: sh scripts/fetch-osm-roads.sh [work_dir]   (default data-src/osm)
# Needs osmium-tool. Result: <work_dir>/us-roads.osm.pbf
#
# Source: state extracts of OpenStreetMap cut by movisda
# (https://osm.download.movisda.io), updated daily. The data is © OpenStreetMap
# contributors, under the ODbL.
set -eu
DIR=${1:-data-src/osm}
BASE=https://osm.download.movisda.io/admin
STATES=${STATES:-"AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"}
mkdir -p "$DIR"
for s in $STATES; do
  out="$DIR/roads-$s.osm.pbf"
  [ -s "$out" ] && continue
  echo "== $s"
  curl -fsSL --retry 4 --retry-delay 10 -o "$DIR/US-$s.osm.pbf" "$BASE/US-$s-latest.osm.pbf"
  osmium tags-filter --overwrite --no-progress -o "$out" "$DIR/US-$s.osm.pbf" \
    w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link \
    n/highway=motorway_junction n/place=city,town
  rm -f "$DIR/US-$s.osm.pbf"
done
osmium merge --overwrite --no-progress -o "$DIR/us-roads.osm.pbf" "$DIR"/roads-*.osm.pbf
ls -l "$DIR/us-roads.osm.pbf"
