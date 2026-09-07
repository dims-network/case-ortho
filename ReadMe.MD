# DIMS Dashboard — ORTHO

Parent–child dyads play a collaborative tabletop game. This dashboard puts the
recording beside the ball's kinematics, the pair's gaze, and the annotations —
and quantifies how those signals relate over time.

Twelve game sessions across three dyads.

## Run it

```sh
python serve.py            # then open http://localhost:8000
python serve.py 8080       # if that port is taken
```

Nothing to install: the dashboard is plain files and `serve.py` uses only the
standard library. Videos are not in the repository (see **Data**); every other
tab works without them.

## What you get

Pick a session from the dropdown, then a point on the timeline — every tab
narrows to a window around it.

| tab | what it draws |
|---|---|
| **Time series** | ball speed and velocity components, and each partner's gaze, on a shared time axis |
| **Trajectory** | where the ball went, drawn on the board itself, with the path so far up to the selected moment |
| **RQA** | a recurrence plot per signal — when the ball returns to a state it was in before — with recurrence rate, determinism and laminarity tracked over time. The gaze channels get a *categorical* RQA instead: recurrence means both partners looking at the same region |
| **Cross-Wavelet** | coherence between two signals by time and timescale, with a chance level from a Monte Carlo null. A thick line is not evidence on its own — the tab says what share of cells beat chance |
| **ELAN** | the annotation tiers, aligned to the video |

Three camera perspectives are available per session — wide, parent, child —
switchable above the video.

## Data

| in the repository | not in the repository |
|---|---|
| time series, gaze, ELAN, transcripts, board images, all analysis output | the video recordings |

The participant data here is published with consent. The **recordings are
not** — `dims-case.json` lists `assets/videos` as restricted and `.gitignore`
excludes video files, so they cannot be committed by accident.

To watch the video alongside the data, put the files in `assets/videos/`
locally as `{videoID}_{perspective}.mp4`, or point `data.local.json` at
wherever you keep them (copy `data.local.json.example`). Nothing needs to be
copied into the repository.

Two sessions — `CUF00_L1_A1` and `CUF00_L1_A2` — have time series, RQA and
transcripts but no ELAN or cross-wavelet yet. Their tabs render empty until
the analyses are re-run.

## Rebuild the analyses

```sh
pip install -e /path/to/dims          # the analyses; not on PyPI yet
python build_assets.py --check        # what would run
python build_assets.py                # run it
```

That runs RQA and cross-wavelet for what `config.json` enables, then this
study's own categorical gaze RQA from `opt/`. Order matters between the two and
`build_assets.py` handles it — see [`opt/README.md`](opt/README.md).

## Rebuild the time series

Only if you are regenerating from the game's own records rather than from the
CSVs already here. It needs `ortho.db`, which this repository does not ship.
See [`tools/README.md`](tools/README.md).

## Layout

```
config.json          which sessions exist, which analyses run, trajectory geometry
index.html           the page; loads the vendored core, then tabs/
serve.py             local server (stdlib only)
build_assets.py      rebuild the analyses
vendor/              pinned copy of the shared core — never edit, see below
tabs/trajectory.js   this study's own tab
opt/                 this study's own analysis (categorical gaze RQA)
tools/               rebuild the time series from the game database
assets/              data in, analysis out
```

`vendor/` is a pinned copy of [dims](https://github.com/dims-network/dims),
verified against its release in CI. A fix belongs upstream and arrives here as
a version bump (`dims-case sync`), never as an edit here.

## Configuration

`config.json` is validated in CI against the shared
[schema](https://github.com/dims-network/dims/blob/main/docs/contracts/config.schema.json).
The keys specific to this study:

| key | what it does |
|---|---|
| `perspectives`, `videoSrcTemplate` | the three camera angles and how their filenames are built |
| `include_trajectory`, `trajectory_settings`, `trajectory_tracks` | the board background and per-session path overrides |
| `include_RQA` | the kinematic channels only — the gaze channels are the categorical step's, and listing them here would make both analyses claim the same data |
