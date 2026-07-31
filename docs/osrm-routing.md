# OSRM Road Routing Engine

This document describes how to set up, operate, and configure the OpenStreetMap Routing Machine (OSRM) service for road-distance and routed-duration calculations using a moped profile.

## Overview

By default, OpenCourier uses `HAVERSINE` (straight-line distance) and `SIMPLE` duration (`distance * 2`). Switching to `OSRM` routes deliveries along real roads and applies a 50cc moped profile (speed cap 45 km/h, motorways banned).

## 1. One-off Data Preparation

Data preparation extracts road network graph data for Greece and bakes the moped profile rules into OSRM format. Requires ~2 GB disk space and ~15 minutes.

```bash
mkdir -p osrm/data
curl -L -o osrm/data/greece-latest.osm.pbf \
  https://download.geofabrik.de/europe/greece-latest.osm.pbf

# extract: applies our moped profile to the raw OSM data
docker run --rm -t \
  -v "$PWD/osrm/data:/data" \
  -v "$PWD/osrm/profiles/moped.lua:/opt/moped.lua" \
  ghcr.io/project-osrm/osrm-backend:latest \
  osrm-extract -p /opt/moped.lua /data/greece-latest.osm.pbf

# partition + customize: the MLD pipeline that osrm-routed --algorithm mld expects
docker run --rm -t -v "$PWD/osrm/data:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-partition /data/greece-latest.osrm
docker run --rm -t -v "$PWD/osrm/data:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-customize /data/greece-latest.osrm
```

## 2. Running OSRM Service

Start the container using the package script:

```bash
yarn docker:osrm
```

Smoke test the running service:

```bash
curl "http://localhost:5000/route/v1/driving/22.9427,39.3621;22.9530,39.3680?overview=false"
```

Expected response code is `"Ok"` with route distance (metres) and duration (seconds).

## 3. Modifying the Moped Profile

The profile is located at `osrm/profiles/moped.lua`. Whenever you edit constants such as `MOPED_MAX_SPEED_KMH` or motorway exclusion rules in `moped.lua`, you **must re-run the extract, partition, and customize commands above**. The routing speeds are compiled into the binary dataset, not read dynamically at runtime.

## 4. Environment Configuration

Copy the following variables from `local.env` into your gitignored `.env` file (since NestJS `ConfigModule` loads `.env`):

```env
OSRM_PORT=5000
OSRM_URL=http://localhost:5000
OSRM_REQUEST_TIMEOUT_MS=3000
OSRM_CACHE_TTL_SECONDS=60
```

After updating `.env`, restart the backend API server.

## 5. Switching Instances to OSRM

To enable OSRM for an instance, submit an admin config update or use the admin web dashboard:

```bash
POST /api/admin/v1/config/instance-config
{
  "geoCalculationType": "OSRM",
  "deliveryDurationCalculationType": "OSRM"
}
```

To revert back to straight-line calculations, set `geoCalculationType` to `"HAVERSINE"` and `deliveryDurationCalculationType` to `"SIMPLE"`.

## 6. Failure Policy (No Silent Fallback)

If the OSRM service is unreachable or errors out, delivery quote requests will **fail with a 503 Service Unavailable status** instead of falling back to Haversine straight-line calculation. Silent fallback is deliberately disabled to avoid unrecorded changes to quotes and courier piece-rate earnings.
