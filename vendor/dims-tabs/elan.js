// ELAN Annotations tab.
//
// Annotation tiers from an ELAN .eaf file, drawn on the same timeline.
//
// Self-registering: dims-core.js does not know this file exists, and deleting
// it removes the tab and nothing else. See docs/contracts/tab.md.
(function () {
    'use strict';

    /** [0, last sample] across every loaded series, or undefined if none.
     *
     * Undefined leaves Plotly to autoscale, which is the right fallback: a tab
     * with nothing loaded should not claim an extent it cannot know.
     */
    function recordingExtent(datasets) {
        if (!Array.isArray(datasets) || datasets.length === 0) return undefined;
        let max = -Infinity;
        datasets.forEach(d => {
            (d && d.data ? d.data : []).forEach(row => {
                const t = row && row.Time;
                if (typeof t === 'number' && Number.isFinite(t) && t > max) max = t;
            });
        });
        return max > -Infinity ? [0, max] : undefined;
    }

    // Colours come from the host's palette through the documented
    // accessor, read at draw time so a theme switch is picked up. Tabs
    // must not reach into the host's script scope: a tab file is a
    // separate script and cannot rely on seeing its variables.

    window.DIMS.extendHost({
        async loadELANData(videoID) {
            this.showStatus('Loading ELAN annotations...');
            try {
                const path = `assets/elan/${videoID}.eaf`;
                const response = await fetch(path);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                const text = await response.text();
                const parser = new DOMParser();
                const xml = parser.parseFromString(text, 'application/xml');

                const timeSlots = {};
                xml.querySelectorAll('TIME_SLOT').forEach(ts => {
                    timeSlots[ts.getAttribute('TIME_SLOT_ID')] = parseFloat(ts.getAttribute('TIME_VALUE')) / 1000;
                });

                const tiers = [];
                xml.querySelectorAll('TIER').forEach(tier => {
                    const tierID = tier.getAttribute('TIER_ID');
                    const annotations = [];
                    tier.querySelectorAll('ALIGNABLE_ANNOTATION').forEach(ann => {
                        const ref1  = ann.getAttribute('TIME_SLOT_REF1');
                        const ref2  = ann.getAttribute('TIME_SLOT_REF2');
                        const value = (ann.querySelector('ANNOTATION_VALUE')?.textContent || '').trim();
                        const start = timeSlots[ref1];
                        const end   = timeSlots[ref2];
                        if (start !== undefined && end !== undefined) {
                            annotations.push({ start, end, value });
                        }
                    });
                    if (annotations.length > 0) tiers.push({ tierID, annotations });
                });

                if (tiers.length === 0) throw new Error('No alignable annotations found in EAF file.');

                this.elanData = { tiers };
                this.displayELANTab();
                this.showTabStatus();
            } catch (e) {
                console.error('Error loading ELAN data:', e);
                this.showError(`Failed to load ELAN data: ${e.message}`);
            }
        },

        displayELANTab() {
            const container = document.getElementById('elanContainer');
            if (!container || !this.elanData) return;

            const { tiers } = this.elanData;

            if (!this.elanSelectedTiers) {
                this.elanSelectedTiers = new Set(tiers.map(t => t.tierID));
            }

            const COLORS = [
                '#5b9cf6','#4eca7f','#f77c52','#c97df5','#f5c842',
                '#4ecece','#f572a8','#a8d45a','#f5954e','#85b4f5',
                '#e05656','#52b89e','#d4b84e','#9c52e0','#52a0d4',
                '#d45295','#7ad452','#d4a052','#5274d4','#d4d452',
            ];

            const checkboxItems = tiers.map((tier, i) => {
                const color = COLORS[i % COLORS.length];
                const checked = this.elanSelectedTiers.has(tier.tierID) ? 'checked' : '';
                return `
                    <label style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;" onmouseover="this.style.background='${window.DIMS.theme().plot}'" onmouseout="this.style.background='transparent'">
                        <input type="checkbox" data-tier="${tier.tierID}" ${checked}
                            style="width:13px;height:13px;accent-color:${color};cursor:pointer;flex-shrink:0;">
                        <span style="display:inline-block;width:11px;height:11px;background:${color};border-radius:2px;flex-shrink:0;"></span>
                        <span style="color:${window.DIMS.theme().text};font-size:12px;" title="${tier.tierID}">${tier.tierID}</span>
                    </label>`;
            }).join('');

            container.innerHTML = `
                <h2 style="color:${window.DIMS.theme().text};margin-bottom:12px;">ELAN Annotations</h2>
                <div style="background:${window.DIMS.theme().plot};border:1px solid ${window.DIMS.theme().grid};border-radius:6px;padding:8px 10px;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
                        <span style="color:${window.DIMS.theme().muted};font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">Tiers</span>
                        <button id="elanSelectAll" style="font-size:10px;color:${window.DIMS.theme().muted};background:none;border:none;cursor:pointer;padding:0;" onmouseover="this.style.color='${window.DIMS.theme().text}'" onmouseout="this.style.color='${window.DIMS.theme().muted}'">all</button>
                        <button id="elanSelectNone" style="font-size:10px;color:${window.DIMS.theme().muted};background:none;border:none;cursor:pointer;padding:0;" onmouseover="this.style.color='${window.DIMS.theme().text}'" onmouseout="this.style.color='${window.DIMS.theme().muted}'">none</button>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:2px;">${checkboxItems}</div>
                </div>
                <div id="elanPlot"></div>`;

            container.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) this.elanSelectedTiers.add(cb.dataset.tier);
                    else this.elanSelectedTiers.delete(cb.dataset.tier);
                    this._renderELANPlot();
                });
            });

            document.getElementById('elanSelectAll').addEventListener('click', () => {
                this.elanSelectedTiers = new Set(tiers.map(t => t.tierID));
                container.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
                this._renderELANPlot();
            });

            document.getElementById('elanSelectNone').addEventListener('click', () => {
                this.elanSelectedTiers = new Set();
                container.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
                this._renderELANPlot();
            });

            this._renderELANPlot();
        },

        _renderELANPlot() {
            const { tiers: allTiers } = this.elanData;
            const tiers = allTiers.filter(t => this.elanSelectedTiers?.has(t.tierID));
            const N = tiers.length;

            const COLORS = [
                '#5b9cf6','#4eca7f','#f77c52','#c97df5','#f5c842',
                '#4ecece','#f572a8','#a8d45a','#f5954e','#85b4f5',
                '#e05656','#52b89e','#d4b84e','#9c52e0','#52a0d4',
                '#d45295','#7ad452','#d4a052','#5274d4','#d4d452',
            ];

            const allTierIDs = this.elanData.tiers.map(t => t.tierID);
            const maxNameLen = N > 0 ? Math.max(...tiers.map(t => t.tierID.length)) : 10;
            const leftMargin = Math.min(220, Math.max(120, maxNameLen * 7));

            const shapes = [];
            const traces = [];

            tiers.forEach((tier, i) => {
                const origIdx = allTierIDs.indexOf(tier.tierID);
                const color = COLORS[origIdx % COLORS.length];

                tier.annotations.forEach(a => {
                    shapes.push({
                        type: 'rect',
                        x0: a.start, x1: a.end,
                        y0: i + 0.1, y1: i + 0.9,
                        fillcolor: color + 'aa',
                        line: { color, width: 1.5 },
                        xref: 'x', yref: 'y'
                    });
                });

                if (tier.annotations.length > 0) {
                    traces.push({
                        x: tier.annotations.map(a => (a.start + a.end) / 2),
                        y: tier.annotations.map(() => i + 0.5),
                        mode: 'markers',
                        type: 'scatter',
                        name: tier.tierID,
                        marker: { size: 12, color: 'rgba(0,0,0,0)', symbol: 'square' },
                        text: tier.annotations.map(a =>
                            `<b>[${tier.tierID}]</b><br>${a.value || '(empty)'}<br>` +
                            `${a.start.toFixed(2)}s – ${a.end.toFixed(2)}s ` +
                            `(${(a.end - a.start).toFixed(2)}s)`
                        ),
                        hovertemplate: '%{text}<extra></extra>',
                        showlegend: false
                    });
                }
            });

            if (this.lastClickedPoint !== null) {
                const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
                const t = this.lastClickedPoint;
                const half = windowSize / 2;
                shapes.push(
                    { type: 'rect', x0: t - half, x1: t + half, y0: 0, y1: N,
                      fillcolor: window.DIMS.theme().highlightFill, line: { width: 0 }, xref: 'x', yref: 'y' },
                    { type: 'line', x0: t, x1: t, y0: 0, y1: N,
                      line: { color: window.DIMS.theme().highlight, width: 2, dash: 'dot' }, xref: 'x', yref: 'y' }
                );
            }

            const layout = {
                paper_bgcolor: window.DIMS.theme().paper, plot_bgcolor: window.DIMS.theme().plot, font: { color: window.DIMS.theme().font },
                margin: { t: 20, r: 20, b: 50, l: leftMargin },
                xaxis: {
                    title: 'Time (s)', color: window.DIMS.theme().font, gridcolor: window.DIMS.theme().grid, zeroline: false,
                    // The recording's extent, not the annotations'. This asked
                    // the host for `mergedData`, which the host has never set --
                    // so the request always failed and Plotly autoscaled to the
                    // annotated span. Lanes then did not line up with any other
                    // tab, and an unannotated head or tail of the recording was
                    // simply absent. `currentData` is what the host actually
                    // holds, and is the same source the time slider's bounds
                    // come from.
                    range: recordingExtent(this.currentData)
                },
                yaxis: {
                    tickvals: tiers.map((_, i) => i + 0.5),
                    ticktext: tiers.map(t => t.tierID),
                    tickfont: { color: window.DIMS.theme().font, size: 10 },
                    gridcolor: window.DIMS.theme().grid,
                    range: [0, N],
                    zeroline: false
                },
                showlegend: false,
                shapes,
                hovermode: 'closest'
            };

            Plotly.newPlot('elanPlot', traces, layout, { responsive: true });
            document.getElementById('elanPlot').on('plotly_click', d => {
                if (d.points[0]) this.handleTimeClick(d.points[0].x);
            });
        },

        updateELANHighlight() {
            if (!this.elanData || !document.getElementById('elanPlot')) return;
            this._renderELANPlot();
        }
    });

    window.DIMS.registerTab({
        id: 'elan',
        label: 'ELAN Annotations',
        status: 'Click an annotation to jump to it.',
        order: 50,
        gate: cfg => !!cfg.include_elan,
        async onActivate(app, container) {
        if (app.currentVideoID && !app.elanData) await app.loadELANData(app.currentVideoID);
        else if (app.elanData) app.displayELANTab();
        },
        onTimeUpdate(app) {
        if (app.elanData) app.updateELANHighlight();
        },
        onVideoChange(app) {
            app.elanData = null;
        },
    });
})();
