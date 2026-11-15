# Lookout

A globe of **live** cameras in one place, in a dark ops-center look built on MapLibre's globe projection. Every dot is a real-time video stream:

- **Traffic video**: public HLS streams from state transportation departments (Minnesota, Colorado, Iowa, Nevada, Louisiana, Missouri, Delaware, plus California, Wisconsin and Utah when built from a US network).
- **Scenic live streams**: 24/7 YouTube live cams of cities, beaches, volcanoes, wildlife, airports and harbours around the world.
- **Windy live webcams** (optional, needs a free key).

There are no refreshing snapshots or recorded clips. Only feeds their owners publish for the public are used. No unsecured private cameras.

## Run it

```bash
npm start
```

Then open http://localhost:5173. Nothing to install (no dependencies).

## Refresh the camera list

```bash
npm run data       # re-fetch every source, health-check every stream, de-duplicate
npm run youtube    # find current 24/7 YouTube live streams (takes ~20 min, rate-limited)
npm run refresh    # both
```

What the data build does:

1. **Health check**: requests every HLS playlist like a browser would. Streams that return an error or don't allow browser playback are dropped. Streams that time out are kept, because that usually means your network is geo-blocked, not that the stream is down.
2. **De-duplication**: traffic cams closer than 1 km on the same road are thinned to one. Change it with `MIN_SPACING_KM=0.5 npm run data` (0 turns it off).

Optional: get a free key at https://api.windy.com/keys to add Windy webcams that have a live player:

```bash
WINDY_API_KEY=your-key npm run data
```

## Controls

| Key | Action |
| --- | --- |
| `R` | Teleport to a random live camera |
| `T` | Start/stop the auto-tour (skips streams that are down) |
| `W` | Open/close your camera wall (up to 16 streams side by side) |
| `/` | Search |
| `Esc` | Close the viewer or wall |

"Copy link" in the viewer copies a link that opens straight to that camera.

## Hosting

`public/` is a plain static site. `.github/workflows/deploy.yml` rebuilds the camera list daily on GitHub's servers (in the US, so the geo-blocked state feeds work there too), refreshes YouTube streams weekly, and publishes to GitHub Pages. Add a `WINDY_API_KEY` repository secret to include Windy.

Basemap © OpenStreetMap contributors, © CARTO.
