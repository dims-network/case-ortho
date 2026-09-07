// Cross-Effector Network tab.
//
// A network view derived entirely in the browser from the cross-wavelet output:
// nodes are person x body part, edges are coherence between them, and edge
// widths follow the playhead.
//
// This file is where the DIMS tab mechanism was invented. It lived in one fork,
// where it could not be shared; it is now an ordinary tab like any other.
//
// It needs sig95_wtc -- the Monte Carlo coherence null -- because an edge drawn
// from a raw coherence value is meaningless: under independence coherence sits
// near 0.25, not 0. See docs/contracts/tab.md.
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const VIEW_W = 1000;
    const VIEW_H = 600;
    const MIN_WIDTH = 1.5;   // px stroke for coherence 0
    const MAX_WIDTH = 16;    // px stroke for coherence 1

    // Per-effector positions within a figure centred at cx. Keyed by the part
    // token parsed out of a data type name (see parsePart). y grows downward.
    function figurePositions(cx) {
        return {
            head:      { x: cx,       y: 85,  label: 'head' },
            nose:      { x: cx,       y: 85,  label: 'head/nose' },
            righthand:  { x: cx - 100, y: 300, label: 'right hand' },
            lefthand: { x: cx + 100, y: 300, label: 'left hand' },
            hand:      { x: cx + 100, y: 300, label: 'hand' },
            torso:     { x: cx,       y: 235, label: 'torso' }
        };
    }

    const PERSONS = {
        teacher: { cx: 250, color: '#e84393', label: 'Teacher' },
        student: { cx: 750, color: '#00b894', label: 'Student' }
    };

    // ---- name parsing -------------------------------------------------------
    function parsePerson(name) {
        if (name.startsWith('teacher')) return 'teacher';
        if (name.startsWith('student')) return 'student';
        return null;
    }

    function parsePart(name) {
        const n = name.toLowerCase();
        if (n.includes('lefthand')) return 'lefthand';
        if (n.includes('righthand')) return 'righthand';
        if (n.includes('hand')) return 'hand';
        if (n.includes('nose')) return 'nose';
        if (n.includes('head')) return 'head';
        return 'torso';
    }

    // Compact label for a data type, e.g. "teacher_righthandspeed" -> "T R-hand".
    function shortLabel(name) {
        const person = parsePerson(name);
        const p = person === 'teacher' ? 'T' : person === 'student' ? 'S' : '?';
        const part = parsePart(name);
        const partLabel = { lefthand: 'L-hand', righthand: 'R-hand', hand: 'hand', nose: 'nose', head: 'head', torso: 'torso' }[part];
        return `${p} ${partLabel}`;
    }

    // Pairs the user has toggled off (by pairKey); persists across re-renders.
    const hiddenPairs = new Set();

    // Node id collapses speed/accel of the same effector onto one node.
    function nodeIdFor(name) {
        const person = parsePerson(name);
        const part = parsePart(name);
        if (!person) return null;
        return `${person}:${part}`;
    }

    // ---- coherence -> visual mapping ----------------------------------------
    // "Flexibility" controls how strongly width responds to differences in
    // coherence relative to the group average. flex=0 -> all lines equal width;
    // higher flex -> above-average couplings get much thicker, below-average
    // much thinner. Because coherence often sits in a narrow band (~0.7-0.8),
    // this makes the relative differences visible.
    let widthFlex = 10;        // current sensitivity (shared across renders)
    const FLEX_MIN = 0, FLEX_MAX = 30;

    function widthForCoherence(coh, center) {
        const c = Math.max(0, Math.min(1, coh || 0));
        const mid = (center === undefined || center === null) ? 0.5 : center;
        // norm in [0,1], pivoted at the group mean and scaled by sensitivity
        const norm = Math.max(0, Math.min(1, 0.5 + (c - mid) * widthFlex));
        return MIN_WIDTH + norm * (MAX_WIDTH - MIN_WIDTH);
    }

    // Re-apply stroke widths for all edges from their current coherence, pivoting
    // on the group mean so the flexibility control spreads them around the average.
    // Hover text describing the value and how it was reduced. Rebuilt whenever the
    // value or the reducer settings change, so it never reports stale settings.
    function edgeTipText(edge) {
        const bits = [`periods ≤ ${periodCutoff.toFixed(1)}s`];
        if (usePowerWeight) bits.push('power-weighted');
        if (useSignifMask) bits.push('significant coherence only');
        const coh = edge.currentCoh ?? edge.meanCoh;
        const f = edge.currentSignif ?? edge.signifFraction;
        let verdict;
        if (f === null || f === undefined) {
            verdict = 'no coherence null in this data — value not testable';
        } else if (f <= AT_CHANCE_FRACTION) {
            verdict = `NOT distinguishable from chance (${(f * 100).toFixed(1)}% of cells `
                + `beat the null; ~5% is what independence gives)`;
        } else {
            verdict = `beats the chance level in ${(f * 100).toFixed(1)}% of cells`;
        }
        return `${edge.dt1}  ↔  ${edge.dt2}\n`
            + `mean coherence: ${(coh ?? 0).toFixed(3)}\n(${bits.join(', ')})\n`
            + verdict;
    }

    // Apply the visual treatment for one edge: at-chance edges are drawn as a
    // faint dashed hairline and take no part in the width scale, because
    // stretching them across the stroke range is exactly how the old tab made
    // noise look like structure.
    // Resting opacity for an edge: at-chance edges sit back, so the eye lands on
    // the ones that survived the significance test. Selection always wins.
    function baseOpacity(e) {
        if (state && e === state.selected) return '1';
        return isAtChance(e) ? '0.4' : '0.85';
    }

    function styleEdge(e, center) {
        if (!e.el) return;
        if (isAtChance(e)) {
            e.el.setAttribute('stroke-width', MIN_WIDTH);
            e.el.setAttribute('stroke-dasharray', '5 5');
        } else {
            e.el.setAttribute('stroke-width', widthForCoherence(e.currentCoh ?? e.meanCoh, center));
            e.el.removeAttribute('stroke-dasharray');
        }
        e.el.setAttribute('opacity', baseOpacity(e));
    }

    function refreshWidths() {
        if (!state) return;
        // Pivot on the mean of the *visible* edges only, so toggling pairs off
        // rescales the remaining widths relative to each other. At-chance edges
        // are excluded from the pivot: a cluster of noise edges must not drag
        // the scale that the real ones are judged against.
        const visible = state.graph.edges.filter(e => !hiddenPairs.has(e.pairKey));
        const scoring = visible.filter(e => !isAtChance(e));
        const pool = scoring.length ? scoring : visible;
        const cohs = pool.map(e => e.currentCoh ?? e.meanCoh);
        const center = cohs.length ? cohs.reduce((a, b) => a + b, 0) / cohs.length : 0.5;
        state.graph.edges.forEach(e => {
            styleEdge(e, center);
            if (e.tipEl) e.tipEl.textContent = edgeTipText(e);
        });
    }

    // Edges use a single neutral colour; line width (not colour) encodes coherence.
    // Hover / selection switch to the theme accent for emphasis.
    const EDGE_COLOR = '#9aa7b8';
    const EDGE_ACCENT = 'var(--accent)';

    // Upper period cutoff (seconds) for the coherence band, shared across renders.
    // This existed to dodge the long-period saturation produced by the old,
    // defective coherence formula, and defaulted to 0.7 s for that reason.
    //
    // With a correct Torrence-Webster coherence the saturation is gone and the
    // AR(1) null is flat across period (~0.58-0.60 everywhere), so there is no
    // longer anything to dodge. Worse, the old default actively hid the one real
    // effect in this data: the within-teacher pair's coherence *rises* with
    // period (0.53 at 0.13 s to 0.73 at 7.5 s), so cutting at 0.7 s discarded
    // most of it. The default is now the full analysed range, set per video in
    // render(); the slider stays as an exploratory control.
    let periodCutoff = null;   // null = "use the full range for this video"

    // A correct wavelet coherence is amplitude-normalised: it asks whether the
    // phase relationship is stable, not how much movement there is. So a flat mean
    // gives frames where nobody moves exactly the same say as frames of vigorous
    // shared movement (measured: still 0.264 vs active 0.265). These two options
    // make the *reducer* movement-aware without touching the metric:
    //   powerWeight — weight each cell by cross-wavelet power, so quiet cells
    //                 contribute almost nothing (still frames drop from 20% of the
    //                 edge value to ~5%).
    //   signifMask  — keep only cells whose coherence beats the AR(1) red-noise
    //                 null, and that lie inside the cone of influence.
    let usePowerWeight = true;
    let useSignifMask = true;

    // A coherence value has no meaningful zero, which is the whole reason the
    // significance option exists. It is a ratio estimated over a smoothing
    // neighbourhood, so under independence it does not sit near 0: measured on
    // this data, two unrelated signals average ~0.25 and exceed ~0.59 five
    // percent of the time. An edge reading 0.27 is therefore not "weak
    // coupling", it is *no* coupling — and nothing in the raw number says so.
    //
    // vis.sig95_wtc is that threshold, one value per period row, computed by
    // Monte Carlo against AR(1) surrogates in step_crosswavelet.py. Older JSONs
    // instead carry only sig95_xwt, which is cross-wavelet *power* significance
    // ("was there more joint energy here than red noise gives?") — a different
    // question, and not a valid test of coherence. We prefer sig95_wtc and fall
    // back to the old field only so previously generated files still render.
    //
    // Null entries in sig95_wtc mark period rows lying entirely inside the cone
    // of influence, where no threshold could be estimated; those rows are
    // skipped rather than treated as "always significant".
    function signifLevels(vis) {
        if (!vis || !useSignifMask) return null;
        if (Array.isArray(vis.sig95_wtc)) return { kind: 'wtc', level: vis.sig95_wtc };
        if (vis.sig95_xwt) return { kind: 'xwt', level: null };
        return null;
    }

    // Whether the loaded data supports a real coherence significance test (as
    // opposed to the legacy power-significance fallback).
    function hasCoherenceNull(vis) {
        return !!(vis && Array.isArray(vis.sig95_wtc));
    }

    // Reduce one edge over the time window [t0, t1] (or the whole record when t0
    // is null) and periods <= cutoff. Returns { mean, signifFraction } where:
    //   mean           — the coherence value driving stroke width, optionally
    //                    power-weighted and significance-masked;
    //   signifFraction — share of usable cells beating the coherence null, or
    //                    null when no coherence null is available. ~0.05 means
    //                    "indistinguishable from chance"; this is what decides
    //                    whether the edge is drawn as real or as at-chance.
    // signifFraction is always computed over *unmasked* cells, so it stays a
    // meaningful denominator no matter how the reducer toggles are set.
    function reduceEdge(vis, t0, t1, cutoff) {
        if (!vis || !vis.time || !vis.coherence) return { mean: null, signifFraction: null };
        const time = vis.time;
        const period = vis.period || [];
        // A null cutoff (before render() has seen this video's period range)
        // means "no upper limit" — never "cut everything".
        let cut = (cutoff === undefined || cutoff === null) ? periodCutoff : cutoff;
        if (cut === null || cut === undefined) cut = Infinity;
        const wholeVideo = (t0 === null || t0 === undefined);
        // time indices inside the window (all columns for the whole-video mean)
        const cols = [];
        for (let j = 0; j < time.length; j++) {
            if (wholeVideo || (time[j] >= t0 && time[j] <= t1)) cols.push(j);
        }
        if (cols.length === 0) {
            // window fell outside the record: fall back to nearest single column
            let best = 0, bestD = Infinity;
            const mid = (t0 + t1) / 2;
            for (let j = 0; j < time.length; j++) {
                const d = Math.abs(time[j] - mid);
                if (d < bestD) { bestD = d; best = j; }
            }
            cols.push(best);
        }
        // optional inputs — absent in older JSONs, in which case we degrade to a flat mean
        const power = usePowerWeight ? vis.power : null;
        const signif = signifLevels(vis);
        const coi = useSignifMask ? vis.coi : null;
        // The coherence null is needed for the at-chance verdict regardless of
        // whether the user has the mask switched on, so read it separately.
        const nullLevels = Array.isArray(vis.sig95_wtc) ? vis.sig95_wtc : null;

        let sum = 0, wsum = 0;
        let nSignif = 0, nUsable = 0;
        for (let i = 0; i < vis.coherence.length; i++) {
            // skip frequency rows above the period cutoff
            if (period.length && !(period[i] <= cut)) continue;
            const row = vis.coherence[i];
            if (!row) continue;
            const prow = power ? power[i] : null;
            const srow = (signif && signif.kind === 'xwt') ? vis.sig95_xwt[i] : null;
            // per-row coherence threshold; null marks a row with no usable null
            const lvl = nullLevels ? nullLevels[i] : undefined;
            const lvlOk = (lvl !== null && lvl !== undefined && !Number.isNaN(lvl));
            for (let k = 0; k < cols.length; k++) {
                const j = cols[k];
                const v = row[j];
                if (v === null || v === undefined || Number.isNaN(v)) continue;
                const insideCoi = !(period.length && vis.coi) || (period[i] < vis.coi[j]);
                // significance tally — independent of the reducer toggles
                if (lvlOk && insideCoi) {
                    nUsable++;
                    if (v > lvl) nSignif++;
                }
                // cone-of-influence mask
                if (coi && period.length && !(period[i] < coi[j])) continue;
                // significance mask
                if (signif) {
                    if (signif.kind === 'wtc') {
                        if (!lvlOk || !(v > lvl)) continue;
                    } else if (srow) {
                        if (!(srow[j] > 1.0)) continue;
                    }
                }
                // power weight (flat weight of 1 when disabled or unavailable)
                let w = 1;
                if (prow) {
                    const p = prow[j];
                    if (p === null || p === undefined || Number.isNaN(p) || p < 0) continue;
                    w = p;
                }
                sum += v * w;
                wsum += w;
            }
        }
        const signifFraction = nUsable > 0 ? nSignif / nUsable : null;
        if (wsum > 0) return { mean: sum / wsum, signifFraction };
        // Masking can empty a short window entirely; fall back to an unmasked flat
        // mean over the same cells rather than reporting nothing.
        if (signif || coi) {
            let s2 = 0, c2 = 0;
            for (let i = 0; i < vis.coherence.length; i++) {
                if (period.length && !(period[i] <= cut)) continue;
                const row = vis.coherence[i];
                if (!row) continue;
                for (let k = 0; k < cols.length; k++) {
                    const v = row[cols[k]];
                    if (v !== null && v !== undefined && !Number.isNaN(v)) { s2 += v; c2++; }
                }
            }
            return { mean: c2 > 0 ? s2 / c2 : null, signifFraction };
        }
        return { mean: null, signifFraction };
    }

    // Backwards-compatible scalar form, for callers that only want the value.
    function bandMeanCoherence(vis, t0, t1, cutoff) {
        return reduceEdge(vis, t0, t1, cutoff).mean;
    }

    // An edge whose coherence beats its own chance level in no more than this
    // share of cells is reported as "not distinguishable from chance". Under
    // independence the expected share is exactly 1 - SIGNIFICANCE_LEVEL = 0.05;
    // 0.10 leaves headroom for estimation noise in the Monte Carlo null.
    const AT_CHANCE_FRACTION = 0.10;

    function isAtChance(edge) {
        const f = edge.currentSignif ?? edge.signifFraction;
        return (f !== null && f !== undefined) && f <= AT_CHANCE_FRACTION;
    }

    // Largest period (s) present across all edges — used to bound the slider.
    function maxPeriod(edges) {
        let m = 0;
        edges.forEach(e => {
            const per = e.vis && e.vis.period;
            if (per && per.length) m = Math.max(m, per[per.length - 1] || 0);
        });
        return m || 12;
    }

    // Recompute each edge's whole-video band-limited mean after the cutoff
    // changes, then re-apply windowed widths (which reads the new means).
    function recomputeBandMeans(app) {
        if (!state) return;
        state.graph.edges.forEach(edge => {
            const r = reduceEdge(edge.vis, null, null, periodCutoff);
            if (r.mean !== null && r.mean !== undefined) edge.meanCoh = r.mean;
            edge.signifFraction = r.signifFraction;
        });
        applyWindowedWidths(app);
    }

    // ---- SVG figure silhouette ----------------------------------------------
    function appendFigure(svg, person, pos) {
        const { cx, color, label } = person;
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('opacity', '0.30');
        g.setAttribute('fill', color);
        g.setAttribute('stroke', color);
        g.setAttribute('stroke-width', '10');
        g.setAttribute('stroke-linecap', 'round');
        g.setAttribute('stroke-linejoin', 'round');

        const head = pos.head;
        const lh = pos.lefthand;
        const rh = pos.righthand;
        const shoulderY = 150, hipY = 330, footY = 545;
        const shoulderL = cx - 60, shoulderR = cx + 60;
        const hipL = cx - 32, hipR = cx + 32;

        // head
        const headC = document.createElementNS(SVG_NS, 'circle');
        headC.setAttribute('cx', head.x); headC.setAttribute('cy', head.y);
        headC.setAttribute('r', '30'); headC.setAttribute('stroke', 'none');
        g.appendChild(headC);

        // torso
        const torso = document.createElementNS(SVG_NS, 'path');
        torso.setAttribute('d',
            `M ${shoulderL} ${shoulderY} L ${shoulderR} ${shoulderY} ` +
            `L ${hipR} ${hipY} L ${hipL} ${hipY} Z`);
        torso.setAttribute('stroke', 'none');
        g.appendChild(torso);

        // arms (shoulder -> hand) and legs (hip -> foot)
        const limbs = [
            [shoulderL, shoulderY, lh.x, lh.y],
            [shoulderR, shoulderY, rh.x, rh.y],
            [hipL, hipY, cx - 35, footY],
            [hipR, hipY, cx + 35, footY]
        ];
        limbs.forEach(([x1, y1, x2, y2]) => {
            const ln = document.createElementNS(SVG_NS, 'line');
            ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
            ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
            ln.setAttribute('fill', 'none');
            g.appendChild(ln);
        });

        svg.appendChild(g);

        // figure label
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', cx); txt.setAttribute('y', footY + 35);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', color);
        txt.setAttribute('font-size', '22');
        txt.setAttribute('font-weight', 'bold');
        txt.textContent = label;
        svg.appendChild(txt);
    }

    // ---- module state -------------------------------------------------------
    // Single dashboard instance per page, so module-level state is fine.
    let state = null; // { nodes, edges, svg }

    function resolveNodePositions(app) {
        // Built-in positions per person, overridable via config.networkNodes:
        // { "teacher:lefthand": {x,y,label}, ... }
        const positions = {};
        Object.entries(PERSONS).forEach(([personKey, person]) => {
            const fp = figurePositions(person.cx);
            Object.entries(fp).forEach(([part, p]) => {
                positions[`${personKey}:${part}`] = { x: p.x, y: p.y, label: `${person.label} ${p.label}`, person: personKey };
            });
        });
        const override = (app.config && app.config.networkNodes) || {};
        Object.entries(override).forEach(([id, o]) => {
            positions[id] = Object.assign({}, positions[id], o);
        });
        return positions;
    }

    function buildGraph(app) {
        const pairs = app.crossWaveletData && app.crossWaveletData.crosswavelet_pairs;
        const positions = resolveNodePositions(app);
        const usedNodes = {};
        const edges = [];

        Object.entries(pairs || {}).forEach(([pairKey, pairData]) => {
            const dt1 = pairData.data_type1;
            const dt2 = pairData.data_type2;
            const n1 = nodeIdFor(dt1);
            const n2 = nodeIdFor(dt2);
            if (!n1 || !n2 || !positions[n1] || !positions[n2]) {
                console.warn('Network: skipping pair without resolvable nodes:', pairKey, n1, n2);
                return;
            }
            usedNodes[n1] = positions[n1];
            usedNodes[n2] = positions[n2];
            // Whole-video edge width uses the band-limited mean (periods <=
            // periodCutoff, optionally power-weighted and significance-masked);
            // fall back to the stored all-period mean only when we can't compute it.
            const vis = pairData.visualization;
            const reduced = reduceEdge(vis, null, null, periodCutoff);
            const meanCoh = (reduced.mean !== null && reduced.mean !== undefined)
                ? reduced.mean
                : ((pairData.statistics && pairData.statistics.mean_coherence) || 0);
            edges.push({
                pairKey, pairData,
                n1, n2,
                dt1, dt2,
                meanCoh,
                signifFraction: reduced.signifFraction,
                vis
            });
        });

        // Give every edge a distinct "rank" so each one bows by a different amount
        // (see edgePath) — this keeps overlapping / collinear edges visually separate.
        const total = edges.length;
        edges.forEach((e, i) => { e.bowRank = i - (total - 1) / 2; });

        // Pivot on the edges that are actually above chance, matching refreshWidths().
        const scoring = edges.filter(e => !isAtChance(e));
        const pool = scoring.length ? scoring : edges;
        const centerCoh = pool.length
            ? pool.reduce((a, e) => a + e.meanCoh, 0) / pool.length : 0.5;

        return { nodes: usedNodes, edges, positions, centerCoh };
    }

    // Quadratic-curve path between two node positions. Every edge is bowed
    // perpendicular to its chord by an amount unique to its rank, so edges that
    // would otherwise overlap (e.g. the collinear hand row, or many lines crossing
    // the central gap) fan out into distinguishable arcs.
    function edgePath(p1, p2, bowRank) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        // unit perpendicular to the chord
        const ox = (-dy / len), oy = (dx / len);
        // signed bow: distinct per edge, plus a floor so even rank 0 curves a little
        const amt = (bowRank || 0) * 30 + (bowRank >= 0 ? 22 : -22);
        const cxp = (p1.x + p2.x) / 2 + ox * amt;
        const cyp = (p1.y + p2.y) / 2 + oy * amt;
        return `M ${p1.x} ${p1.y} Q ${cxp} ${cyp} ${p2.x} ${p2.y}`;
    }

    function render(app, container) {
        const graph = buildGraph(app);
        container.innerHTML = '';

        const title = document.createElement('h2');
        title.style.color = 'var(--text)';
        title.style.marginBottom = '6px';
        title.textContent = 'Cross-Effector Coupling Network';
        container.appendChild(title);

        const help = document.createElement('div');
        help.style.color = 'var(--muted)';
        help.style.marginBottom = '14px';
        help.textContent = 'Line thickness = wavelet coherence between two effectors, averaged over periods up to the ' +
            'cutoff below (whole-video mean; updates to the selected time window when you pick a point on the timeline). ' +
            'Coherence measures whether the two move with a steady phase relationship, and ignores how much movement ' +
            'there is — so by default the average is weighted by cross-wavelet power and restricted to cells that beat ' +
            'the 95% level for unrelated signals; otherwise moments when nobody is moving count just as much as ' +
            'episodes of shared movement. Thickness is RELATIVE to the other edges shown, never an absolute strength. ' +
            'A faint dashed line means that pair is not distinguishable from chance — hover any line for its numbers. ' +
            'Click a line to view its cross-wavelet detail beside the figures.';
        container.appendChild(help);

        if (!graph.edges.length) {
            const empty = document.createElement('div');
            empty.style.color = 'var(--muted)';
            empty.textContent = 'No cross-wavelet pairs available for this video.';
            container.appendChild(empty);
            return;
        }

        // Width-flexibility control: tunes how strongly line widths respond to
        // coherence differences (see widthForCoherence / refreshWidths).
        const ctrlRow = document.createElement('div');
        ctrlRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;color:var(--muted);font-size:13px;';
        const ctrlLabel = document.createElement('label');
        ctrlLabel.setAttribute('for', 'networkWidthFlex');
        ctrlLabel.textContent = 'Width flexibility';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'networkWidthFlex';
        slider.min = FLEX_MIN; slider.max = FLEX_MAX; slider.step = '1';
        slider.value = widthFlex;
        slider.style.width = '150px';
        const valSpan = document.createElement('span');
        valSpan.textContent = widthFlex;
        valSpan.style.minWidth = '2ch';
        slider.addEventListener('input', () => {
            widthFlex = parseFloat(slider.value);
            valSpan.textContent = slider.value;
            refreshWidths();
        });
        ctrlRow.append(ctrlLabel, slider, valSpan);

        // Coherence period-band control: upper period cutoff (s). Averaging only
        // over periods <= this value drops the saturated long-period band, so
        // still effectors stop looking coupled (see bandMeanCoherence).
        const perMax = maxPeriod(graph.edges);
        const bandRow = document.createElement('div');
        bandRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;color:var(--muted);font-size:13px;';
        const bandLabel = document.createElement('label');
        bandLabel.setAttribute('for', 'networkPeriodCutoff');
        bandLabel.textContent = 'Coherence period band (≤)';
        const bandSlider = document.createElement('input');
        bandSlider.type = 'range';
        bandSlider.id = 'networkPeriodCutoff';
        bandSlider.min = '0.2';
        bandSlider.max = (Math.ceil(perMax * 10) / 10).toString();
        bandSlider.step = '0.1';
        // First render for this session: default to the whole period range.
        // Otherwise keep the user's cutoff, clamped to this video's range.
        periodCutoff = (periodCutoff === null || periodCutoff === undefined)
            ? perMax
            : Math.min(Math.max(periodCutoff, 0.2), perMax);
        bandSlider.value = periodCutoff;
        bandSlider.style.width = '150px';
        const bandVal = document.createElement('span');
        bandVal.textContent = `${periodCutoff.toFixed(1)} s`;
        bandVal.style.minWidth = '4ch';
        bandSlider.addEventListener('input', () => {
            periodCutoff = parseFloat(bandSlider.value);
            bandVal.textContent = `${periodCutoff.toFixed(1)} s`;
            recomputeBandMeans(app);
        });
        bandRow.append(bandLabel, bandSlider, bandVal);

        // Movement-aware reducer toggles. The coherence itself is amplitude-blind
        // by design, so these decide how much say quiet cells get in the edge value.
        const weightRow = document.createElement('div');
        weightRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin-bottom:14px;color:var(--muted);font-size:13px;';
        const weightLabel = document.createElement('span');
        weightLabel.textContent = 'Edge weighting:';
        weightRow.appendChild(weightLabel);

        const firstVis = graph.edges.length ? graph.edges[0].vis : null;
        [
            {
                id: 'networkPowerWeight',
                text: 'power-weighted',
                title: 'Weight each time–frequency cell by cross-wavelet power, so still '
                     + 'moments contribute almost nothing to the edge value. Off = flat mean, '
                     + 'in which the stillest 20% of frames carry a full 20% of the weight.',
                get: () => usePowerWeight,
                set: v => { usePowerWeight = v; },
                available: !!(firstVis && firstVis.power)
            },
            {
                id: 'networkSignifMask',
                text: 'significant coherence only',
                title: hasCoherenceNull(firstVis)
                    ? 'Keep only cells whose coherence beats the 95% level for two '
                    + 'unrelated AR(1) signals (Monte Carlo, sig95_wtc), and that lie '
                    + 'inside the cone of influence. Coherence has no meaningful zero: '
                    + 'independent signals still average ~0.25 here, so without this '
                    + 'comparison a value cannot be told apart from chance.'
                    : 'This data predates the coherence null, so the mask falls back to '
                    + 'cross-wavelet POWER significance (sig95_xwt > 1) — a test of joint '
                    + 'energy, not of phase stability. Regenerate the cross-wavelet JSON '
                    + 'to get the proper test.',
                get: () => useSignifMask,
                set: v => { useSignifMask = v; },
                available: !!(firstVis && (firstVis.sig95_wtc || firstVis.sig95_xwt) && firstVis.coi)
            }
        ].forEach(opt => {
            const lab = document.createElement('label');
            lab.style.cssText = 'display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;';
            lab.title = opt.available ? opt.title
                : 'Unavailable: this field is missing from the loaded cross-wavelet JSON.';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = opt.id;
            cb.checked = opt.available && opt.get();
            cb.disabled = !opt.available;
            if (!opt.available) { opt.set(false); lab.style.opacity = '0.5'; }
            cb.addEventListener('change', () => {
                opt.set(cb.checked);
                recomputeBandMeans(app);
            });
            lab.append(cb, document.createTextNode(opt.text));
            weightRow.appendChild(lab);
        });

        // Per-pair toggles: include/exclude each connection from the network.
        const pairsRow = document.createElement('div');
        pairsRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-bottom:16px;color:var(--muted);font-size:12px;';
        const pairsLabel = document.createElement('span');
        pairsLabel.textContent = 'Pairs:';
        pairsLabel.style.fontSize = '13px';
        pairsRow.appendChild(pairsLabel);
        graph.edges.forEach(edge => {
            const lab = document.createElement('label');
            lab.style.cssText = 'display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !hiddenPairs.has(edge.pairKey);
            cb.addEventListener('change', () => {
                if (cb.checked) hiddenPairs.delete(edge.pairKey);
                else hiddenPairs.add(edge.pairKey);
                if (edge.el) edge.el.style.display = cb.checked ? '' : 'none';
                refreshWidths();
            });
            lab.append(cb, document.createTextNode(`${shortLabel(edge.dt1)} ↔ ${shortLabel(edge.dt2)}`));
            pairsRow.appendChild(lab);
        });

        // Vertical layout: controls + figures on top, cross-wavelet detail full-width below.
        const layout = document.createElement('div');
        layout.style.cssText = 'display:flex;flex-direction:column;gap:20px;';
        const leftCol = document.createElement('div');
        leftCol.style.cssText = 'max-width:600px;width:100%;align-self:center;';
        leftCol.append(ctrlRow, bandRow, weightRow, pairsRow);
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'width:100%;min-width:0;';

        // SVG canvas (sized to the left column, so the figures are small)
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
        svg.setAttribute('width', '100%');
        svg.style.display = 'block';
        svg.style.margin = '0 auto';

        // figures (drawn first, under the edges/nodes)
        Object.values(PERSONS).forEach(person => {
            appendFigure(svg, person, figurePositions(person.cx));
        });

        // edges
        const edgeLayer = document.createElementNS(SVG_NS, 'g');
        graph.edges.forEach(edge => {
            const p1 = graph.nodes[edge.n1];
            const p2 = graph.nodes[edge.n2];
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', edgePath(p1, p2, edge.bowRank));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', EDGE_COLOR);
            path.setAttribute('stroke-linecap', 'round');
            path.style.cursor = 'pointer';
            path.style.display = hiddenPairs.has(edge.pairKey) ? 'none' : '';
            path.dataset.pairkey = edge.pairKey;

            const tip = document.createElementNS(SVG_NS, 'title');
            tip.textContent = edgeTipText(edge);
            path.appendChild(tip);

            path.addEventListener('mouseenter', () => {
                path.setAttribute('opacity', '1');
                if (edge !== state.selected) path.setAttribute('stroke', EDGE_ACCENT);
            });
            path.addEventListener('mouseleave', () => {
                path.setAttribute('opacity', baseOpacity(edge));
                if (edge !== state.selected) path.setAttribute('stroke', EDGE_COLOR);
            });
            path.addEventListener('click', () => selectEdge(app, edge));

            edge.el = path;
            edge.tipEl = tip;
            edge.currentCoh = edge.meanCoh;
            edge.currentSignif = edge.signifFraction;
            // Sets stroke-width and opacity, and applies the at-chance dashing.
            styleEdge(edge, graph.centerCoh);
            edgeLayer.appendChild(path);
        });
        svg.appendChild(edgeLayer);

        // nodes
        const nodeLayer = document.createElementNS(SVG_NS, 'g');
        Object.entries(graph.nodes).forEach(([id, p]) => {
            const c = document.createElementNS(SVG_NS, 'circle');
            c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
            c.setAttribute('r', '11');
            c.setAttribute('fill', PERSONS[p.person] ? PERSONS[p.person].color : '#fff');
            c.setAttribute('stroke', 'var(--panel)');
            c.setAttribute('stroke-width', '3');
            const tip = document.createElementNS(SVG_NS, 'title');
            tip.textContent = p.label || id;
            c.appendChild(tip);
            nodeLayer.appendChild(c);

            const lbl = document.createElementNS(SVG_NS, 'text');
            lbl.setAttribute('x', p.x);
            lbl.setAttribute('y', p.y - 16);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('fill', 'var(--text)');
            lbl.setAttribute('font-size', '13');
            lbl.textContent = (p.label || id).replace(/^(Teacher|Student)\s/, '');
            nodeLayer.appendChild(lbl);
        });
        svg.appendChild(nodeLayer);

        leftCol.appendChild(svg);

        // inline cross-wavelet detail panel (right column, beside the figures)
        const panel = document.createElement('div');
        panel.id = 'networkDetailPanel';
        panel.style.minHeight = '60px';
        const placeholder = document.createElement('div');
        placeholder.style.color = 'var(--muted)';
        placeholder.style.textAlign = 'center';
        placeholder.style.padding = '20px';
        placeholder.textContent = 'Click a connecting line to load its cross-wavelet analysis here.';
        panel.appendChild(placeholder);
        rightCol.appendChild(panel);

        layout.append(leftCol, rightCol);
        container.appendChild(layout);

        state = { graph, svg, selected: null };

        // reflect any existing time selection immediately
        applyWindowedWidths(app);
    }

    function selectEdge(app, edge) {
        if (!state) return;
        // de-highlight previous
        if (state.selected && state.selected.el) {
            const prev = state.selected;
            state.selected = null;                      // so baseOpacity sees it deselected
            prev.el.setAttribute('stroke', EDGE_COLOR);
            prev.el.setAttribute('opacity', baseOpacity(prev));
        }
        state.selected = edge;
        edge.el.setAttribute('stroke', EDGE_ACCENT);
        edge.el.setAttribute('opacity', '1');

        const panel = document.getElementById('networkDetailPanel');
        if (!panel) return;
        panel.innerHTML = '';
        const heading = document.createElement('h3');
        heading.style.color = 'var(--text)';
        heading.textContent = `${edge.dt1}  ↔  ${edge.dt2}`;
        panel.appendChild(heading);

        const plotDiv = document.createElement('div');
        plotDiv.id = 'networkDetailPlot';
        plotDiv.style.height = '820px';
        plotDiv.style.backgroundColor = 'var(--panel)';
        plotDiv.style.padding = '10px';
        plotDiv.style.borderRadius = '5px';
        panel.appendChild(plotDiv);

        // Reuse the dashboard's existing 4-panel cross-wavelet renderer.
        setTimeout(() => {
            try {
                app.createCrossWaveletPlot('networkDetailPlot', edge.pairKey, edge.pairData);
            } catch (err) {
                console.error('Network detail plot failed:', err);
                plotDiv.innerHTML = `<div style="color:#e74c3c;padding:20px;">Error rendering cross-wavelet: ${err.message}</div>`;
            }
        }, 50);
    }

    // Recompute each edge's current coherence from the selected time window
    // (or the whole-video mean if nothing is selected), then re-apply widths.
    function applyWindowedWidths(app) {
        if (!state) return;
        const t = app.lastClickedPoint;
        let t0 = null, t1 = null;
        if (t !== null && t !== undefined) {
            const wEl = document.getElementById('windowSize');
            const w = (wEl && parseInt(wEl.value)) || app.config.defaultWindowSize || 5;
            t0 = t - w / 2; t1 = t + w / 2;
        }
        state.graph.edges.forEach(edge => {
            let coh = edge.meanCoh;
            // Windowed significance is judged on the window's own cells, so a
            // pair can read "real" over the whole video and "at chance" in a
            // quiet 5 s window, which is the honest answer.
            let sf = edge.signifFraction;
            if (t0 !== null) {
                const r = reduceEdge(edge.vis, t0, t1, periodCutoff);
                if (r.mean !== null) coh = r.mean;
                sf = r.signifFraction;
            }
            edge.currentCoh = coh;
            edge.currentSignif = sf;
        });
        refreshWidths();
    }

    // Re-render the open detail plot so its window highlight tracks the timeline.
    // createCrossWaveletPlot reads app.lastClickedPoint / windowSize at render
    // time, so re-calling it slides the highlighted window (same as the main
    // Cross-Wavelet tab's updateCrossWaveletHighlights).
    function refreshDetailPlot(app) {
        if (!state || !state.selected) return;
        if (!document.getElementById('networkDetailPlot')) return;
        try {
            app.createCrossWaveletPlot('networkDetailPlot', state.selected.pairKey, state.selected.pairData);
        } catch (err) {
            console.error('Network detail plot refresh failed:', err);
        }
    }

    // ---- register tab -------------------------------------------------------
    window.DIMS.registerTab({
        id: 'network',
        label: 'Cross-Effector Network',
        order: 60,
        // Opt-in, not implied. This tab reads node identities out of the data
        // type names (person + body part), so on a study that simply happens to
        // have cross-wavelet results it would draw a graph of nonsense. A tab
        // must not appear merely because some other analysis exists.
        gate: cfg => cfg.include_network === true &&
                     Array.isArray(cfg.include_crosswavelet) &&
                     cfg.include_crosswavelet.length >= 1,
        async onActivate(app, container) {
            if (!app.crossWaveletData) {
                const path = `assets/crosswavelet/${app.currentVideoID}_crosswavelet_data.json`;
                const data = await app.loadJSON(path);
                if (!data || !data.crosswavelet_pairs) {
                    container.innerHTML = '<div style="color:var(--muted);padding:20px;">' +
                        'Cross-wavelet data not found. Run the Python cross-wavelet script first.</div>';
                    return;
                }
                app.crossWaveletData = data;
            }
            render(app, container);
        },
        onUpdate(app) {
            // Re-render is cheap; keeps SVG fresh after theme changes etc.
            const container = document.getElementById('networkContainer');
            if (container && app.crossWaveletData) render(app, container);
        },
        onTimeUpdate(app) {
            applyWindowedWidths(app);
            refreshDetailPlot(app);
        },
        onVideoChange(app) {
            // The cross-wavelet cache is shared with the cross-wavelet tab; the
            // graph derived from it is not, so only the derived state is dropped.
            state = null;
        }
    });
})();
