#!/usr/bin/env python3
"""
optional_step_crosswavelet.py https://pycwt.readthedocs.io/en/latest/tutorial/cwt/

Usage:
    python optional_step_crosswavelet.py --config config.json --output-dir assets/rqa
"""
import numpy as np
import pandas as pd
import pycwt as wavelet
from pycwt.helpers import find
import json
import os
import argparse
from scipy import signal
import warnings
warnings.filterwarnings('ignore')

# ==============================================================================
# CONFIGURABLE PARAMETERS - Adjust these as needed
# ==============================================================================

# ---------- Wavelet Transform Parameters ----------
MOTHER_WAVELET = 'morlet'  # Options: 'morlet', 'paul', 'dog', 'mexican_hat'
OMEGA0 = 6                  # Parameter for Morlet wavelet (typically 6)
DJ = 1/12                   # Frequency resolution (1/12 = 12 sub-octaves per octave)
S0_FACTOR = 2               # Smallest scale as multiple of dt (s0 = S0_FACTOR * dt)
J_AUTO = True               # Auto-calculate number of scales based on data length
J_MANUAL = 7                # Manual number of octaves (used if J_AUTO = False)

# ---------- Data Processing Parameters ----------
DETREND_DATA = True         # Whether to detrend the data (polynomial fit removal)
DETREND_ORDER = 1           # Polynomial order for detrending (1 = linear)
MIN_DATA_POINTS = 50        # Minimum number of data points required
INTERPOLATION_METHOD = 'linear'  # Method for interpolating to common time base

# ---------- Significance Testing Parameters ----------
SIGNIFICANCE_LEVEL = 0.95   # Confidence level for significance testing (0.95 = 95%)
USE_AR1_NOISE = True        # Use AR1 noise model for significance (vs white noise)
MONTE_CARLO_ITERATIONS = 0  # Number of Monte Carlo iterations (0 = use theoretical)

# Significance for the *coherence* itself, which is a different question from
# sig95_xwt. sig95_xwt asks "is there more joint energy here than red noise
# would give?" -- a statement about power. Coherence asks "is the phase lag
# steadier than red noise would give?", and it needs its own null, because a
# coherence estimate does not sit at 0 under independence: it is a ratio taken
# over a smoothing neighbourhood, so a handful of random phases still average
# to something well above zero. Measured on the Karnatak data the 95% level is
# ~0.59 and two independent signals score ~0.25 on average -- so an edge value
# of 0.27 is indistinguishable from no coupling at all, which is not something
# the raw number reveals. Only a Monte Carlo against AR(1) surrogates gives it.
WCT_SIGNIF_ENABLED = True   # Compute the Monte Carlo coherence significance level
WCT_SIGNIF_MC_COUNT = 100   # Surrogate pairs per null (pycwt default is 300)
# The Monte Carlo is seeded, so the same input gives the same significance
# threshold every time. Unseeded, two runs over identical data disagreed by up
# to 0.04 on the 95% level (mean 0.012 across scales) -- which propagates into
# wtc_signif_fraction, i.e. the reported "% of cells significantly coupled"
# was not reproducible. Set to None to restore the old random behaviour.
#
# On mc_count: 100 is a compromise against a cold-run cost of ~45 s. The
# disk cache below means that cost is paid once per (alpha, grid) rather than
# per pair, per video and per re-run, so raising this toward pycwt's default
# of 300 is affordable if a tighter null is wanted for publication.
WCT_SIGNIF_SEED = 20250906

# ---------- Per-study tuning (config.json) ----------
# These exist because one study previously had to maintain its own copy of this
# entire file to change two numbers. They are read from
#   config.json -> "analysis": { "crosswavelet": { ... } }
# and fall back to the module defaults below.
#
#   maxPeriod      float | null   longest period to compute, in SECONDS
#   scaleAvgBand   [min, max]     scale-averaging band, in SECONDS
#
# Note the units: the legacy SCALE_AVG_* constants below are multiples of dt,
# which is a different thing and easy to confuse. The config keys are always
# seconds, so a study never has to know which convention a constant follows.
CONFIG_TUNING_KEY = "crosswavelet"


def _tuning(config):
    return ((config or {}).get("analysis") or {}).get(CONFIG_TUNING_KEY) or {}


# ---------- Scale-Averaged Band Parameters ----------
SCALE_AVG_BAND_AUTO = True  # Auto-calculate scale-averaging band
SCALE_AVG_MIN_PERIOD = 2.0  # Minimum period for scale-averaging (in time units)
SCALE_AVG_MAX_PERIOD = 8.0  # Maximum period for scale-averaging (in time units)
# Note: If auto, uses 2*dt to min(8*dt, max_period/2)

# ---------- Coherence Calculation Parameters ----------
# DEPRECATED / UNUSED since the coherence rewrite (see compute_cross_wavelet_standard).
# Smoothing is now delegated to pycwt's validated operator for the chosen mother
# wavelet, which supplies its own time and scale kernels; these four knobs
# belonged to the hand-rolled smoother that produced the power-tracking
# coherence. They are kept only so that an existing config or script that
# references them does not break, and they have no effect.
COHERENCE_SMOOTH_TIME = True    # DEPRECATED, no effect
COHERENCE_SMOOTH_SCALE = True   # DEPRECATED, no effect
COHERENCE_TIME_FACTOR = 1.0     # DEPRECATED, no effect
COHERENCE_SCALE_WIDTH = 0.6     # DEPRECATED, no effect

# ---------- Visualization/Storage Parameters ----------
MAX_TIME_POINTS_VIZ = 500    # Maximum time points for visualization (downsampling)
MAX_FREQ_POINTS_VIZ = 100    # Maximum frequency points for visualization
SAVE_FULL_RESOLUTION = False # Also save full resolution data (warning: large files)
OUTPUT_FORMAT = 'json'       # Output format: 'json', 'npz', or 'both'

