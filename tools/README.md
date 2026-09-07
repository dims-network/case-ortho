# tools/ — rebuilding this study's inputs

These scripts turn the ORTHO game's own records into the time series the
dashboard reads. They are the step *before* the analyses: they produce
`assets/timeseries/`, and `dims-analysis` takes it from there.

Most people never need them. Run them only if you are regenerating the study
from its upstream sources rather than from the CSVs already in the repository.

## What you need first

Two things this repository does not ship:

| source | what it is | why it is not here |
|---|---|---|
| `ortho.db` | sqlite, every ball track for every session | 159 MB of raw game telemetry, and not ours to publish |
| field images | the board backgrounds the trajectory tab draws on | large, and only some are needed |

```sh
cp tools/sources.local.json.example tools/sources.local.json
# edit it to point at ortho.db (and the images, if you have them)
pip install -r tools/requirements.txt
```

`sources.local.json` is untracked, like `data.local.json` — the paths are
per-machine. Every script that opens the database checks for it first and
tells you what is missing rather than failing three frames down.

The trajectory geometry (`assets/trajectory_config.json`) *is* in the
repository: it is 3 kB and the dashboard needs it.

## The scripts

Run in this order; each depends on what the one before it wrote.

| script | reads | writes |
|---|---|---|
| `build_report.py` | `ortho.db`, the EAF files | `COVERAGE_REPORT.txt` — which sessions the database and the annotations agree on. Read-only; run it first to see what is buildable |
| `build_datasets.py` | `ortho.db`, EAF, `interactions/` | the whole dataset: time series, trimmed EAFs, gaze. This is the one that rebuilds the study |
| `export_timeseries.py` | `ortho.db` | `assets/timeseries/{videoID}_{x,y,vx,vy,speed}.csv` on its own, if that is all you want |
| `cut_clips.py` | source recordings, EAF | per-level video clips. Needs `ffmpeg` on the PATH |
| `build_config.py` | what the others produced | rewrites `config.json` to match the assets that now exist |
| `ortho_common.py` | — | shared definitions: which dyads exist, how a videoID is composed, the database schema |

A `videoID` is `{dyad}_L{difficulty}_A{nn}` — the nth game at that difficulty,
walking the session in order.

## Then the analyses

```sh
python ../build_assets.py          # or: dims-analysis run --config config.json
```

**Order matters between the two RQA steps.** The shared RQA and this study's
`opt/step_categorical_rqa.py` write into the same
`assets/rqa/{videoID}_rqa_data.json`. The shared one runs first;
`build_assets.py` does that for you. Since v1.3.0 they merge rather than
overwrite, so a mistake no longer silently deletes the other's results — but
running them out of order still gives you a file built in the wrong sequence.
Making the categorical step a registered step, so ordering is not a matter of
memory, is [dims#5](https://github.com/dims-network/dims/issues/5).
