# This study's own analysis

`step_categorical_rqa.py` runs recurrence quantification over **categorical**
gaze codes rather than a continuous signal — where a state is "looking at the
partner" rather than a number. No other DIMS study has categorical data, so it
lives here.

The shared analyses come from the pinned core:

```sh
pip install -e /path/to/dims/packages/dims-analysis
dims-analysis run --config config.json
```

## One thing to know

This writes into the same `assets/rqa/{video}_rqa_data.json` that the shared RQA
step writes, so ordering matters: run the shared step first, then this one. The
shared step used to overwrite that file, which is why this fork also carried a
modified copy of it that merged instead. `dims-analysis` now merges by default,
so the modified copy is gone — but the ordering still matters.

Making this a registered step so ordering is not a matter of memory is
[dims#5](https://github.com/dims-network/dims/issues/5).