# ---------- Analysis Coverage Parameters ----------
COMPUTE_ALL_PAIRS = True        # Compute all possible pairs (not just specified)
SYMMETRIC_PAIRS = False          # Compute both A vs B and B vs A (usually redundant)

# ---------- Quality Control Parameters ----------
HIGH_COHERENCE_THRESHOLD = 0.8  # Threshold for "high coherence" statistics
COI_EXCLUDE = True               # Exclude COI regions from statistics
MIN_COMMON_TIME_FRACTION = 0.5  # Minimum overlap fraction required for pairs
EDGE_TAPER = True                # Apply edge tapering (Tukey window)
TAPER_ALPHA = 0.05               # Tukey window parameter (0-1, smaller = less taper)

# ---------- File Path Parameters ----------
INPUT_DIR = 'assets/timeseries'     # Directory containing input CSV files
OUTPUT_DIR = 'assets/crosswavelet'  # Default output directory
FILE_PATTERN = '{video_id}_{data_type}.csv'  # Input file naming pattern

# ---------- Debugging/Logging Parameters ----------
VERBOSE = True              # Print detailed progress information
DEBUG_MODE = False          # Save intermediate results for debugging
PLOT_INPUTS = False         # Plot input time series before processing
SAVE_METADATA = True        # Save analysis metadata in output

# ==============================================================================
# END OF CONFIGURABLE PARAMETERS
# ==============================================================================

def load_and_prepare_timeseries(video_id, data_type, detrend=DETREND_DATA):
    """
    Load and prepare time series data for cross-wavelet analysis.
    Following Torrence and Compo (1998) approach for data preparation.
    
    Parameters:
    - video_id: Video identifier
    - data_type: Type of data (e.g., 'bodysync', 'neuralsync')
    - detrend: Whether to detrend the data
    """
    csv_path = os.path.join(INPUT_DIR, FILE_PATTERN.format(
        video_id=video_id, data_type=data_type
    ))
    
    if not os.path.exists(csv_path):
        if VERBOSE:
            print(f"Warning: File not found: {csv_path}")
        return None, None, None, None, None
    
    # Load data
    df = pd.read_csv(csv_path)
    # Accept the time column under any casing/whitespace -> canonical 'Time'.
    df = df.rename(columns={c: 'Time' for c in df.columns if str(c).strip().lower() == 'time'})

    # Get time column
    if 'Time' not in df.columns:
        if VERBOSE:
            print(f"Error: No 'Time' column in {csv_path}")
        return None, None, None, None, None
    
    # Get all non-time columns
    data_cols = [col for col in df.columns if col != 'Time']
    if not data_cols:
        if VERBOSE:
            print(f"Error: No data columns in {csv_path}")
        return None, None, None, None, None
    
    # Use the first data column
    data_col = data_cols[0]
    
    # Clean data - remove NaN values
    mask = ~pd.isna(df[data_col])
    time_clean = df['Time'][mask].values
    data_clean = df[data_col][mask].values
    
    if len(data_clean) < MIN_DATA_POINTS:
        if VERBOSE:
            print(f"  Insufficient data points ({len(data_clean)}) < {MIN_DATA_POINTS}")
        return None, None, None, None, None
    
    # Calculate sampling interval
    dt = np.median(np.diff(time_clean))
    
    # Detrend if requested
    if detrend and DETREND_ORDER > 0:
        p = np.polyfit(time_clean - time_clean[0], data_clean, DETREND_ORDER)
        data_detrended = data_clean - np.polyval(p, time_clean - time_clean[0])
        if DEBUG_MODE and VERBOSE:
            print(f"  Detrended with polynomial order {DETREND_ORDER}")
    else:
        data_detrended = data_clean - np.mean(data_clean)
    
    # Calculate statistics
    std = data_detrended.std()
    var = std ** 2
    
    # Normalize by standard deviation
    data_normalized = data_detrended / std
    
    if VERBOSE:
        print(f"  Loaded {data_type}: {len(data_clean)} points, dt={dt:.4f}, std={std:.4f}")
    
    return data_normalized, time_clean, dt, std, var

def _ar1_alpha(data):
    """Lag-1 autocorrelation (AR1 coefficient) for the red-noise significance test.

    pycwt's wavelet.ar1() raises a Warning when a series is short or strongly
    trended ("Cannot place an upperbound on the unbiased AR(1)"). Fall back to a
    plain lag-1 autocorrelation in that case so significance testing still runs
    instead of crashing the whole step.
    """
    try:
        return wavelet.ar1(data)[0]
    except Exception:  # noqa: BLE001 — pycwt raises a bare Warning here
        x = np.asarray(data, dtype=float)
        x = x - np.mean(x)
        denom = np.sum(x * x)
        if denom <= 0:
            return 0.0
        alpha = float(np.sum(x[:-1] * x[1:]) / denom)
        # Keep it in a sane red-noise range (avoid >=1, which breaks significance).
        return min(max(alpha, 0.0), 0.95)

# Monte Carlo coherence nulls are expensive and highly reusable, so they are
# cached at two levels: in memory for this process, and on disk across runs.
#
# The null depends only on the AR(1) coefficients and the wavelet grid -- NOT on
# the data. pycwt's wct_significance() does not even take the data as an
# argument; it sizes its own surrogates as N = ceil(max_scale * 6), which for a
# typical grid is ~3000 samples. So an 8-second clip pays exactly the same ~45 s
# (at mc_count=100) as a 20-minute recording, and every pair, every video and
# every re-run would pay it again without a cache.
#
# pycwt has its own on-disk cache and it cannot be used: the cache filename is
# built from arctanh(alpha * 4), which is NaN for any alpha > 0.25, so every
# realistic red-noise coefficient collides into one "wct_sig_nan_nan_..." file
# and you silently get back a null computed for different coefficients. We pass
# cache=False and do it ourselves, keyed on everything that actually changes the
# result -- including mc_count and the wavelet parameters, whose omission is
# precisely what makes a cache dangerous rather than merely useless.
_WCT_SIGNIF_CACHE = {}

