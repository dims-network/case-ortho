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

    function verdictOf(edge) {
        if (edge.fraction === null) return 'untestable';
        if (edge.fraction >= REAL) return 'real';
        return 'chance';
    }

    function edgeTitle(pairKey, edge) {
        const value = edge.mean === null ? '—' : edge.mean.toFixed(3);
        const lines = [`${pairKey.replace('_vs_', '  ↔  ')}`,
                       `mean coherence: ${value}`];
        if (edge.fraction === null) {
            lines.push('no coherence null in this output, so this value cannot',
                       'be tested. Set analysis.crosswavelet.mcCount and rebuild.');
        } else {
            lines.push(`above chance in ${(edge.fraction * 100).toFixed(1)}% of `
                       + `${edge.tested} tested cells`,
                       `(independence gives about ${(CHANCE * 100).toFixed(0)}%)`);
        }
        return lines.join('\n');
    }

    // ---- drawing -------------------------------------------------------------

    function layout(groups) {
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
                positions[name] = { x: cx, y, group };
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

    function widthFor(mean) {
        const v = Math.max(0, Math.min(1, mean === null ? 0 : mean));
        return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * v;
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
            const positions = layout(groups);
            const theme = window.DIMS.theme();

            const heading = document.createElement('h2');
            heading.textContent = 'Cross-effector network';
            heading.style.marginBottom = '4px';
            container.appendChild(heading);

            const caption = document.createElement('p');
            caption.id = 'networkCaption';
            caption.style.cssText = 'margin:0 0 12px;opacity:0.8;font-size:13px;';
            container.appendChild(caption);

            const svg = el('svg', {
                id: 'networkSvg', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
                width: '100%', role: 'img',
                'aria-label': 'Coherence between measures, following the playhead',
            });
            svg.style.maxHeight = '70vh';
            container.appendChild(svg);

            // Edges first so nodes sit on top of them.
            const edgeLayer = el('g', { id: 'networkEdges' });
            svg.appendChild(edgeLayer);

            this._networkEdges = [];
            Object.entries(pairs).forEach(([pairKey, pair]) => {
                const a = positions[pair.data_type1];
                const b = positions[pair.data_type2];
                if (!a || !b) return;      // a pair whose measures are not drawn
                const line = el('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke: theme.trace, 'stroke-linecap': 'round',
                    'stroke-width': MIN_WIDTH, opacity: 0.5,
                });
                const title = el('title', {});
                line.appendChild(title);
                edgeLayer.appendChild(line);
                this._networkEdges.push({ pairKey, pair, line, title });
            });

            groups.forEach(group => {
                group.members.forEach(name => {
                    const p = positions[name];
                    const node = el('circle', {
                        cx: p.x, cy: p.y, r: NODE_R,
                        fill: group.color || theme.trace, opacity: 0.9,
                    });
                    node.appendChild(el('title', {})).textContent = name;
                    svg.appendChild(node);
                    const label = el('text', {
                        x: p.x, y: p.y + NODE_R + 16, 'text-anchor': 'middle',
                        fill: theme.font, 'font-size': 13,
                    });
                    label.textContent = nodeLabel(name, group);
                    svg.appendChild(label);
                });
                const p = positions[group.members[0]];
                if (p && group.label) {
                    const heading2 = el('text', {
                        x: p.x, y: 60, 'text-anchor': 'middle',
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
                'Line width is mean coherence in the window. '
                + '<b>Solid</b>: above the 95&nbsp;% chance level in more than '
                + `${(REAL * 100).toFixed(0)}&nbsp;% of cells. `
                + '<b>Dashed</b>: at chance — a measurement, not a missing one.';
            container.appendChild(legend);

            this.updateNetwork();
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

            let untestable = 0;
            this._networkEdges.forEach(entry => {
                const edge = reduceEdge(entry.pair.visualization, t0, t1, band);
                const verdict = verdictOf(edge);
                if (verdict === 'untestable') untestable++;
                entry.line.setAttribute('stroke-width', widthFor(edge.mean));
                entry.line.setAttribute('stroke-dasharray',
                    verdict === 'real' ? '' : '6 6');
                entry.line.setAttribute('opacity', verdict === 'real' ? 0.85 : 0.35);
                entry.title.textContent = edgeTitle(entry.pairKey, edge);
            });

            const caption = document.getElementById('networkCaption');
            if (!caption) return;
            const when = (centre === null || centre === undefined)
                ? 'the whole recording'
                : `${(centre - half).toFixed(1)}–${(centre + half).toFixed(1)} s`;
            const band_ = band ? `, periods ${band[0]}–${band[1]} s` : '';
            caption.textContent = untestable === this._networkEdges.length
                ? 'This output was built without a coherence null, so no edge can '
                + 'be tested: every line below shows a value with no way to tell '
                + 'it from chance. Set analysis.crosswavelet.mcCount in '
                + 'config.json and rebuild.'
                : `Coherence over ${when}${band_}.`;
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
        },
    });
})();
