# This study's own analysis

`step_categorical_rqa.py` runs recurrence quantification over **categorical**
gaze codes rather than a continuous signal — where a state is "looking at the
partner" rather than a number, and recurrence is an exact match rather than a
distance under a threshold. No other DIMS study has categorical data, so it
lives here rather than in the core; see the step contract for why that is the
right side of the line.

## Running it

`build_assets.py` runs it, after the shared analyses, which is the order that
matters:

```sh
python build_assets.py            # shared analyses, then this one
```

It needs `dims-analysis` installed, because it uses the shared path resolver,
series reader, reduction and merging writer rather than private copies of them:

```sh
pip install -e /path/to/dims
```

## Two things to know

**It writes into the same file as the shared RQA step.**
`assets/rqa/{video}_rqa_data.json` holds both the continuous vx/vy RQA and the
categorical gaze RQA, so ordering matters: the shared step first, then this one.
`build_assets.py` does exactly that, so the ordering is no longer a matter of
memory. Both write through `results.write_payload`, which merges and reports
what it kept and what it replaced — the shared step used to overwrite the file,
which is why this study once carried its own modified copy of it.

**The reduction is not striding.** The recurrence matrix is built at full
resolution and then reduced with `reduce.block_binary`. Reducing the *series*
first and matching on what survived — which this script used to do — keeps a
recurrence off the main diagonal only when its lag happens to be a multiple of
the factor, and an off-diagonal line is exactly what a lagged parent/child
coupling looks like. The longest recording here is 2610 points, so the full
matrix is under 7 MB and there was never anything to gain by it.