_WCT_CACHE_DIR = os.environ.get("DIMS_WCT_CACHE_DIR") or os.path.join(
    os.path.expanduser("~"), ".cache", "dims", "wct_significance")
WCT_SIGNIF_DISK_CACHE = os.environ.get("DIMS_WCT_CACHE", "1") != "0"


def _wct_cache_path(key):
    """Filename for a null. The key is hashed so no float formatting can collide."""
    import hashlib
    digest = hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:32]
    return os.path.join(_WCT_CACHE_DIR, f"wct_{digest}.npy")

def _wct_significance_level(alpha1, alpha2, dt, dj, s0, n_scales, mother_wavelet):
    """95% coherence level under an AR(1) null, as a per-scale vector.

    Returns None if the Monte Carlo is disabled or fails, in which case the
    caller simply omits the field and the dashboard falls back to its older
    power-significance mask.

    Two pycwt quirks are handled here:

    * Its on-disk cache is unusable. The cache filename is built from
      ``arctanh(alpha * 4)``, which is NaN for any alpha > 0.25 -- so every
      realistic red-noise coefficient collides into a single
      ``wct_sig_nan_nan_...`` file and you silently get back a null computed for
      different coefficients. We always pass cache=False and memoise ourselves.
    * For the largest scales, which lie entirely inside the cone of influence,
      it returns 0 rather than NaN. Zero would mean "every cell is significant",
      the exact opposite of the truth, so those rows are turned into NaN and the
      consumer skips them.

    ``n_scales`` is ``len(scales)`` as returned by ``wavelet.cwt``, NOT the J
    passed to it. With the default J_AUTO, J is a float (e.g. 95.55): cwt
    rounds it up to 97 scales while ``wct_significance(int(J))`` returns 96, and
    the length guard at the call site would then discard the field on every
    single run. Deriving J from the scale count keeps the two aligned.

    Cost is independent of the recording length: pycwt sizes its own surrogates
    from the scale range, so a 2-minute and a 20-minute video pay the same.
    """
    if not WCT_SIGNIF_ENABLED:
        return None

    # Round the coefficients: the null is very insensitive to alpha (the 95%
    # level moves by <0.04 across alpha 0.90-0.97), so pairs that agree to two
    # decimals can share a result.
    key = (round(float(alpha1), 2), round(float(alpha2), 2),
           round(float(dt), 6), round(float(dj), 6), round(float(s0), 6),
           int(n_scales), float(SIGNIFICANCE_LEVEL), int(WCT_SIGNIF_MC_COUNT),
           str(MOTHER_WAVELET).lower(), float(OMEGA0), WCT_SIGNIF_SEED)
    if key in _WCT_SIGNIF_CACHE:
        return _WCT_SIGNIF_CACHE[key]

    cache_path = _wct_cache_path(key) if WCT_SIGNIF_DISK_CACHE else None
    if cache_path and os.path.exists(cache_path):
        try:
            level = np.load(cache_path)
            if level.ndim == 1 and len(level) == int(n_scales):
                if VERBOSE:
                    print("  Coherence significance: reusing cached null")
                _WCT_SIGNIF_CACHE[key] = level
                return level
        except Exception:  # noqa: BLE001 -- a corrupt cache entry just means recompute
            pass

    rng_state = None
    try:
        # pycwt draws its surrogates from numpy's global RNG, so seeding it here
        # is what makes the threshold reproducible. The previous state is saved
        # and restored so this does not quietly determine anyone else's randomness.
        if WCT_SIGNIF_SEED is not None:
            rng_state = np.random.get_state()
            np.random.seed(WCT_SIGNIF_SEED)
        # pycwt sizes its output with np.zeros(J + 1), so J here is the number
        # of scales minus one, and must be a Python int (it rejects a float).
        level = wavelet.wct_significance(
            float(alpha1), float(alpha2), dt, dj, s0, int(n_scales) - 1,
            significance_level=SIGNIFICANCE_LEVEL, wavelet=mother_wavelet,
            mc_count=WCT_SIGNIF_MC_COUNT, progress=False, cache=False
        )
    except Exception as exc:  # noqa: BLE001 -- never fail the whole step over this
        if VERBOSE:
            print(f"  WARNING: coherence significance failed ({exc}); "
                  f"field omitted")
        _WCT_SIGNIF_CACHE[key] = None
        return None
    finally:
        if rng_state is not None:
            np.random.set_state(rng_state)

    level = np.asarray(level, dtype=float).ravel()
    level[~np.isfinite(level) | (level <= 0)] = np.nan   # COI-only scales
    _WCT_SIGNIF_CACHE[key] = level

    if cache_path:
        # Write via a temporary file and rename, so an interrupted run cannot
        # leave a truncated .npy that every later run would happily load.
        # np.save() is handed an open file object deliberately: given a *path*
        # it appends ".npy" when the name does not already end in it, which
        # silently breaks the rename below.
        tmp = cache_path + f".{os.getpid()}.tmp"
        try:
            os.makedirs(_WCT_CACHE_DIR, exist_ok=True)
            with open(tmp, "wb") as fh:
                np.save(fh, level)
            os.replace(tmp, cache_path)
        except Exception as exc:  # noqa: BLE001 -- caching is an optimisation, not a requirement
            # Report it: a cache that silently never works is worse than none,
            # because the cost it was meant to remove is paid on every run.
            if VERBOSE:
                print(f"  WARNING: could not cache coherence null ({exc})")
            try:
                os.remove(tmp)
            except OSError:
                pass

    return level

