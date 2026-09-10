// Cross-effector network tab.
//
// Nodes are measures, edges are the coherence between them, and both follow the
// playhead: the picture at 40 s is the coupling in the window around 40 s, not
// an average over the whole recording.
//
// This existed in one private study, where nobody else could use it, and it was
// the **only** consumer in the whole system of the Monte Carlo coherence null --
// the thing that costs ORTHO about 2.8 hours. So the core computed a number
// whose only reader lived somewhere the core could not see. It is an ordinary
// built-in tab now, gated by `include_network` like every other tab is gated by
// its own key, and everything study-specific about it comes from config.
//
// It needs `sig95_wtc`, and when a study has not computed one it says so rather
// than drawing. A coherence value has no meaningful zero: it is a ratio taken
// over a smoothing neighbourhood, so under independence it does not sit near 0
// but near 0.25, and exceeds ~0.59 five percent of the time. An edge reading
// 0.27 is not "weak coupling", it is *no* coupling, and nothing in the raw
// number says so.
//
// See docs/contracts/tab.md and docs/contracts/analysis-output.md (A8).
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const MIN_WIDTH = 1.5;      // px stroke at the bottom of the visible range
    const MAX_WIDTH = 16;       // px stroke at the top of it

    // The body itself — its coordinate space, its parts and how a name maps to
    // one — lives in figure-geometry.js beside this file, because the wizard's
    // step 4 diagram draws the same figure and the two must agree to the pixel.
    // Change a number there, not here.
    //
    // Missing is reported, not thrown: throwing here would stop this file before
    // it registers the tab, and a tab that is simply absent tells the reader
    // nothing. FIGURE_MISSING is surfaced where the tab draws.
    const FIG = (typeof window !== 'undefined' && window.DIMS_FIGURE) || null;
    const FIGURE_MISSING = FIG ? null
        : 'The network is drawn from vendor/dims-tabs/figure-geometry.js, and '
        + 'that file did not load. Its <script> tag belongs in index.html before '
        + 'the tabs — `dims-case sync` writes it for you.';
    const FALLBACK = { VIEW_W: 1000, NODE_R: 26, TAB_NODE_R: 12, SHOULDER_Y: 150,
                       HIP_Y: 330, FOOT_Y: 545, BODY_TOKENS: [],
                       positions: () => ({}), bodyPart: () => null,
                       bowRanks: () => [], bowStep: () => 30,
                       edgePath: () => '' };
    const G = FIG || FALLBACK;
    const { VIEW_W, NODE_R, TAB_NODE_R, SHOULDER_Y, HIP_Y, FOOT_Y } = G;
    // The fan, and the curve it spaces. Shared with the wizard's diagram — see
    // figure-geometry.js for why an edge is bowed at all.
    const { bowRanks, bowStep, edgePath } = G;
    const BODY_PARTS = G.BODY_TOKENS;
    const figurePositions = G.positions;
    const bodyPart = G.bodyPart;

    // The chart's own height. Not part of the shared body: the wizard's diagram
    // is a different shape, and only this file maps `y` fractions onto it.
    const VIEW_H = 560;

    // What independence gives. An edge whose significant share sits at or below
    // this is drawn as a dashed hairline: it is a measurement, and the
    // measurement says "nothing here".
    const CHANCE = 0.05;
    // Enough above chance to call an edge real. Deliberately not 0.05 + epsilon:
    // the fraction is itself estimated, and a threshold at the chance level
    // turns half the at-chance edges solid.
    const REAL = 0.15;

    // ---- what an edge is made of ---------------------------------------------
    //
    // Two questions, and an edge answers one of them at a time.
    //
    // **Coherence** asks whether the two measures held a steady phase relation.
    // It is amplitude-normalised on purpose, so it says nothing about how much
    // either of them moved: a thick coherence edge can be two nearly-still
    // measures whose jitter has a shared source, which is the common case when
    // both are tracked from one video.
    //
    // **Power** asks whether both were moving at all, at this timescale. The
    // cross-wavelet transform is `W1 * conj(W2)`, so its magnitude is exactly
    // `|W1| |W2|` -- the product of the two amplitude envelopes, and nothing to
    // do with phase. Divided by `signif_xwt`, its own per-scale red-noise level
    // (Torrence & Compo eq. 31, itself normalised by the two series' standard
    // deviations), the result is dimensionless, comparable between pairs, and
    // significant exactly where it exceeds 1.
    //
    // So a fat power edge means "both of these were busy", **not** "these two
    // were coupled". Read the pair: thick in coherence and thin in power is the
    // stillness case, which is why the tooltip carries both numbers in both
    // modes.
    //
    // `signif_xwt` is analytic rather than sampled, so it is in every payload
    // even when the Monte Carlo coherence null is not -- power mode works in a
    // study that never paid for `mcCount`.
    const MODES = {
        coherence: {
            grid: 'coherence',
            level: 'sig95_wtc',
            //: Coherence is compared against its level; power is divided by it.
            normalise: false,
            value: 'mean coherence',
            noun: 'coherence',
            //: How the significant share is described. "Above chance" is right
            //: for coherence, whose null is a chance level, and wrong for power,
            //: where it would read as a claim about coupling.
            beat: 'above chance',
            //: Named in the tooltip when an edge cannot be tested at all.
            missing: 'no coherence null in this output, so this value cannot|'
                + 'be tested. Set analysis.crosswavelet.mcCount and rebuild.',
        },
        power: {
            grid: 'power',
            level: 'signif_xwt',
            normalise: true,
            value: 'mean power / its 95% level',
            noun: 'shared power',
            beat: 'above its own 95% power level',
            // `mcCount` is the coherence null and has nothing to do with this
            // level, so naming it here would send the reader to rebuild for a
            // field that is already present.
            missing: 'no usable power level for this pair, so this value|'
                + 'cannot be tested.',
        },
    };

    function modeSpec(mode) {
        return MODES[mode] || MODES.coherence;
    }

    // In [0,1] whatever the mode, and the only thing the width scale sees.
    //
    // Coherence is already bounded. The power ratio is not -- it runs from 0 to
    // tens -- and feeding it raw to `widthFor` would clip every edge above the
    // 95 % level to the same maximum width. `r / (1 + r)` is `0.5 + 0.5 *
    // tanh(ln(r) / 2)`: a logistic in log space, so a soft-clipped log2 scale
    // that never actually clips, keeping every pair of edges in the right
    // order. It also makes the pivot quasi-geometric, which is the right centre
    // for a ratio -- an arithmetic mean would let one strong pair set the scale
    // every other edge is judged against.
    //
    // The cost: sensitivity per octave is `ln2 * r / (1 + r)^2`, about 0.17 near
    // the level and 0.03 at twenty times it, so the scale separates weak edges
    // more finely than strong ones. Width in power mode ranks edges; it does not
    // read out the ratio, which the tab says in its legend and the docs say at
    // length. The number itself is in the tooltip.
    function weightOf(mean, spec) {
        if (mean === null || !Number.isFinite(mean)) return null;
        if (!spec.normalise) return mean;
        return mean / (1 + mean);
    }

    // ---- reading the payload -------------------------------------------------

    // Every measure that appears in a pair, in the order the pairs list them, so
    // a study controls the layout by ordering its config rather than by editing
    // this file.
    function measuresIn(pairs) {
        const seen = [];
        Object.values(pairs).forEach(p => {
            [p.data_type1, p.data_type2].forEach(name => {
                if (name && !seen.includes(name)) seen.push(name);
            });
        });
        return seen;
    }

    // A study says how its measures group -- two people, two conditions, two
    // instruments. There are two ways to say it, and `effectors` wins where it
    // is given.
    //
    // The older way infers everything from the measure's name: a regular
    // expression per group, the display label is the name with that expression
    // deleted, and the body part is a token found somewhere inside what is left.
    // That works for a study that encodes person, part and quantity in one
    // string -- `teacher_righthandspeed` -- and says nothing about a study whose
    // measures are called `bodysync` and `neuralsync`, where every measure falls
    // into one undifferentiated group.
    //
    // The newer way is a declaration: `effectors: [{series, group, label, part,
    // x, y}]`. Nothing is parsed out of a name. It is opt-in because the
    // inference is what every existing study relies on.
    function grouping(config, measures) {
        const spec = (config && config.include_network) || {};
        const defined = Array.isArray(spec.groups) ? spec.groups : [];
        const declared = Array.isArray(spec.effectors) ? spec.effectors : [];
        return declared.length
            ? declaredGrouping(defined, declared, measures)
            : matchedGrouping(defined, measures);
    }

    function matchedGrouping(defined, measures) {
        const groups = defined.map((g, i) => ({
            label: g.label || `Group ${i + 1}`,
            color: g.color || null,
            match: g.match ? new RegExp(g.match, 'i') : null,
            members: [],
        }));
        const rest = { label: groups.length ? 'Other' : 'Measures',
                       color: null, match: null, members: [] };

        measures.forEach(name => {
            const hit = groups.find(g => g.match && g.match.test(name));
            (hit || rest).members.push(name);
        });
        if (rest.members.length) groups.push(rest);
        return groups.filter(g => g.members.length);
    }

    // Nodes the study named, in the order it named them, plus anything the
    // pairs mention that it did not.
    //
    // Two cases are deliberately visible rather than quiet. A declared effector
    // whose series appears in no pair is still drawn, as a node with no edges:
    // it says "you asked for this and cross-wavelet does not cover it", which is
    // the question a reader would otherwise have to ask the config. And a
    // measure that turns up in a pair but no effector declares lands in the
    // trailing group, exactly as an unmatched name does above -- losing a
    // measure because a list was incomplete would be the worst of both schemes.
    function declaredGrouping(defined, declared, measures) {
        const groups = defined.map((g, i) => ({
            label: g.label || `Group ${i + 1}`,
            color: g.color || null,
            match: null,                    // declared members, not matched ones
            members: [],
            declared: {},
        }));
        const byLabel = new Map(groups.map(g => [g.label, g]));
        const rest = { label: 'Other', color: null, match: null,
                       members: [], declared: {} };

        const placed = new Set();
        declared.forEach(entry => {
            const name = entry && entry.series;
            if (!name || placed.has(name)) return;   // a duplicate is one node
            placed.add(name);
            // A group nobody defined is a typo, not an instruction to invent a
            // column: the node still appears, in `Other`, where it is obvious.
            const group = byLabel.get(entry.group) || rest;
            group.members.push(name);
            group.declared[name] = {
                label: entry.label || name,
                part: entry.part || null,
                x: Number.isFinite(entry.x) ? entry.x : null,
                y: Number.isFinite(entry.y) ? entry.y : null,
            };
        });

        measures.forEach(name => {
            if (!placed.has(name)) rest.members.push(name);
        });

        if (rest.members.length) groups.push(rest);
        return groups.filter(g => g.members.length);
    }

    // The part of a name that is not what put it in its group, so a chart of
    // "teacher_righthand" and "student_righthand" reads "righthand" twice rather
    // than repeating the group in every label.
    function nodeLabel(name, group) {
        if (!group.match) return name;
        const stripped = name.replace(group.match, '').replace(/^[_\-\s]+/, '');
        return stripped || name;
    }

    // ---- one edge ------------------------------------------------------------

    // Reduce a pair's coherence grid over the time window [t0, t1] (or the whole
    // record when t0 is null) and the periods inside `band`.
    //
    // A cell is **usable** when it is finite, inside the band, and outside the
    // cone of influence -- near the start and end of a recording the wavelet
    // window extends past the data, so what is there is an edge artefact of the
    // transform rather than a measurement.
    //
    // The value and the verdict do not always run over the same cells, and the
    // difference is the mode's. In power mode the level is the divisor, so a
    // period without a usable one has no value at all and leaves both. In
    // coherence mode a value is still a value without a threshold to judge it
    // against, so such a period stays in the mean and leaves only the test --
    // which is why `cells` and `tested` are reported separately.
    //
    // Returns the mean, which drives the width, and the share of usable cells
    // beating the coherence null, which decides whether the edge is a finding.
    // That share is `null` when the payload carries no null -- not zero, and not
    // quietly treated as significant.
    function reduceEdge(vis, t0, t1, band, mode) {
        const spec = modeSpec(mode);
        const empty = { mean: null, weight: null, fraction: null,
                        tested: 0, cells: 0 };
        if (!vis || !vis.time || !vis[spec.grid]) return empty;

        const grid = window.DIMS.decodeArray(vis[spec.grid]);
        const time = vis.time;
        const period = vis.period || [];
        const coi = vis.coi;
        const levels = Array.isArray(vis[spec.level]) ? vis[spec.level] : null;
        // Power is the ratio to its level, so without levels there is no value
        // to report at all -- and falling back to raw power would clip every
        // edge to the maximum width. Nothing, not a wrong number.
        if (spec.normalise && !levels) return empty;
        const lo = (band && band[0] != null) ? band[0] : 0;
        const hi = (band && band[1] != null) ? band[1] : Infinity;
        const whole = (t0 === null || t0 === undefined);

        const cols = [];
        for (let j = 0; j < time.length; j++) {
            if (whole || (time[j] >= t0 && time[j] <= t1)) cols.push(j);
        }
        if (!cols.length) {
            // The window fell outside the record. Use the nearest column rather
            // than reporting nothing, so scrubbing past the end does not blank
            // the whole picture.
            const mid = (t0 + t1) / 2;
            let best = 0, bestD = Infinity;
            for (let j = 0; j < time.length; j++) {
                const d = Math.abs(time[j] - mid);
                if (d < bestD) { bestD = d; best = j; }
            }
            cols.push(best);
        }

        let sum = 0, n = 0, tested = 0, significant = 0;
        for (let i = 0; i < grid.length; i++) {
            if (period.length && !(period[i] >= lo && period[i] <= hi)) continue;
            const row = grid[i];
            if (!row) continue;
            const level = levels ? levels[i] : undefined;
            // A null level marks a period row lying entirely inside the cone,
            // where no threshold could be estimated. Skipped, not counted as
            // always-significant. Zero and negative go the same way: a level of
            // 0 would call every cell significant, and in power mode it is the
            // divisor as well -- the same rule the cross-wavelet contour uses.
            const levelOk = Number.isFinite(level) && level > 0;
            // Where the level is the divisor, a row without one has no value at
            // all: it leaves the mean as well as the test, not just the test.
            if (spec.normalise && !levelOk) continue;
            for (let k = 0; k < cols.length; k++) {
                const j = cols[k];
                const v = row[j];
                // null means the value is undefined here: neither signal had
                // energy in this band. Absent, not zero.
                if (v === null || v === undefined || Number.isNaN(v)) continue;
                if (period.length && coi && !(period[i] < coi[j])) continue;
                const value = spec.normalise ? v / level : v;
                sum += value; n++;
                if (levelOk) {
                    tested++;
                    if (value > (spec.normalise ? 1 : level)) significant++;
                }
            }
        }
        const mean = n ? sum / n : null;
        return {
            mean,
            weight: weightOf(mean, spec),
            fraction: tested ? significant / tested : null,
            tested, cells: n,
        };
    }

    //: The colour a selected edge takes. One accent, so "selected" reads as a
    //: state rather than as another measurement.
    const EDGE_ACCENT = '#e17055';

    // The shortest and longest period any edge actually has, for the band
    // control's bounds -- taken from the data rather than assumed, because a
    // study caps `maxPeriod` and the control must not offer what is not there.
    function periodBounds(edges) {
        let lo = Infinity, hi = 0;
        edges.forEach(e => {
            const per = e.pair && e.pair.visualization && e.pair.visualization.period;
            if (per && per.length) {
                lo = Math.min(lo, per[0]);
                hi = Math.max(hi, per[per.length - 1]);
            }
        });
        return [Number.isFinite(lo) ? lo : 0, hi || 12];
    }

    function numberInput(id, value, bounds) {
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.step = '0.1';
        input.min = String(bounds[0]);
        input.max = String(bounds[1]);
        input.value = String(Number(value).toFixed(2));
        input.style.width = '80px';
        return input;
    }

    function verdictOf(edge, threshold) {
        if (edge.fraction === null) return 'untestable';
        if (edge.fraction >= (Number.isFinite(threshold) ? threshold : REAL)) {
            return 'real';
        }
        return 'chance';
    }

    // Both measures, whichever one is driving the width. Coherence alone cannot
    // tell you whether it was computed out of stillness and power alone cannot
    // tell you whether anything was coupled; the diagnosis is the pair, and a
    // reader should not have to flip the control to get it.
    function edgeTitle(pairKey, edge, band, mode, alt) {
        const spec = modeSpec(mode);
        const other = modeSpec(mode === 'power' ? 'coherence' : 'power');
        const show = (e) => (e && e.mean !== null ? e.mean.toFixed(3) : '—');
        const lines = [`${pairKey.replace('_vs_', '  ↔  ')}`,
                       `${spec.value}: ${show(edge)}`,
                       band ? `periods ${band[0]}–${band[1]} s, outside the cone of influence`
                            : 'every period, outside the cone of influence'];
        if (edge.fraction === null) {
            lines.push(...spec.missing.split('|'));
        } else {
            lines.push(`${spec.beat} in ${(edge.fraction * 100).toFixed(1)}% of `
                       + `${edge.tested} tested cells`,
                       `(independence gives about ${(CHANCE * 100).toFixed(0)}%)`);
        }
        if (alt) lines.push(`for comparison, ${other.value}: ${show(alt)}`);
        return lines.join('\n');
    }

    // ---- drawing -------------------------------------------------------------

    function layout(groups, style) {
        return style === "figure" ? figureLayout(groups) : columnLayout(groups);
    }

    // What a declared effector said about this node, or nothing.
    function declarationFor(group, name) {
        return (group.declared && group.declared[name]) || null;
    }

    // `x` and `y` are fractions of the chart, not units of it. VIEW_W and
    // VIEW_H are private constants of this file that have been tuned in place,
    // and a config written in raw units would drift the day one of them moves,
    // silently, in a study nobody is editing. A fraction is defined against
    // "the chart", which is stable.
    function fractionX(v) { return v === null ? null : v * VIEW_W; }
    function fractionY(v) { return v === null ? null : v * VIEW_H; }

    function columnLayout(groups) {
        // One column per group, members spread down it. Simple on purpose: a
        // force layout moves nodes between frames, and this picture is read by
        // comparing one moment with another.
        const positions = {};
        const n = groups.length;
        groups.forEach((group, gi) => {
            const cx = VIEW_W * (gi + 1) / (n + 1);
            const count = group.members.length;
            group.members.forEach((name, mi) => {
                const span = VIEW_H - 180;
                const y = count === 1 ? VIEW_H / 2
                    : 110 + span * mi / (count - 1);
                const d = declarationFor(group, name);
                positions[name] = {
                    x: (d && fractionX(d.x)) ?? cx,
                    y: (d && fractionY(d.y)) ?? y,
                    group,
                    label: (d && d.label) || nodeLabel(name, group),
                };
            });
        });
        separate(positions);
        return positions;
    }

    // Each group is a person, and each measure sits where its body part is. A
    // measure whose part the vocabulary does not recognise is stacked beside the
    // figure rather than dropped: losing a measure because a lookup table had
    // not heard of it would be worse than the column this replaces.
    function figureLayout(groups) {
        const positions = {};
        const n = groups.length;
        groups.forEach((group, gi) => {
            const cx = VIEW_W * (gi + 1) / (n + 1);
            const spots = figurePositions(cx);
            group.cx = cx;
            let strays = 0;
            group.members.forEach((name) => {
                const d = declarationFor(group, name);
                const label = (d && d.label) || nodeLabel(name, group);
                // A declared part is a statement; a sniffed one is a guess.
                const part = d ? d.part : (bodyPart(label) || bodyPart(name));
                const at = part && spots[part];
                const base = at
                    ? { x: at.x, y: at.y, group, label, part }
                    : { x: cx + 150, y: 110 + (strays++) * 70, group, label,
                        part: null };
                // Explicit coordinates win over the slot. `x` omitted keeps the
                // node on its own figure's centre line, which is the only way to
                // say "on this person, lower down" -- an explicit x is absolute
                // and does not follow a figure when a third group is added.
                if (d && d.x !== null) base.x = fractionX(d.x);
                if (d && d.y !== null) base.y = fractionY(d.y);
                positions[name] = base;
            });
        });
        separate(positions);
        return positions;
    }

    // Two measures on one spot draw one circle over another, with a
    // zero-length edge between them that cannot be clicked. `figurePositions`
    // makes this reachable without anyone asking for it -- `head` and `nose`
    // are the same point, and so are `hand` and `lefthand` -- so a study with
    // both loses a node to a coincidence it never declared.
    //
    // Nudged apart horizontally, least-recently-placed to the right, which
    // keeps them on the body part they belong to and visibly distinct. The step
    // is the wizard's NODE_R, not the tab's smaller one: this is a distance
    // between two places on a body, and it should not move when the dot drawn
    // at one of them changes size.
    function separate(positions) {
        const seen = new Map();
        Object.keys(positions).forEach(name => {
            const p = positions[name];
            const key = `${Math.round(p.x)},${Math.round(p.y)}`;
            const n = seen.get(key) || 0;
            if (n) p.x += n * (NODE_R * 1.4);
            seen.set(key, n + 1);
        });
    }

    function el(name, attrs) {
        const node = document.createElementNS(SVG_NS, name);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v !== null && v !== undefined) node.setAttribute(k, String(v));
        });
        return node;
    }

    // Every edge on screen gets its own rank, so the whole set fans and no two
    // lines are drawn on top of each other. Ranking only the edges that *share
    // endpoints* is not enough and was the bug this replaces: it left every
    // other edge at the floor, so the ones merely converging on a node — which
    // is all of the cross-group ones — arrived as a single smear.
    function assignBowRanks(edges) {
        const ranks = bowRanks(edges.length);
        edges.forEach((e, i) => { e.bowRank = ranks[i]; });
        return bowStep(edges.length);
    }

    // A translucent body under the nodes, drawn from the shared geometry.
    function appendFigure(svg, group, cx, theme) {
        return FIG.appendFigure(svg, {
            cx, color: group.color || theme.trace, el,
        });
    }

    // Width against the group, not against the absolute scale. Coherence sits
    // in a narrow band -- often 0.7 to 0.8 across every pair in a study -- so a
    // width mapped from 0 to 1 makes every line the same and says nothing. This
    // pivots on the mean of the edges currently on screen and `flex` decides how
    // hard the differences are pushed apart.
    const FLEX_MIN = 0, FLEX_MAX = 30, FLEX_DEFAULT = 10;

    function widthFor(weight, centre, flex) {
        // An edge with nothing to measure is not an edge of zero strength. It
        // never reaches here today -- it is dashed at MIN_WIDTH instead -- but
        // saying so is cheaper than relying on that chain staying true.
        if (!Number.isFinite(weight)) return MIN_WIDTH;
        const c = Math.max(0, Math.min(1, weight));
        const mid = (centre === null || centre === undefined) ? 0.5 : centre;
        const norm = Math.max(0, Math.min(1, 0.5 + (c - mid) * (flex ?? FLEX_DEFAULT)));
        return MIN_WIDTH + norm * (MAX_WIDTH - MIN_WIDTH);
    }

    window.DIMS.extendHost({
        async loadNetworkData(videoID) {
            this.showStatus('Loading cross-effector network...');
            try {
                const path = `assets/crosswavelet/${videoID}_crosswavelet_data.json`;
                const data = await this.loadJSON(path);
                const stale = data && window.DIMS.payloadProblem(data, 'cross-wavelet output');
                if (stale) { this.showError(stale); return; }
                if (!data || !data.crosswavelet_pairs
                        || !Object.keys(data.crosswavelet_pairs).length) {
                    this.showError('The network is drawn from cross-wavelet output, '
                        + 'and none was found for this recording. Run the '
                        + 'cross-wavelet analysis first.');
                    return;
                }
                this.networkData = data;
                this.displayNetwork();
                // Every other tab pairs its "Loading..." with a settled line.
                // This one never did, so the tab sat on its loading message for
                // as long as the dashboard was open, and carried it to whatever
                // tab was opened next.
                this.showTabStatus();
            } catch (error) {
                console.error('Error loading network data:', error);
                this.showError(`Failed to load the network: ${error.message}`);
            }
        },

        // The period band the edges are averaged over. Kept on the host so it
        // survives a redraw and a video change.
        networkBand() {
            if (this._networkBand) return this._networkBand;
            const spec = (this.config && this.config.include_network) || {};
            this._networkBand = Array.isArray(spec.band) && spec.band.length === 2
                ? spec.band.slice() : null;
            return this._networkBand;
        },

        // Which question the edges answer. Kept on the host for the same reason
        // the band is: a redraw or a video change must not silently put the
        // reader back on a different measure than the one they chose.
        networkMode() {
            if (this._networkMode) return this._networkMode;
            const spec = (this.config && this.config.include_network) || {};
            this._networkMode = MODES[spec.mode] ? spec.mode : 'coherence';
            return this._networkMode;
        },

        // The share of tested cells that has to beat the 95 % level before an
        // edge is drawn solid. Remembered per mode, because the two are
        // different distributions: 0.15 was chosen against coherence, and the
        // fraction of cells above a red-noise power level is not the same
        // quantity. One number for both would judge one of them by the other's
        // yardstick.
        //
        // `!= null` rather than a truthiness test: 0 is a legitimate threshold
        // and `if (x)` would discard it on every render.
        networkThreshold(mode) {
            const key = mode || this.networkMode();
            this._networkThreshold = this._networkThreshold || {};
            if (this._networkThreshold[key] != null) return this._networkThreshold[key];
            const spec = (this.config && this.config.include_network) || {};
            const declared = (spec.threshold || {})[key];
            this._networkThreshold[key] = Number.isFinite(declared) ? declared : REAL;
            return this._networkThreshold[key];
        },

        // How hard the width scale pushes. Also per mode: the full stroke range
        // covers a window of +/-0.5/flex, and the two modes do not spread their
        // edges over the same interval.
        networkFlex(mode) {
            const key = mode || this.networkMode();
            this._networkFlex = this._networkFlex || {};
            return this._networkFlex[key] != null
                ? this._networkFlex[key] : FLEX_DEFAULT;
        },

        // The legend and the (i) help both describe the mode and quote the live
        // threshold, and the mode can change without a redraw -- a redraw would
        // reset the selection and close the detail figure under the reader. So
        // both are written here, from state, by whichever path last ran.
        syncNetworkWording() {
            const mode = this.networkMode();
            const spec = modeSpec(mode);
            const share = (this.networkThreshold() * 100).toFixed(0);

            const help = document.getElementById('networkHelp');
            if (help) {
                const common =
                    'Averaged over the period band below — the whole-recording '
                    + 'mean until you pick a point on the timeline, after which '
                    + 'it is that window. Cells inside the cone of influence, '
                    + 'near the start and end of the record where the wavelet '
                    + 'window runs past the data, are always excluded. Width is '
                    + 'relative to the other edges on screen, never an absolute '
                    + 'strength — hover any line for its numbers, click one for '
                    + 'its cross-wavelet detail.';
                help.textContent = mode === 'power'
                    ? 'Line width is how far the two measures\u2019 shared power '
                      + 'rises above what red noise alone would give at that '
                      + 'timescale. Cross-wavelet power is the product of the two '
                      + 'amplitudes and has nothing to do with phase, so a thick '
                      + 'line means both measures were moving — not that they '
                      + 'were coupled. Read it against coherence: thick there and '
                      + 'thin here is a coupling computed out of stillness. '
                      + 'Width ranks the edges on a log-like scale rather than '
                      + 'reading out the ratio; the ratio is in the tooltip. '
                      + common
                    : 'Line width is wavelet coherence between two measures. '
                      + 'Coherence asks whether they keep a steady phase '
                      + 'relationship and ignores how much either of them moved, '
                      + 'so a thick line can be two nearly-still measures whose '
                      + 'jitter has a shared source. Switch the edges to shared '
                      + 'power to tell those apart. '
                      + common;
            }

            const legend = document.getElementById('networkLegend');
            if (legend) {
                legend.innerHTML =
                    `Line width is ${spec.noun} <b>relative to the other edges `
                    + 'shown</b>, never an absolute strength. '
                    + `<b>Solid</b>: ${spec.beat} in more than `
                    + `${share}&nbsp;% of tested cells. `
                    + '<b>Dashed</b>: not distinguishable from that level — a '
                    + 'measurement, not a missing one. '
                    + 'Click a line for its cross-wavelet detail.';
            }

            const svg = document.getElementById('networkSvg');
            if (svg) {
                svg.setAttribute('aria-label',
                    `${spec.noun} between measures, following the playhead`);
            }
        },

        displayNetwork() {
            if (FIGURE_MISSING) { this.showError(FIGURE_MISSING); return; }
            const container = document.getElementById('networkContainer');
            if (!container || !this.networkData) return;
            container.innerHTML = '';

            const pairs = this.networkData.crosswavelet_pairs;
            const measures = measuresIn(pairs);
            const groups = grouping(this.config, measures);
            this._networkHidden = this._networkHidden || new Set();
            this._networkSelected = null;
            const style = ((this.config.include_network || {}).layout) || 'columns';
            const positions = layout(groups, style);
            const theme = window.DIMS.theme();

            // The explanation is long, and it is only long the first few times
            // you read it. It sits behind an (i), and whether it is open
            // survives a re-render -- a theme switch or a video change must not
            // reopen something the reader closed.
            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;';
            const heading = document.createElement('h2');
            heading.textContent = 'Cross-effector network';
            heading.style.margin = '0 0 4px';
            const info = document.createElement('button');
            info.type = 'button';
            info.id = 'networkInfoToggle';
            info.textContent = 'i';
            info.title = 'What this figure shows';
            info.setAttribute('aria-label', 'What this figure shows');
            info.style.cssText =
                'width:24px;height:24px;border-radius:50%;cursor:pointer;line-height:1;';
            titleRow.append(heading, info);
            container.appendChild(titleRow);

            const help = document.createElement('div');
            help.id = 'networkHelp';
            help.style.cssText =
                'opacity:.8;margin:8px 0 14px;max-width:70ch;font-size:13px;';
            info.setAttribute('aria-controls', help.id);
            const syncHelp = () => {
                help.style.display = this._networkHelpOpen ? '' : 'none';
                info.setAttribute('aria-expanded',
                                  this._networkHelpOpen ? 'true' : 'false');
            };
            info.addEventListener('click', () => {
                this._networkHelpOpen = !this._networkHelpOpen;
                syncHelp();
            });
            syncHelp();
            container.appendChild(help);

            const caption = document.createElement('p');
            caption.id = 'networkCaption';
            caption.style.cssText = 'margin:0 0 12px;opacity:0.8;font-size:13px;';
            container.appendChild(caption);

            const controlsHost = document.createElement('div');
            container.appendChild(controlsHost);

            const svg = el('svg', {
                id: 'networkSvg', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
                width: '100%', role: 'img',
                'aria-label': 'Coherence between measures, following the playhead',
            });
            svg.style.maxHeight = '70vh';
            container.appendChild(svg);

            // Figures first, under everything: they are context, not data.
            if (style === 'figure') {
                groups.forEach(group => {
                    const first = positions[group.members[0]];
                    if (first) appendFigure(svg, group, group.cx ?? first.x, theme);
                });
            }

            // Then edges, so nodes sit on top of them.
            const edgeLayer = el('g', { id: 'networkEdges' });
            svg.appendChild(edgeLayer);

            const drawable = Object.entries(pairs)
                .map(([pairKey, pair]) => ({ pairKey, pair }))
                .filter(e => positions[e.pair.data_type1] && positions[e.pair.data_type2]);
            // Ranked after the filter, so a pair whose measures are not on the
            // body does not take a place in the fan and skew it.
            const step = assignBowRanks(drawable);

            this._networkEdges = [];
            drawable.forEach(entry => {
                const a = positions[entry.pair.data_type1];
                const b = positions[entry.pair.data_type2];
                const line = el('path', {
                    d: edgePath(a, b, entry.bowRank, step), fill: 'none',
                    stroke: theme.trace, 'stroke-linecap': 'round',
                    'stroke-width': MIN_WIDTH, opacity: 0.5,
                });
                const title = el('title', {});
                line.appendChild(title);
                line.style.cursor = 'pointer';
                const record = { ...entry, line, title };
                line.addEventListener('click', () => this.selectNetworkEdge(record));
                edgeLayer.appendChild(line);
                this._networkEdges.push(record);
            });

            this.buildNetworkControls(controlsHost, this._networkEdges);

            groups.forEach(group => {
                group.members.forEach(name => {
                    const p = positions[name];
                    const node = el('circle', {
                        cx: p.x, cy: p.y, r: TAB_NODE_R, 'data-measure': name,
                        fill: group.color || theme.trace, opacity: 0.9,
                    });
                    node.appendChild(el('title', {})).textContent = name;
                    svg.appendChild(node);
                    const label = el('text', {
                        x: p.x, y: p.y + TAB_NODE_R + 16, 'text-anchor': 'middle',
                        fill: theme.font, 'font-size': 13,
                    });
                    label.textContent = p.label || nodeLabel(name, group);
                    svg.appendChild(label);
                });
                const p = positions[group.members[0]];
                if (p && group.label) {
                    const heading2 = el('text', {
                        x: group.cx ?? p.x,
                        y: style === 'figure' ? FOOT_Y + 35 : 60,
                        'text-anchor': 'middle',
                        fill: group.color || theme.font,
                        'font-size': 16, 'font-weight': 'bold',
                    });
                    heading2.textContent = group.label;
                    svg.appendChild(heading2);
                }
            });

            const legend = document.createElement('p');
            legend.id = 'networkLegend';
            legend.style.cssText = 'margin:10px 0 0;opacity:0.75;font-size:12px;';
            container.appendChild(legend);
            this.syncNetworkWording();

            const detail = document.createElement('div');
            detail.id = 'networkDetailPanel';
            detail.style.marginTop = '20px';
            container.appendChild(detail);

            this.updateNetwork();
        },

        // --- the controls ----------------------------------------------------

        buildNetworkControls(container, edges) {
            const wrap = document.createElement('div');
            wrap.className = 'network-controls';
            wrap.style.cssText =
                'display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:14px;';

            // Scope. Edges are whole-recording means until a point is picked on
            // the timeline, after which every value and every verdict is over
            // that window instead. Two different questions, and nothing used to
            // say which was on screen -- nor was there a way back, since the
            // host only ever sets the playhead.
            const scope = document.createElement('div');
            scope.innerHTML = '<div style="font-size:12px;opacity:.75">Showing</div>';
            const scopeText = document.createElement('span');
            scopeText.id = 'networkScope';
            const back = document.createElement('button');
            back.id = 'networkWholeBtn';
            back.type = 'button';
            back.textContent = 'whole recording';
            back.style.cssText = 'margin-left:8px;font-size:12px;';
            back.addEventListener('click', () => {
                this.lastClickedPoint = null;
                this.updateNetwork();
            });
            scope.append(scopeText, back);
            wrap.appendChild(scope);

            // Period band. The one control that changes the answer rather than
            // its presentation, so it reduces every edge again when it moves.
            const bounds = periodBounds(edges);
            const band = this.networkBand() || bounds;
            const bandBox = document.createElement('div');
            bandBox.innerHTML = '<div style="font-size:12px;opacity:.75">Period band (s)</div>';
            const lo = numberInput('networkBandLo', band[0], bounds);
            const hi = numberInput('networkBandHi', band[1], bounds);
            const onBand = () => {
                const a = Number(lo.value), b = Number(hi.value);
                if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
                this._networkBand = [a, b];
                this.updateNetwork();
            };
            lo.addEventListener('change', onBand);
            hi.addEventListener('change', onBand);
            bandBox.append(lo, document.createTextNode(' – '), hi);
            wrap.appendChild(bandBox);

            // Which measure the edges carry. Changes the answer, not its
            // presentation -- and changes what the legend and the help say, so
            // both are rewritten from the mode rather than built once.
            const mode = this.networkMode();
            const modeBox = document.createElement('div');
            modeBox.innerHTML = '<div style="font-size:12px;opacity:.75">Edges show</div>';
            const modeSel = document.createElement('select');
            modeSel.id = 'networkMode';
            [['coherence', 'coherence (phase)'],
             ['power', 'shared power (amplitude)']].forEach(([value, label]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                if (value === mode) opt.selected = true;
                modeSel.appendChild(opt);
            });
            modeSel.addEventListener('change', () => {
                this._networkMode = MODES[modeSel.value] ? modeSel.value : 'coherence';
                // The threshold and the sensitivity are per mode, so the two
                // inputs beside this one have to show the new mode's values.
                const t = document.getElementById('networkThreshold');
                if (t) t.value = String(this.networkThreshold().toFixed(2));
                const f = document.getElementById('networkFlex');
                if (f) f.value = String(this.networkFlex());
                this.updateNetwork();
            });
            modeBox.appendChild(modeSel);
            wrap.appendChild(modeBox);

            // How much of the window has to beat the level before an edge is
            // called real rather than drawn as a dashed hairline.
            const threshBox = document.createElement('div');
            threshBox.innerHTML =
                '<div style="font-size:12px;opacity:.75">Solid above (share of cells)</div>';
            const thresh = numberInput('networkThreshold',
                                       this.networkThreshold(), [0, 1]);
            thresh.step = '0.05';
            thresh.addEventListener('change', () => {
                const v = Number(thresh.value);
                if (!Number.isFinite(v) || v < 0 || v > 1) return;
                this._networkThreshold = this._networkThreshold || {};
                this._networkThreshold[this.networkMode()] = v;
                this.updateNetwork();
            });
            threshBox.appendChild(thresh);
            wrap.appendChild(threshBox);

            // Width sensitivity.
            const flexBox = document.createElement('div');
            flexBox.innerHTML =
                '<div style="font-size:12px;opacity:.75">Width sensitivity</div>';
            const flex = document.createElement('input');
            flex.type = 'range';
            flex.id = 'networkFlex';
            flex.min = String(FLEX_MIN);
            flex.max = String(FLEX_MAX);
            // The full stroke range covers a window of +/-0.5/flex, so the useful
            // low end is 1 to 3 and whole steps are coarsest exactly there.
            flex.step = '0.5';
            flex.value = String(this.networkFlex());
            flex.addEventListener('input', () => {
                this._networkFlex = this._networkFlex || {};
                this._networkFlex[this.networkMode()] = Number(flex.value);
                this.updateNetwork();
            });
            flexBox.appendChild(flex);
            wrap.appendChild(flexBox);

            container.appendChild(wrap);

            // One checkbox per pair. Fifteen edges is a lot to read at once, and
            // a hidden edge also leaves the width pivot, so the rest rescale
            // against each other.
            const pairs = document.createElement('div');
            pairs.className = 'network-pairs';
            pairs.style.cssText =
                'display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;font-size:12px;';
            edges.forEach(entry => {
                const lab = document.createElement('label');
                lab.style.cssText = 'display:flex;gap:5px;align-items:center;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !this._networkHidden.has(entry.pairKey);
                cb.dataset.pairkey = entry.pairKey;
                cb.addEventListener('change', () => {
                    if (cb.checked) this._networkHidden.delete(entry.pairKey);
                    else this._networkHidden.add(entry.pairKey);
                    this.updateNetwork();
                });
                lab.append(cb, document.createTextNode(
                    entry.pairKey.replace('_vs_', ' ↔ ')));
                pairs.appendChild(lab);
            });
            container.appendChild(pairs);
        },

        // Clicking an edge shows that pair's cross-wavelet detail, drawn by the
        // cross-wavelet tab's own renderer -- one implementation of that figure,
        // not two.
        selectNetworkEdge(entry) {
            this._networkSelected = entry;
            this._networkEdges.forEach(e => {
                e.line.setAttribute('stroke',
                    e === entry ? EDGE_ACCENT : window.DIMS.theme().trace);
            });
            const panel = document.getElementById('networkDetailPanel');
            if (!panel) return;
            panel.innerHTML = '';
            const heading = document.createElement('h3');
            heading.textContent = entry.pairKey.replace('_vs_', '  ↔  ');
            panel.appendChild(heading);
            if (typeof this.createCrossWaveletPlot !== 'function') {
                const note = document.createElement('p');
                note.className = 'hint';
                note.textContent = 'The cross-wavelet tab is not loaded in this '
                    + 'dashboard, so its detail figure cannot be drawn here.';
                panel.appendChild(note);
                return;
            }
            const plot = document.createElement('div');
            plot.id = 'networkDetailPlot';
            plot.style.height = '820px';
            panel.appendChild(plot);
            setTimeout(() => {
                try {
                    this.createCrossWaveletPlot('networkDetailPlot',
                                                entry.pairKey, entry.pair);
                } catch (err) {
                    console.error('Network detail plot failed:', err);
                    plot.textContent = `Could not draw the detail figure: ${err.message}`;
                }
            }, 0);
        },

        // Redrawn on every playhead move: the whole point is that the picture is
        // of a moment, not of the recording.
        updateNetwork() {
            // The detail figure is of a moment too. It is drawn once, when an
            // edge is selected, and nothing moved its window afterwards -- so
            // the edges rethickened as the playhead moved while the cross-wavelet
            // plot underneath them stayed frozen at whatever moment it was
            // opened, showing a window that was no longer the one being read.
            if (this._networkSelected && typeof this.updateCrossWaveletWindow === 'function') {
                this.updateCrossWaveletWindow('networkDetailPlot',
                                              this._networkSelected.pair);
            }
            if (!this._networkEdges) return;
            // The live control, not the config default -- the detail figure
            // below reads the control, so pinning the edges to config left the
            // two describing different spans the moment anyone touched it.
            const sizeEl = document.getElementById('windowSize');
            const half = ((sizeEl && parseInt(sizeEl.value))
                          || (this.config && this.config.defaultWindowSize) || 5) / 2;
            const centre = this.lastClickedPoint;
            const t0 = (centre === null || centre === undefined) ? null : centre - half;
            const t1 = (centre === null || centre === undefined) ? null : centre + half;
            const band = this.networkBand();
            const mode = this.networkMode();
            const altMode = mode === 'power' ? 'coherence' : 'power';
            const threshold = this.networkThreshold();
            const flex = this.networkFlex();
            this.syncNetworkWording();

            // Reduce first, then scale: the pivot is the mean of the *visible*,
            // above-chance edges. At-chance edges are kept out of it because a
            // cluster of noise must not drag the scale the real ones are judged
            // against, and a hidden edge leaves it so the rest rescale.
            let untestable = 0;
            this._networkEdges.forEach(entry => {
                entry.edge = reduceEdge(entry.pair.visualization, t0, t1, band, mode);
                // The other measure, for the tooltip only. It never touches the
                // width, the verdict or the pivot. Reducing twice costs one more
                // pass over the same window, which is a few columns wide unless
                // the reader asked for the whole recording.
                entry.alt = reduceEdge(entry.pair.visualization, t0, t1, band, altMode);
                entry.verdict = verdictOf(entry.edge, threshold);
                entry.hidden = this._networkHidden.has(entry.pairKey);
                if (entry.verdict === 'untestable') untestable++;
            });
            const pool = this._networkEdges.filter(e => !e.hidden && e.verdict === 'real');
            const scoring = pool.length
                ? pool : this._networkEdges.filter(e => !e.hidden);
            // Weights, never means: the two are the same number in coherence
            // mode and are not in power mode, and mixing them puts every edge at
            // one rail with nothing to show for it. A null weight leaves the
            // pool rather than counting as zero, which would drag the pivot down
            // far enough to draw everything at maximum width.
            const weighted = scoring.filter(e => Number.isFinite(e.edge.weight));
            const centreCoh = weighted.length
                ? weighted.reduce((a, e) => a + e.edge.weight, 0) / weighted.length
                : 0.5;

            this._networkEdges.forEach(entry => {
                const { line, edge, verdict } = entry;
                line.style.display = entry.hidden ? 'none' : '';
                if (verdict === 'real') {
                    line.setAttribute('stroke-width', widthFor(edge.weight, centreCoh, flex));
                    line.removeAttribute('stroke-dasharray');
                } else {
                    line.setAttribute('stroke-width', MIN_WIDTH);
                    line.setAttribute('stroke-dasharray', '6 6');
                }
                const base = entry === this._networkSelected ? 1
                    : (verdict === 'real' ? 0.85 : 0.35);
                line.setAttribute('opacity', base);
                entry.title.textContent = edgeTitle(entry.pairKey, edge, band, mode, entry.alt);
            });

            const scope = document.getElementById('networkScope');
            const back = document.getElementById('networkWholeBtn');
            if (scope) {
                scope.textContent = (centre === null || centre === undefined)
                    ? 'the whole recording'
                    : `${(centre - half).toFixed(1)}–${(centre + half).toFixed(1)} s`;
            }
            if (back) back.style.display =
                (centre === null || centre === undefined) ? 'none' : '';

            const caption = document.getElementById('networkCaption');
            if (!caption) return;
            const band_ = band ? `, periods ${band[0]}–${band[1]} s` : '';
            const all = untestable === this._networkEdges.length;
            caption.textContent = all && mode === 'power'
                ? 'This output carries no usable cross-wavelet power level, so no '
                + 'edge can be tested. Switch the edges back to coherence, or '
                + 'rebuild this study.'
                : all
                ? 'This output was built without a coherence null, so no edge can '
                + 'be tested: every line below shows a value with no way to tell '
                + 'it from chance. Set analysis.crosswavelet.mcCount in '
                + 'config.json and rebuild — or switch the edges to shared power, '
                + 'which needs no Monte Carlo null.'
                : `${modeSpec(mode).noun[0].toUpperCase()}${modeSpec(mode).noun.slice(1)}`
                + ` over ${scope ? scope.textContent : 'the recording'}${band_}.`;
        },
    });

    window.DIMS.registerTab({
        id: 'network',
        label: 'Cross-effector network',
        status: 'Click an edge for its cross-wavelet detail.',
        order: 45,
        // `true`, or an object carrying groups and a band. Both mean "on".
        gate: cfg => cfg.include_network === true
            || (!!cfg.include_network && typeof cfg.include_network === 'object'),
        async onActivate(app) {
            if (app.currentVideoID && !app.networkData) {
                await app.loadNetworkData(app.currentVideoID);
            } else if (app.networkData) {
                app.displayNetwork();
            }
        },
        onTimeUpdate(app) {
            if (app.networkData) app.updateNetwork();
        },
        onVideoChange(app) {
            app.networkData = null;
        },
    });
})();
