#!/usr/bin/env python3
"""build_assets.py — rebuild this study's analysis assets from its time series.

    python build_assets.py                   # every video in config.json
    python build_assets.py --check           # say what would run, change nothing
    python build_assets.py --write-manifest  # record what assets/ now holds

What this does
    Runs the shared analyses -- RQA, cross-RQA, cross-wavelet -- for whatever
    config.json enables, then any analysis this study ships itself in opt/.

What it does NOT do
    It does not produce the time series. Where those come from is the study's
    own business and differs between studies: motion capture from video, an
    eye-tracker export, a game log. If this study has such a step, it belongs
    in opt/ and this script runs it -- see the "study-owned steps" section
    below. Until then, put the CSVs in assets/timeseries/ yourself.

Knowing the rebuild is complete
    assets/MANIFEST.json is a tracked list of names, sizes and checksums --
    never content. A study whose data lives outside git has nothing else that
    says what a complete set looks like, so after a rebuild this script
    compares against it and says what is missing. Write the first one with
    --write-manifest, once you are satisfied the assets are right.

Where the data lives
    assets/ here by default. If the recordings live outside the repository --
    which is the norm for a study with identifiable video -- copy
    data.local.json.example to data.local.json and point it at them. serve.py
    and every analysis step resolve through it, so nothing has to be copied in.

Requirements
    The analyses are the dims-analysis package, not yet on PyPI:
        git clone https://github.com/dims-network/dims
        pip install -e ./dims
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.json'
PY = sys.executable

# Shared analyses come from the package; a step_<id>.py here would be a stale
# copy of one, and running it would produce a second, older answer beside it.
SHARED_STEP_IDS = {'rqa', 'crqa', 'crosswavelet'}


def asset_dir(*parts):
    """A project asset directory, resolved through data.local.json."""
    rel = os.path.join('assets', *parts)
    try:
        from dims_analysis.common import assets as _assets
        resolved = _assets.resolve(rel, str(ROOT))
    except ImportError:
        resolved = rel
    return Path(resolved) if os.path.isabs(resolved) else ROOT / resolved


def have_dims_analysis():
    import importlib.util
    try:
        return importlib.util.find_spec('dims_analysis.cli') is not None
    except ModuleNotFoundError:
        return False


def require_dims_analysis():
    """Fail here, with the command to fix it, rather than deep inside a step."""
    if have_dims_analysis():
        return
    guess = ROOT.parent / 'dims'
    print('\nERROR: the DIMS analyses are not installed in this interpreter.')
    print(f'       interpreter: {PY}')
    if (guess / 'pyproject.toml').exists():
        print(f'\n       A checkout is right here. Install from it with:')
        print(f'         {PY} -m pip install -e {guess}')
    else:
        print('\n       They are not on PyPI. Clone the monorepo and install it:')
        print('         git clone https://github.com/dims-network/dims')
        print(f'         {PY} -m pip install -e ./dims')
    sys.exit(1)


def load_config():
    if not CONFIG.exists():
        sys.exit(f'ERROR: no config.json at {CONFIG}')
    with open(CONFIG) as fh:
        return json.load(fh)


def own_steps():
    """Analyses this study ships itself: opt/step_<id>.py, gated by include_<id>."""
    opt = ROOT / 'opt'
    if not opt.is_dir():
        return []
    found = []
    for path in sorted(opt.glob('step_*.py')):
        step_id = path.stem[len('step_'):]
        if step_id.lower() in SHARED_STEP_IDS:
            continue
        found.append((step_id, path))
    return found


def enabled(config, step_id):
    wanted = f'include_{step_id}'.lower()
    return any(k.lower() == wanted and bool(v) for k, v in config.items())


def run(title, *args):
    print('\n' + '=' * 66)
    print(f'  {title}')
    print('=' * 66)
    subprocess.run([PY, *args], cwd=ROOT, check=True)


def report_manifest():
    """Say whether the assets match the tracked record, if there is one.

    Never fatal. A manifest describes the study as it was when somebody was
    satisfied with it; a rebuild that produces more, or produces something
    deliberately different, is not an error. Silence about a rebuild that
    produced less would be.
    """
    if not have_dims_analysis():
        return
    from dims_analysis.common import manifest as mf
    result = mf.compare(str(ROOT))
    if result is None:
        print(f'manifest   : none yet  '
              f'(write one with --write-manifest once the assets are right)')
        return
    missing, changed, _extra = result
    if not missing and not changed:
        print(f'manifest   : assets match assets/{mf.NAME}')
        return
    print(f'manifest   : {len(missing)} missing, {len(changed)} different '
          f'from assets/{mf.NAME}')
    for rel in (missing + changed)[:8]:
        print(f'             {rel}')
    if len(missing) + len(changed) > 8:
        print(f'             ... and {len(missing) + len(changed) - 8} more')


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true',
                    help='report what would run and stop')
    ap.add_argument('--write-manifest', action='store_true',
                    help='record assets/MANIFEST.json from the assets as they are')
    args = ap.parse_args()

    config = load_config()
    videos = config.get('videoIDs') or []
    shared = sorted(k for k, v in config.items()
                    if k.lower().startswith('include_') and v
                    and k.lower()[len('include_'):] in SHARED_STEP_IDS)
    mine = [(sid, p) for sid, p in own_steps() if enabled(config, sid)]

    print(f'study      : {config.get("title") or ROOT.name}')
    print(f'videos     : {len(videos)}  {", ".join(videos[:4])}'
          f'{" ..." if len(videos) > 4 else ""}')
    print(f'assets     : {asset_dir()}')
    print(f'shared     : {", ".join(shared) or "(none enabled)"}')
    print(f'study-owned: {", ".join(sid for sid, _ in mine) or "(none)"}')
    idle = [sid for sid, _ in own_steps() if not enabled(config, sid)]
    if idle:
        print(f'  not enabled: {", ".join(idle)}  '
              f'(add "include_<id>": true to config.json to run them)')

    if not videos:
        sys.exit('\nERROR: config.json lists no videoIDs. Nothing to build.')
    if not shared and not mine:
        sys.exit('\nERROR: config.json enables no analyses. Nothing to build.')

    missing = [v for v in videos
               if not any(asset_dir('timeseries').glob(f'{v}_*.csv'))]
    if missing:
        print(f'\nWARNING: no time series found for: {", ".join(missing)}')
        print(f'         expected files in {asset_dir("timeseries")}/')

    report_manifest()

    if args.write_manifest:
        require_dims_analysis()
        from dims_analysis.common import manifest as mf
        written = mf.write(str(ROOT))
        n = len(written['files'])
        print(f'\nwrote assets/{mf.NAME}: {n} file{"" if n == 1 else "s"}')
        return

    if args.check:
        print('\n--check: nothing was run.')
        return

    require_dims_analysis()

    if shared:
        run('Shared analyses (dims-analysis)',
            '-m', 'dims_analysis.cli', 'run', '--config', 'config.json')

    for step_id, path in mine:
        # No --output-dir: a study-owned step knows where its results belong,
        # and imposing assets/<id>/ would be wrong for the ones that write into
        # an existing directory on purpose. ORTHO's categorical gaze RQA writes
        # into assets/rqa/ so it merges with the shared RQA for the same video.
        run(f"This study's own: {step_id}",
            str(path.relative_to(ROOT)), '--config', 'config.json')

    print('\n' + '=' * 66)
    print('  Asset build complete')
    print('=' * 66)
    report_manifest()
    print('  View it:  python serve.py   ->  http://localhost:8000')


if __name__ == '__main__':
    main()