def compute_cross_wavelet_standard(data1, data2, time, dt,
                                   mother=MOTHER_WAVELET, omega0=OMEGA0,
                                   dj=DJ, s0=None, J=None, max_period=None):
    """
    Compute cross-wavelet transform between two time series using pycwt standard approach.
    
    Parameters:
    - data1, data2: Input time series (normalized)
    - time: Time array
    - dt: Sampling interval
    - mother: Mother wavelet name
    - omega0: Omega0 for Morlet wavelet
    - dj: Frequency resolution parameter
    - s0: Smallest scale
    - J: Number of scales
    """
    
    N = len(data1)
    
    # Set default parameters following Torrence & Compo
    if s0 is None:
        s0 = S0_FACTOR * dt  # Starting scale
    
    if J is None:
        if J_AUTO:
            J = np.log2(N * dt / s0) / dj  # Auto-calculate number of scales
        else:
            J = J_MANUAL / dj  # Use manual setting
    
    # Cap the longest period, if the study asked for one. For a Morlet wavelet
    # period ~= scale and scales follow s = s0 * 2^(j*dj), so this is the largest
    # scale index whose period still fits. Studies with a known upper bound on
    # the timescale of interest use this to avoid computing scales they will
    # never look at -- and to keep the scale-averaged band meaningful.
    if max_period is not None:
        J_cap = np.floor(np.log2(float(max_period) / s0) / dj)   # floor: stay <= max_period
        J = min(J, J_cap)

    # Select mother wavelet
    if mother.lower() == 'morlet':
        mother_wavelet = wavelet.Morlet(omega0)
    elif mother.lower() == 'paul':
        mother_wavelet = wavelet.Paul()
    elif mother.lower() == 'dog':
        mother_wavelet = wavelet.DOG()
    elif mother.lower() == 'mexican_hat':
        mother_wavelet = wavelet.MexicanHat()
    else:
        if VERBOSE:
            print(f"Unknown wavelet '{mother}', using Morlet")
        mother_wavelet = wavelet.Morlet(omega0)
    
    # Calculate lag-1 autocorrelation for AR1 noise model
    if USE_AR1_NOISE:
        alpha1 = _ar1_alpha(data1)
        alpha2 = _ar1_alpha(data2)
    else:
        alpha1 = alpha2 = 0.0  # White noise
    
    if DEBUG_MODE and VERBOSE:
        print(f"  AR1 coefficients: α1={alpha1:.3f}, α2={alpha2:.3f}")
    
    # Perform continuous wavelet transform for both series
    W1, scales, freqs, coi, fft1, fftfreqs = wavelet.cwt(
        data1, dt, dj, s0, J, mother_wavelet
    )
    
    W2, _, _, _, fft2, _ = wavelet.cwt(
        data2, dt, dj, s0, J, mother_wavelet
    )
    
    # Calculate cross-wavelet transform
    XWT = W1 * np.conj(W2)
    
    # Calculate cross-wavelet power
    power = np.abs(XWT)
    
    # Calculate phase difference
    phase = np.angle(XWT)
    
    # Convert frequencies to periods
    period = 1 / freqs
    
    # Calculate significance for XWT
    signif_xwt, _ = wavelet.significance(
        1.0, dt, scales, 0, np.mean([alpha1, alpha2]),
        significance_level=SIGNIFICANCE_LEVEL, wavelet=mother_wavelet
    )
    sig95_xwt = np.ones([1, N]) * signif_xwt[:, None]
    sig95_xwt = power / sig95_xwt
    
    # ------------------------------------------------------------------
    # Wavelet coherence (Torrence & Webster 1999):
    #
    #            | S( s^-1 * W1 * conj(W2) ) |^2
    #   R^2 = ---------------------------------------
    #         S( s^-1 |W1|^2 ) * S( s^-1 |W2|^2 )
    #
    # The smoothing operator S MUST be applied to the *complex* cross
    # spectrum. Where the phase relationship is unstable the complex terms
    # cancel under smoothing and coherence drops -- that cancellation is the
    # entire content of the measure.
    #
    # A previous implementation here rolled its own smoother that took
    # np.abs(W)**2 of every argument, including the complex XWT. That
    # destroyed phase before smoothing (so the numerator could never cancel)
    # and left the expression unnormalised -- O(|W|^4) over O(|W|^2) -- which
    # was masked by clipping the result at 1.0. The stored field ended up
    # tracking power instead of phase coupling: ~57-62% of cells sat at
    # exactly 1.0 and it correlated +0.87 with log power. See
    # notebooks/coherence_period_bands.ipynb in DIMS_Dashboard_Karnatak for
    # the full diagnosis.
    #
    # We now delegate the smoothing to pycwt's validated operator, which
    # applies the scale normalisation and the correct time/scale kernels for
    # the chosen mother wavelet.
    # ------------------------------------------------------------------
    scales_2d = np.ones([1, N]) * scales[:, None]
    S1 = mother_wavelet.smooth(np.abs(W1) ** 2 / scales_2d, dt, dj, scales)
    S2 = mother_wavelet.smooth(np.abs(W2) ** 2 / scales_2d, dt, dj, scales)
    S12 = mother_wavelet.smooth(XWT / scales_2d, dt, dj, scales)

    # Correctly normalised, this is bounded in [0, 1] by construction. The
    # epsilon guards division by zero in all-flat regions, and the clip below
    # absorbs floating-point overshoot only -- it is NOT the old saturating
    # clamp. If it ever has real work to do, the formula is wrong again, so
    # we check rather than silently clamp.
    WCO = np.real(np.abs(S12) ** 2 / (S1 * S2 + 1e-30))
    _overshoot = float(np.nanmax(WCO)) if WCO.size else 0.0
    if _overshoot > 1.0 + 1e-6:
        print(f"  WARNING: coherence exceeded 1 by {_overshoot - 1.0:.2e} "
              f"-- normalisation may be wrong")
    WCO = np.clip(WCO, 0.0, 1.0)

    # 95% coherence level under an AR(1) null (see _wct_significance_level).
    # This is what makes an individual coherence value interpretable: without
    # it, 0.27 and 0.55 look like "some coupling" and "more coupling", when in
    # fact the first is exactly what independent signals produce.
    sig95_wtc = _wct_significance_level(alpha1, alpha2, dt, dj, s0, len(scales),
                                        mother_wavelet)
    if sig95_wtc is not None and len(sig95_wtc) != len(scales):
        if VERBOSE:
            print(f"  WARNING: coherence significance length {len(sig95_wtc)} "
                  f"!= {len(scales)} scales; field omitted")
        sig95_wtc = None

    # Phase angles for plotting (only where coherence is significant)
    phase_angle = np.angle(XWT)
    
    # Global wavelet spectrum (time-averaged)
    global_power = power.mean(axis=1)
    
    # Calculate degrees of freedom for global spectrum
    dof = N - scales
    global_signif, _ = wavelet.significance(
        1.0, dt, scales, 1, np.mean([alpha1, alpha2]),
        significance_level=SIGNIFICANCE_LEVEL, dof=dof, wavelet=mother_wavelet
    )
    
    return {
        'W1': W1,
        'W2': W2,
        'XWT': XWT,
        'power': power,
        'phase': phase_angle,
        'coherence': WCO,
        'scales': scales,
        'freqs': freqs,
        'period': period,
        'coi': coi,
        'sig95_xwt': sig95_xwt,
        'sig95_wtc': sig95_wtc,
        'signif_xwt': signif_xwt,
        'global_power': global_power,
        'global_signif': global_signif,
        'mother': mother_wavelet,
        'dt': dt,
        'alpha1': alpha1,
        'alpha2': alpha2,
        'dj': dj,
        's0': s0,
        'J': J
    }

