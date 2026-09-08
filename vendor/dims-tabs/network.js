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
    const VIEW_W = 1000;
    const VIEW_H = 560;
    const MIN_WIDTH = 1.5;      // px stroke at coherence 0
    const MAX_WIDTH = 16;       // px stroke at coherence 1
    const NODE_R = 26;

    // Where a body part sits on a figure centred at cx. The tokens are read out
    // of what is left of a measure's name once its group prefix is stripped, so
    // `teacher_righthandspeed` in a group matching `^teacher` becomes
    // `righthandspeed` and lands on the right hand.
    const SHOULDER_Y = 150, HIP_Y = 330, FOOT_Y = 545;

    function figurePositions(cx) {
        return {
            head:      { x: cx,       y: 85 },
            nose:      { x: cx,       y: 85 },
            righthand: { x: cx - 100, y: 300 },
            lefthand:  { x: cx + 100, y: 300 },
            hand:      { x: cx + 100, y: 300 },
            torso:     { x: cx,       y: 235 },
            hip:       { x: cx,       y: HIP_Y },
            foot:      { x: cx,       y: FOOT_Y },
        };
    }

    // Longest token first, so `lefthand` is not swallowed by `hand`.
    const BODY_PARTS = ['lefthand', 'righthand', 'hand', 'nose', 'head',
                        'torso', 'hip', 'foot'];

    function bodyPart(name) {
        const n = String(name).toLowerCase();
        return BODY_PARTS.find(part => n.includes(part)) || null;
    }

    // What independence gives. An edge whose significant share sits at or below
    // this is drawn as a dashed hairline: it is a measurement, and the
    // measurement says "nothing here".
    const CHANCE = 0.05;
    // Enough above chance to call an edge real. Deliberately not 0.05 + epsilon:
    // the fraction is itself estimated, and a threshold at the chance level
    // turns half the at-chance edges solid.
    const REAL = 0.15;

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
    // instruments -- with a regular expression each. Anything matching none of
    // them lands in a trailing group, visibly, rather than being dropped.
    function grouping(config, measures) {
        const spec = (config && config.include_network) || {};
        const defined = Array.isArray(spec.groups) ? spec.groups : [];
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
    // transform rather than a measurement. The value and the verdict are taken
    // over exactly the same cells, so they always describe the same population.
    //
    // Returns the mean, which drives the width, and the share of usable cells
    // beating the coherence null, which decides whether the edge is a finding.
    // That share is `null` when the payload carries no null -- not zero, and not
    // quietly treated as significant.
    function reduceEdge(vis, t0, t1, band) {
        const empty = { mean: null, fraction: null, tested: 0, cells: 0 };
        if (!vis || !vis.time || !vis.coherence) return empty;

        const coherence = window.DIMS.decodeArray(vis.coherence);
        const time = vis.time;
        const period = vis.period || [];
        const coi = vis.coi;
        const levels = Array.isArray(vis.sig95_wtc) ? vis.sig95_wtc : null;
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
        for (let i = 0; i < coherence.length; i++) {
            if (period.length && !(period[i] >= lo && period[i] <= hi)) continue;
            const row = coherence[i];
            if (!row) continue;
            const level = levels ? levels[i] : undefined;
            // A null level marks a period row lying entirely inside the cone,
            // where no threshold could be estimated. Skipped, not counted as
            // always-significant.
            const levelOk = (level !== null && level !== undefined && !Number.isNaN(level));
            for (let k = 0; k < cols.length; k++) {
                const j = cols[k];
                const v = row[j];
                // null means the coherence is undefined here: neither signal had
                // energy in this band. Absent, not zero.
                if (v === null || v === undefined || Number.isNaN(v)) continue;
                if (period.length && coi && !(period[i] < coi[j])) continue;
                sum += v; n++;
                if (levelOk) { tested++; if (v > level) significant++; }
            }
        }
        return {
            mean: n ? sum / n : null,
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

    function verdictOf(edge) {
        if (edge.fraction === null) return 'untestable';
        if (edge.fraction >= REAL) return 'real';
        return 'chance';
    }

    function edgeTitle(pairKey, edge, band) {
        const value = edge.mean === null ? '—' : edge.mean.toFixed(3);
        const lines = [`${pairKey.replace('_vs_', '  ↔  ')}`,
                       `mean coherence: ${value}`,
                       band ? `periods ${band[0]}–${band[1]} s, outside the cone of influence`
                            : 'every period, outside the cone of influence'];
        if (edge.fraction === null) {
            lines.push('no coherence null in this output, so this value cannot',
                       'be tested. Set analysis.crosswavelet.mcCount and rebuild.');
        } else {
            lines.push(`above chance in ${(edge.fraction * 100).toFixed(1)}% of `
                       + `${edge.tested} tested cells`,
                       `(independence gives about ${(CHANCE * 100).toFixed(0)}%)`);
        }
        // Coherence cannot tell you this, because it is amplitude-normalised on
        // purpose. So the edge says it separately rather than pretending to.
        const mv = edge.movement;
        if (mv !== null && mv !== undefined) {
            lines.push(`both measures active: ${(mv * 100).toFixed(0)}% of this window`);
            if (mv < LOW_MOVEMENT) {
                lines.push('  -> computed mostly from stillness; treat with care');
            }
        }
        return lines.join('\n');
    }

    // ---- drawing -------------------------------------------------------------

    function layout(groups, style) {
        return style === "figure" ? figureLayout(groups) : columnLayout(groups);
    }

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
                positions[name] = { x: cx, y, group, label: nodeLabel(name, group) };
            });
        });
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
                const label = nodeLabel(name, group);
                const part = bodyPart(label) || bodyPart(name);
                const at = part && spots[part];
                positions[name] = at
                    ? { x: at.x, y: at.y, group, label, part }
                    : { x: cx + 150, y: 110 + (strays++) * 70, group, label,
                        part: null };
            });
        });
        return positions;
    }

    function el(name, attrs) {
        const node = document.createElementNS(SVG_NS, name);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v !== null && v !== undefined) node.setAttribute(k, String(v));
        });
        return node;
    }

    // A quadratic curve between two nodes, bowed perpendicular to its chord by
    // an amount unique to this edge. Straight lines between collinear nodes are
    // *the same line*: three within-group edges drew one thick bar, and the
    // reader had no way to tell one from three. Bowing fans them out, and it
    // untangles the cross-group edges too, which otherwise all cross the middle.
    function edgePath(p1, p2, bowRank) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = -dy / len, oy = dx / len;          // unit perpendicular
        // A floor of 22 so even rank 0 curves a little: two nodes joined by a
        // single straight line look like structure rather than a measurement.
        const amt = (bowRank || 0) * 30 + (bowRank >= 0 ? 22 : -22);
        return `M ${p1.x} ${p1.y} Q ${(p1.x + p2.x) / 2 + ox * amt} `
             + `${(p1.y + p2.y) / 2 + oy * amt} ${p2.x} ${p2.y}`;
    }

    // Edges within one group share endpoints and directions, so they need
    // distinct ranks or they land on top of each other again. Ranks alternate
    // around zero so a pair fans symmetrically rather than drifting one way.
    function assignBowRanks(edges, positions) {
        const seen = new Map();
        edges.forEach(e => {
            const a = positions[e.pair.data_type1], b = positions[e.pair.data_type2];
            if (!a || !b) return;
            // Same key = same drawn line, which is what has to be separated.
            const key = [a.x, a.y, b.x, b.y].map(Math.round).sort().join(",");
            const n = seen.get(key) || 0;
            seen.set(key, n + 1);
            e.bowRank = n % 2 ? Math.ceil(n / 2) : -Math.ceil(n / 2);
        });
    }

    // A translucent body under the nodes, so a chart of people looks like one.
    function appendFigure(svg, group, cx, theme) {
        const g = el('g', { class: 'dims-figure', opacity: 0.3,
                            fill: group.color || theme.trace,
                            stroke: group.color || theme.trace,
                            'stroke-width': 10, 'stroke-linecap': 'round',
                            'stroke-linejoin': 'round' });
        const spots = figurePositions(cx);
        const shoulderL = cx - 60, shoulderR = cx + 60;
        const hipL = cx - 32, hipR = cx + 32;

        g.appendChild(el('circle', { cx, cy: spots.head.y, r: 30, stroke: 'none' }));
        g.appendChild(el('path', {
            d: `M ${shoulderL} ${SHOULDER_Y} L ${shoulderR} ${SHOULDER_Y} `
             + `L ${hipR} ${HIP_Y} L ${hipL} ${HIP_Y} Z`, stroke: 'none' }));
        [[shoulderL, SHOULDER_Y, spots.lefthand.x, spots.lefthand.y],
         [shoulderR, SHOULDER_Y, spots.righthand.x, spots.righthand.y],
         [hipL, HIP_Y, cx - 35, FOOT_Y],
         [hipR, HIP_Y, cx + 35, FOOT_Y]].forEach(([x1, y1, x2, y2]) => {
            g.appendChild(el('line', { x1, y1, x2, y2, fill: 'none' }));
        });
        svg.appendChild(g);
    }

    // Width against the group, not against the absolute scale. Coherence sits
    // in a narrow band -- often 0.7 to 0.8 across every pair in a study -- so a
    // width mapped from 0 to 1 makes every line the same and says nothing. This
    // pivots on the mean of the edges currently on screen and `flex` decides how
    // hard the differences are pushed apart.
    const FLEX_MIN = 0, FLEX_MAX = 30, FLEX_DEFAULT = 10;

    function widthFor(mean, centre, flex) {
        const c = Math.max(0, Math.min(1, mean === null ? 0 : mean));
        const mid = (centre === null || centre === undefined) ? 0.5 : centre;
        const norm = Math.max(0, Math.min(1, 0.5 + (c - mid) * (flex ?? FLEX_DEFAULT)));
        return MIN_WIDTH + norm * (MAX_WIDTH - MIN_WIDTH);
    }

    // --- movement context ----------------------------------------------------
    //
    // Coherence is amplitude-normalised by design: a tiny shared tremor counts
    // exactly as much as a large shared movement. That is right for "is the
    // timing related" and a liability for "are these two moving together" --
    // especially with motion capture, where both measures are tracked from the
    // same video and their jitter has shared sources.
    //
    // So rather than filtering, the tab reports. A thick edge computed over a
    // stretch where neither measure was doing anything is visibly suspect, and
    // the reader decides what to do about it. Nothing here changes a coherence
    // value.
    //
    // **This assumes a measure whose near-zero means "not moving"** -- a speed,
    // or another magnitude. On a position channel the number would be
    // meaningless, which is why it is only ever reported and never acted on.

    //: A measure counts as active above this share of its own 95th percentile.
    //: The 95th rather than the maximum, so one tracking glitch does not set the
    //: scale for a whole recording.
    const MOVING_FRACTION_OF_P95 = 0.10;
    //: Below this share of the window, an edge is drawn faint: whatever its
    //: coherence, it was computed mostly from stillness.
    const LOW_MOVEMENT = 0.25;

    // Keyed by measure name, and dropped whenever the host hands us a different
    // set of series. Clearing it only on a video change -- which is what the
    // original did -- leaves it stale for any other route to new data, and a
    // stale activity figure is worse than none: it is a number about a recording
    // you are no longer looking at.
    const movementCache = new Map();
    let movementSource = null;

    function movementMask(app, measure) {
        if (movementSource !== (app.currentData || null)) {
            movementSource = app.currentData || null;
            movementCache.clear();
        }
        if (movementCache.has(measure)) return movementCache.get(measure);
        const series = (app.currentData || []).find(d => d.name === measure);
        let out = null;
        if (series && series.data && series.data.length) {
            const key = Object.keys(series.data[0]).find(k => k !== 'Time');
            const time = [], val = [];
            series.data.forEach(row => {
                const v = Math.abs(Number(row[key])), t = Number(row.Time);
                if (Number.isFinite(v) && Number.isFinite(t)) { time.push(t); val.push(v); }
            });
            if (val.length) {
                const sorted = [...val].sort((a, b) => a - b);
                const p95 = sorted[Math.min(sorted.length - 1,
                                            Math.floor(0.95 * sorted.length))];
                const thr = MOVING_FRACTION_OF_P95 * p95;
                out = { time, moving: val.map(v => v > thr) };
            }
        }
        movementCache.set(measure, out);
        return out;
    }

    // Share of the window in which BOTH measures were active. `null` when the
    // raw series are not loaded, which is a different thing from zero and is
    // reported as nothing rather than as stillness.
    function movementContext(app, m1name, m2name, t0, t1) {
        const m1 = movementMask(app, m1name), m2 = movementMask(app, m2name);
        if (!m1 || !m2) return null;
        const whole = (t0 === null || t0 === undefined);
        const sameGrid = m1.time.length === m2.time.length;
        let both = 0, n = 0;
        for (let i = 0; i < m1.time.length; i++) {
            const t = m1.time[i];
            if (!whole && !(t >= t0 && t <= t1)) continue;
            let j = i;
            if (!sameGrid) {
                j = 0; let best = Infinity;
                for (let k = 0; k < m2.time.length; k++) {
                    const d = Math.abs(m2.time[k] - t);
                    if (d < best) { best = d; j = k; }
                }
            }
            n++;
            if (m1.moving[i] && m2.moving[j]) both++;
        }
        return n > 0 ? both / n : null;
    }

    // A visual channel of its own, separate from width (coherence) and dashing
    // (at chance): an edge resting on very little movement is drawn faint.
    function movementFade(edge) {
        const mv = edge.movement;
        if (mv === null || mv === undefined) return 1;
        if (mv >= LOW_MOVEMENT) return 1;
        return 0.35 + 0.65 * (mv / LOW_MOVEMENT);
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

        displayNetwork() {
            const container = document.getElementById('networkContainer');
            if (!container || !this.networkData) return;
            container.innerHTML = '';

            const pairs = this.networkData.crosswavelet_pairs;
            const measures = measuresIn(pairs);
            const groups = grouping(this.config, measures);
            this._networkHidden = this._networkHidden || new Set();
            this._networkSelected = null;
            movementCache.clear();
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
            help.textContent =
                'Line width is wavelet coherence between two measures, averaged '
                + 'over the period band below — the whole-recording mean until you '
                + 'pick a point on the timeline, after which it is that window. '
                + 'Cells inside the cone of influence, near the start and end of '
                + 'the record where the wavelet window runs past the data, are '
                + 'always excluded. Coherence asks whether two measures keep a '
                + 'steady phase relationship and ignores how much movement there '
                + 'is, so every line also reports what share of the window had '
                + 'both actually moving. Width is relative to the other edges on '
                + 'screen, never an absolute strength. A faint dashed line is a '
                + 'pair not distinguishable from chance — hover any line for its '
                + 'numbers, click one for its cross-wavelet detail.';
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
            assignBowRanks(drawable, positions);

            this._networkEdges = [];
            drawable.forEach(entry => {
                const a = positions[entry.pair.data_type1];
                const b = positions[entry.pair.data_type2];
                const line = el('path', {
                    d: edgePath(a, b, entry.bowRank), fill: 'none',
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
                        cx: p.x, cy: p.y, r: NODE_R, 'data-measure': name,
                        fill: group.color || theme.trace, opacity: 0.9,
                    });
                    node.appendChild(el('title', {})).textContent = name;
                    svg.appendChild(node);
                    const label = el('text', {
                        x: p.x, y: p.y + NODE_R + 16, 'text-anchor': 'middle',
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
            legend.style.cssText = 'margin:10px 0 0;opacity:0.75;font-size:12px;';
            legend.innerHTML =
                'Line width is coherence <b>relative to the other edges shown</b>, '
                + 'never an absolute strength. '
                + '<b>Solid</b>: above the 95&nbsp;% chance level in more than '
                + `${(REAL * 100).toFixed(0)}&nbsp;% of cells. `
                + '<b>Dashed</b>: at chance — a measurement, not a missing one. '
                + '<b>Faint</b>: computed mostly from stillness. '
                + 'Click a line for its cross-wavelet detail.';
            container.appendChild(legend);

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

            // Width sensitivity.
            const flexBox = document.createElement('div');
            flexBox.innerHTML =
                '<div style="font-size:12px;opacity:.75">Width sensitivity</div>';
            const flex = document.createElement('input');
            flex.type = 'range';
            flex.id = 'networkFlex';
            flex.min = String(FLEX_MIN);
            flex.max = String(FLEX_MAX);
            flex.value = String(this._networkFlex ?? FLEX_DEFAULT);
            flex.addEventListener('input', () => {
                this._networkFlex = Number(flex.value);
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
            if (!this._networkEdges) return;
            const half = ((this.config && this.config.defaultWindowSize) || 5) / 2;
            const centre = this.lastClickedPoint;
            const t0 = (centre === null || centre === undefined) ? null : centre - half;
            const t1 = (centre === null || centre === undefined) ? null : centre + half;
            const band = this.networkBand();
            const flex = this._networkFlex ?? FLEX_DEFAULT;

            // Reduce first, then scale: the pivot is the mean of the *visible*,
            // above-chance edges. At-chance edges are kept out of it because a
            // cluster of noise must not drag the scale the real ones are judged
            // against, and a hidden edge leaves it so the rest rescale.
            let untestable = 0;
            this._networkEdges.forEach(entry => {
                entry.edge = reduceEdge(entry.pair.visualization, t0, t1, band);
                entry.edge.movement = movementContext(
                    this, entry.pair.data_type1, entry.pair.data_type2, t0, t1);
                entry.verdict = verdictOf(entry.edge);
                entry.hidden = this._networkHidden.has(entry.pairKey);
                if (entry.verdict === 'untestable') untestable++;
            });
            const pool = this._networkEdges.filter(e => !e.hidden && e.verdict === 'real');
            const scoring = pool.length
                ? pool : this._networkEdges.filter(e => !e.hidden);
            const centreCoh = scoring.length
                ? scoring.reduce((a, e) => a + (e.edge.mean || 0), 0) / scoring.length
                : 0.5;

            this._networkEdges.forEach(entry => {
                const { line, edge, verdict } = entry;
                line.style.display = entry.hidden ? 'none' : '';
                if (verdict === 'real') {
                    line.setAttribute('stroke-width', widthFor(edge.mean, centreCoh, flex));
                    line.removeAttribute('stroke-dasharray');
                } else {
                    line.setAttribute('stroke-width', MIN_WIDTH);
                    line.setAttribute('stroke-dasharray', '6 6');
                }
                const base = entry === this._networkSelected ? 1
                    : (verdict === 'real' ? 0.85 : 0.35);
                line.setAttribute('opacity', base * movementFade(edge));
                entry.title.textContent = edgeTitle(entry.pairKey, edge, band);
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
            caption.textContent = untestable === this._networkEdges.length
                ? 'This output was built without a coherence null, so no edge can '
                + 'be tested: every line below shows a value with no way to tell '
                + 'it from chance. Set analysis.crosswavelet.mcCount in '
                + 'config.json and rebuild.'
                : `Coherence over ${scope ? scope.textContent : 'the recording'}${band_}.`;
        },
    });

    window.DIMS.registerTab({
        id: 'network',
        label: 'Cross-effector network',
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
            movementCache.clear();
            movementSource = null;
        },
    });
})();