def downsample_for_storage(cwt_results, time, scale_avg_power, 
                           max_time_points=MAX_TIME_POINTS_VIZ, 
                           max_freq_points=MAX_FREQ_POINTS_VIZ):
    """
    Downsample the wavelet results for efficient storage and visualization.
    """
    n_time = len(time)
    n_freq = len(cwt_results['freqs'])
    
    # Determine downsampling factors
    time_factor = max(1, n_time // max_time_points)
    freq_factor = max(1, n_freq // max_freq_points)
    
    # Downsample time
    time_ds = time[::time_factor]
    
    # Downsample frequency/period/scales
    freqs_ds = cwt_results['freqs'][::freq_factor]
    period_ds = cwt_results['period'][::freq_factor]
    scales_ds = cwt_results['scales'][::freq_factor]
    
    # Downsample 2D arrays - ensure real values only
    power_ds = np.real(cwt_results['power'][::freq_factor, ::time_factor])
    phase_ds = np.real(cwt_results['phase'][::freq_factor, ::time_factor])
    coherence_ds = np.real(cwt_results['coherence'][::freq_factor, ::time_factor])
    sig95_xwt_ds = np.real(cwt_results['sig95_xwt'][::freq_factor, ::time_factor])
    
    # Downsample 1D arrays - ensure real values only
    coi_ds = np.real(cwt_results['coi'][::time_factor])
    signif_xwt_ds = np.real(cwt_results['signif_xwt'][::freq_factor])
    # Per-period coherence null; may be absent if the Monte Carlo was skipped.
    sig95_wtc = cwt_results.get('sig95_wtc')
    sig95_wtc_ds = (np.real(sig95_wtc[::freq_factor])
                    if sig95_wtc is not None else None)
    global_power_ds = np.real(cwt_results['global_power'][::freq_factor])
    global_signif_ds = np.real(cwt_results['global_signif'][::freq_factor])
    scale_avg_power_ds = np.real(scale_avg_power[::time_factor])
    
    if VERBOSE and (time_factor > 1 or freq_factor > 1):
        print(f"  Downsampled: time {n_time}->{len(time_ds)}, freq {n_freq}->{len(freqs_ds)}")

    # NaN has no JSON literal and JSON.parse() rejects it outright, so the
    # unusable (COI-only) scales are emitted as null instead.
    sig95_wtc_json = (None if sig95_wtc_ds is None else
                      [None if not np.isfinite(v) else float(v)
                       for v in sig95_wtc_ds])

    return {
        'time': time_ds.tolist(),
        'freqs': freqs_ds.tolist(),
        'period': period_ds.tolist(),
        'scales': scales_ds.tolist(),
        'power': power_ds.tolist(),
        'phase': phase_ds.tolist(),
        'coherence': coherence_ds.tolist(),
        'coi': coi_ds.tolist(),
        'sig95_xwt': sig95_xwt_ds.tolist(),
        'sig95_wtc': sig95_wtc_json,
        'signif_xwt': signif_xwt_ds.tolist(),
        'global_power': global_power_ds.tolist(),
        'global_signif': global_signif_ds.tolist(),
        'scale_avg_power': scale_avg_power_ds.tolist(),
        'downsampling_factors': {
            'time_factor': time_factor,
            'freq_factor': freq_factor
        }
    }

def calculate_summary_statistics(cwt_results, time, scale_avg_power, scale_avg_signif):
    """
    Calculate summary statistics from cross-wavelet results.
    """
    power = cwt_results['power']
    coherence = cwt_results['coherence']
    phase = cwt_results['phase']
    freqs = cwt_results['freqs']
    period = cwt_results['period']
    coi = cwt_results['coi']
    scales = cwt_results['scales']
    global_power = cwt_results['global_power']
    global_signif = cwt_results['global_signif']
    
    # Create COI mask if requested
    if COI_EXCLUDE:
        coi_mask = np.zeros_like(power, dtype=bool)
        for i, c in enumerate(coi):
            coi_mask[:, i] = scales[:, np.newaxis].flatten() > c
    else:
        coi_mask = np.zeros_like(power, dtype=bool)
    
    # Mask out COI regions
    power_valid = np.ma.masked_array(power, coi_mask)
    coherence_valid = np.ma.masked_array(coherence, coi_mask)
    
    # Dominant frequency at each time point (outside COI)
    dominant_freq_idx = np.ma.argmax(power_valid, axis=0)
    dominant_freqs = freqs[dominant_freq_idx]
    
    # Convert to list, handling masked arrays
    if isinstance(dominant_freqs, np.ma.MaskedArray):
        dominant_freqs_list = dominant_freqs.filled(0).tolist()
    else:
        dominant_freqs_list = dominant_freqs.tolist()
    
    # Phase statistics (circular mean)
    mean_phase_by_freq = np.angle(np.mean(np.exp(1j * phase), axis=1))
    
    # Time-frequency regions of high coherence
    high_coherence_regions = coherence > HIGH_COHERENCE_THRESHOLD
    
    # Calculate percent of time each frequency shows high coherence
    high_coherence_by_freq = np.sum(high_coherence_regions & ~coi_mask, axis=1) / np.maximum(np.sum(~coi_mask, axis=1), 1)

    # Share of usable cells whose coherence beats the AR(1) coherence null.
    # This is the number that says whether a pair is coupled at all, and it is
    # the one to read rather than mean_coherence: under independence it sits at
    # ~0.05 by construction, so anything near that means "no coupling detected",
    # however respectable the mean coherence looks.
    sig95_wtc = cwt_results.get('sig95_wtc')
    wtc_signif_fraction = None
    if sig95_wtc is not None:
        level = np.asarray(sig95_wtc, dtype=float)[:, np.newaxis]
        usable = ~coi_mask & np.isfinite(level)      # broadcasts over time
        n_usable = int(np.sum(usable))
        if n_usable > 0:
            wtc_signif_fraction = float(np.sum((coherence > level) & usable) / n_usable)

    return {
        'wtc_signif_fraction': wtc_signif_fraction,
        'wtc_signif_level_median': (float(np.nanmedian(sig95_wtc))
                                    if sig95_wtc is not None
                                    and np.any(np.isfinite(sig95_wtc)) else None),
        'global_power': global_power.tolist(),
        'global_signif': global_signif.tolist(),
        'dominant_freqs': dominant_freqs_list,
        'mean_phase_by_freq': mean_phase_by_freq.tolist(),
        'high_coherence_by_freq': high_coherence_by_freq.tolist(),
        'high_coherence_fraction': float(np.sum(high_coherence_regions & ~coi_mask) / np.sum(~coi_mask)) if np.sum(~coi_mask) > 0 else 0,
        'max_coherence': float(np.max(coherence_valid)) if coherence_valid.count() > 0 else 0,
        'mean_coherence': float(np.mean(coherence_valid)) if coherence_valid.count() > 0 else 0,
        'scale_avg_power_mean': float(np.mean(scale_avg_power)),
        'scale_avg_signif': float(scale_avg_signif),
        'coherence_threshold_used': HIGH_COHERENCE_THRESHOLD
    }

def process_cross_wavelet_pair(video_id, data_type1, data_type2, config):
    """
    Process cross-wavelet analysis for a pair of data types following pycwt standard.
    """
    if VERBOSE:
        print(f"\nProcessing cross-wavelet: {data_type1} vs {data_type2}")
    
    # Load both time series
    data1, time1, dt1, std1, var1 = load_and_prepare_timeseries(video_id, data_type1)
    data2, time2, dt2, std2, var2 = load_and_prepare_timeseries(video_id, data_type2)
    
    if data1 is None or data2 is None:
        if VERBOSE:
            print(f"  Failed to load data for {data_type1} or {data_type2}")
        return None
    
    # Ensure both series have the same time base
    # Find common time range
    t_start = max(time1[0], time2[0])
    t_end = min(time1[-1], time2[-1])
    
    # Check minimum overlap
    overlap_fraction = (t_end - t_start) / max(time1[-1] - time1[0], time2[-1] - time2[0])
    if overlap_fraction < MIN_COMMON_TIME_FRACTION:
        if VERBOSE:
            print(f"  Insufficient overlap ({overlap_fraction:.1%} < {MIN_COMMON_TIME_FRACTION:.1%})")
        return None
    
    # Use the smaller dt (higher sampling rate)
    dt = min(dt1, dt2)
    
    # Create common time array
    n_samples = int((t_end - t_start) / dt) + 1
    time_common = np.linspace(t_start, t_end, n_samples)
    
    # Interpolate both series to common time base
    if INTERPOLATION_METHOD == 'linear':
        data1_interp = np.interp(time_common, time1, data1)
        data2_interp = np.interp(time_common, time2, data2)
    elif INTERPOLATION_METHOD == 'cubic':
        from scipy.interpolate import interp1d
        f1 = interp1d(time1, data1, kind='cubic', fill_value='extrapolate')
        f2 = interp1d(time2, data2, kind='cubic', fill_value='extrapolate')
        data1_interp = f1(time_common)
        data2_interp = f2(time_common)
    else:
        data1_interp = np.interp(time_common, time1, data1)
        data2_interp = np.interp(time_common, time2, data2)
    
    if VERBOSE:
        print(f"  Common time base: {len(time_common)} points, dt={dt:.4f}")
    
    # Apply edge taper if requested
    if EDGE_TAPER:
        # scipy>=1.13 moved tukey to scipy.signal.windows; fall back for older versions.
        tukey = getattr(signal, "tukey", None) or signal.windows.tukey
        window = tukey(len(time_common), alpha=TAPER_ALPHA)
        data1_interp = data1_interp * window
        data2_interp = data2_interp * window
        if DEBUG_MODE and VERBOSE:
            print(f"  Applied Tukey window with α={TAPER_ALPHA}")
    
    # Compute cross-wavelet transform using standard approach
    cwt_results = compute_cross_wavelet_standard(
        data1_interp, data2_interp, time_common, dt,
        mother=MOTHER_WAVELET, omega0=OMEGA0, dj=DJ,
        max_period=_tuning(config).get("maxPeriod")
    )
    
    # Calculate scale-averaged wavelet power
    period = cwt_results['period']
    power = cwt_results['power']
    
    # Determine scale-averaging band
    band = _tuning(config).get("scaleAvgBand")
    if band and len(band) == 2:
        # Given in seconds, so it means the same thing whatever dt is.
        avg_period_min = float(band[0])
        avg_period_max = min(float(band[1]), period[-1])
    elif SCALE_AVG_BAND_AUTO:
        avg_period_min = S0_FACTOR * dt
        avg_period_max = min(SCALE_AVG_MAX_PERIOD * dt, period[-1] / 2)
    else:
        avg_period_min = SCALE_AVG_MIN_PERIOD * dt
        avg_period_max = min(SCALE_AVG_MAX_PERIOD * dt, period[-1])
    
    sel = find((period >= avg_period_min) & (period <= avg_period_max))
    
    if len(sel) > 0:
        # Scale-averaged power
        Cdelta = cwt_results['mother'].cdelta
        # Create scale matrix properly for broadcasting: (n_scales, n_times)
        scale_avg = cwt_results['scales'][:, np.newaxis] * np.ones((1, len(time_common)))
        scale_avg = power / scale_avg
        scale_avg_power = cwt_results['dj'] * dt / Cdelta * scale_avg[sel, :].sum(axis=0)
        
        # Significance for scale-averaged power
        scale_avg_signif, _ = wavelet.significance(
            1.0, dt, cwt_results['scales'], 2, 
            np.mean([cwt_results['alpha1'], cwt_results['alpha2']]),
            significance_level=SIGNIFICANCE_LEVEL,
            dof=[cwt_results['scales'][sel[0]], cwt_results['scales'][sel[-1]]],
            wavelet=cwt_results['mother']
        )
        
        if VERBOSE:
            print(f"  Scale-averaging band: {avg_period_min:.2f} - {avg_period_max:.2f}")
    else:
        scale_avg_power = np.zeros(len(time_common))
        scale_avg_signif = 0
        if VERBOSE:
            print("  Warning: No scales in averaging band")
    
    # Calculate summary statistics
    stats = calculate_summary_statistics(cwt_results, time_common, scale_avg_power, scale_avg_signif)
    
    # Downsample for storage
    downsampled = downsample_for_storage(cwt_results, time_common, scale_avg_power)
    
    # Prepare output data structure
    result = {
        'data_type1': data_type1,
        'data_type2': data_type2,
        'dt': float(dt),
        'time_range': [float(t_start), float(t_end)],
        'n_samples': int(n_samples),
        'mother_wavelet': MOTHER_WAVELET,
        'omega0': OMEGA0 if MOTHER_WAVELET.lower() == 'morlet' else None,
        'dj': float(cwt_results['dj']),
        's0': float(cwt_results['s0']),
        'J': float(cwt_results['J']),
        'alpha1': float(cwt_results['alpha1']),
        'alpha2': float(cwt_results['alpha2']),
        'statistics': stats,
        'scale_avg_band': [float(avg_period_min), float(avg_period_max)],
        'visualization': downsampled
    }
    
    # Add metadata if requested
    if SAVE_METADATA:
        result['metadata'] = {
            'detrend': DETREND_DATA,
            'detrend_order': DETREND_ORDER if DETREND_DATA else None,
            'edge_taper': EDGE_TAPER,
            'taper_alpha': TAPER_ALPHA if EDGE_TAPER else None,
            'significance_level': SIGNIFICANCE_LEVEL,
            'coherence_threshold': HIGH_COHERENCE_THRESHOLD,
            'interpolation_method': INTERPOLATION_METHOD
        }
    
    # Save full resolution if requested
    if SAVE_FULL_RESOLUTION:
        result['full_resolution'] = {
            'power': np.real(cwt_results['power']).tolist(),
            'coherence': np.real(cwt_results['coherence']).tolist(),
            'phase': np.real(cwt_results['phase']).tolist()
        }
        if VERBOSE:
            print("  Warning: Full resolution data saved (large file size)")
    
    return result

def main():
    parser = argparse.ArgumentParser(description='Generate Cross-Wavelet data for DIMS Dashboard')
    parser.add_argument('--config', default='config.json', help='Path to config.json')
    parser.add_argument('--output-dir', default=OUTPUT_DIR, help='Output directory for cross-wavelet data')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    args = parser.parse_args()
    
    # Override global settings if command-line args provided
    global VERBOSE, DEBUG_MODE
    if args.verbose:
        VERBOSE = True
    if args.debug:
        DEBUG_MODE = True
        VERBOSE = True
    
    # Load config
    with open(args.config, 'r') as f:
        config = json.load(f)
    
    # Check if cross-wavelet is requested
    if 'include_crosswavelet' not in config or not config['include_crosswavelet']:
        if VERBOSE:
            print("No cross-wavelet analysis requested in config")
        return
    
    # include_crosswavelet may be either:
    #   * a list of explicit [type1, type2] pairs (new, lets the user pick exactly
    #     which pairs to compute), or
    #   * a legacy flat list of data types, expanded to all unique pairs below.
    raw_cwt = config['include_crosswavelet']
    if all(isinstance(item, (list, tuple)) and len(item) == 2 for item in raw_cwt):
        base_pairs = [(t1, t2) for t1, t2 in raw_cwt]
    else:
        flat_types = [t for t in raw_cwt if isinstance(t, str)]
        if len(flat_types) < 2:
            print("Error: Need at least 2 data types for cross-wavelet analysis")
            return
        base_pairs = []
        for i in range(len(flat_types)):
            for j in range(i + 1, len(flat_types)):
                base_pairs.append((flat_types[i], flat_types[j]))

    if not base_pairs:
        print("Error: No valid cross-wavelet pairs found")
        return
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Print configuration summary if verbose
    if VERBOSE:
        print("\n" + "="*60)
        print("CROSS-WAVELET ANALYSIS CONFIGURATION")
        print("="*60)
        print(f"Mother Wavelet: {MOTHER_WAVELET}")
        if MOTHER_WAVELET.lower() == 'morlet':
            print(f"  Omega0: {OMEGA0}")
        print(f"Frequency Resolution (dj): {DJ}")
        print(f"Smallest Scale Factor: {S0_FACTOR}")
        print(f"Significance Level: {SIGNIFICANCE_LEVEL*100}%")
        print(f"Detrending: {DETREND_DATA} (order {DETREND_ORDER})" if DETREND_DATA else "Detrending: False")
        print(f"Edge Tapering: {EDGE_TAPER} (α={TAPER_ALPHA})" if EDGE_TAPER else "Edge Tapering: False")
        print(f"High Coherence Threshold: {HIGH_COHERENCE_THRESHOLD}")
        print(f"Visualization Resolution: {MAX_TIME_POINTS_VIZ} × {MAX_FREQ_POINTS_VIZ}")
        print(f"Output Format: {OUTPUT_FORMAT}")
        print("="*60)
    
    # Process each video
    for video_id in config['videoIDs']:
        if VERBOSE:
            print(f"\n{'='*50}")
            print(f"Processing video: {video_id}")
            print(f"{'='*50}")
        
        # Process all pairs
        cwt_results = {}
        
        # Pairs to compute (optionally adding the reverse of each for symmetry).
        pairs_to_compute = []
        for data_type1, data_type2 in base_pairs:
            pairs_to_compute.append((data_type1, data_type2))
            if SYMMETRIC_PAIRS:
                pairs_to_compute.append((data_type2, data_type1))
        
        if VERBOSE:
            print(f"Computing {len(pairs_to_compute)} pair(s)")
        
        # Process each pair
        for data_type1, data_type2 in pairs_to_compute:
            pair_key = f"{data_type1}_vs_{data_type2}"
            
            result = process_cross_wavelet_pair(
                video_id, data_type1, data_type2, config
            )
            
            if result:
                cwt_results[pair_key] = result
        
        # Save results
        if cwt_results:
            # Determine output format and save
            if OUTPUT_FORMAT in ['json', 'both']:
                output_path = os.path.join(args.output_dir, f"{video_id}_crosswavelet_data.json")
                
                output_data = {
                    'video_id': video_id,
                    'crosswavelet_pairs': cwt_results,
                    'data_types': sorted({t for pair in base_pairs for t in pair}),
                    'config': {
                        'mother_wavelet': MOTHER_WAVELET,
                        'omega0': OMEGA0 if MOTHER_WAVELET.lower() == 'morlet' else None,
                        'dj': DJ,
                        's0_factor': S0_FACTOR,
                        'significance_level': SIGNIFICANCE_LEVEL,
                        'high_coherence_threshold': HIGH_COHERENCE_THRESHOLD,
                        'detrend': DETREND_DATA,
                        'edge_taper': EDGE_TAPER
                    },
                    'processing_info': {
                        'pairs_computed': len(cwt_results),
                        'coi_excluded_from_stats': COI_EXCLUDE,
                        'visualization_resolution': f"{MAX_TIME_POINTS_VIZ}x{MAX_FREQ_POINTS_VIZ}"
                    }
                }
                
                with open(output_path, 'w') as f:
                    json.dump(output_data, f, indent=2)
                
                print(f"\nSaved cross-wavelet data to {output_path}")
            
            if OUTPUT_FORMAT in ['npz', 'both']:
                # Save as compressed NumPy format for easier loading in Python
                output_path_npz = os.path.join(args.output_dir, f"{video_id}_crosswavelet_data.npz")
                np.savez_compressed(output_path_npz, **cwt_results)
                print(f"Saved cross-wavelet data to {output_path_npz}")
            
            # Print summary
            if VERBOSE:
                print("\nSummary of Cross-Wavelet Analysis:")
                for pair_key, result in cwt_results.items():
                    stats = result['statistics']
                    print(f"\n  {pair_key}:")
                    print(f"    - Max coherence: {stats['max_coherence']:.3f}")
                    print(f"    - Mean coherence: {stats['mean_coherence']:.3f}")
                    print(f"    - High coherence fraction: {stats['high_coherence_fraction']*100:.1f}%")
                    print(f"    - Time points: {len(result['visualization']['time'])}")
                    print(f"    - Frequency bins: {len(result['visualization']['freqs'])}")
                    print(f"    - AR1 coefficients: α₁={result['alpha1']:.3f}, α₂={result['alpha2']:.3f}")
    
    print("\nCross-wavelet processing complete!")
    
    if not VERBOSE:
        print("\nNote: Run with --verbose flag for detailed output")
    print("Note: Install required packages with:")
    print("  pip install pycwt numpy pandas scipy")

if __name__ == "__main__":
    main()
