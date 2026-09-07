// DTW (Beta) tab.
//
// Dynamic time warping between two measures: how much one has to be
// stretched in time to match the other.
//
// Lifted from DIMS_Dashboard_Ortho, where it was added by editing three regions
// of a 2500-line class -- which is exactly why it could never reach any other
// study. Self-registering now: see docs/contracts/tab.md.
(function () {
    'use strict';

    window.DIMS.extendHost({
        async loadDTWData(videoID) {
            this.showStatus('Loading DTW data...');
            try {
                const d = await this.loadJSON(`assets/dtw/${videoID}_dtw_data.json`);
                if (!d?.dtw_data || Object.keys(d.dtw_data).length === 0) {
                    this.showError('DTW data not found. Run the optional DTW pre-computation step first.');
                    return;
                }
                this.dtwData = d;
                this.displayDTWPlots();
            } catch (e) {
                this.showError(`Failed to load DTW data: ${e.message}`);
            }
        },

        displayDTWPlots() {
            const container = document.getElementById('dtwContainer');
            if (!container || !this.dtwData) return;
            container.innerHTML = '<h2 style="color:white;margin-bottom:20px;">Dynamic Time Warping — Windowed Analysis</h2>';
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(700px,1fr));gap:20px;';
            const configs = [];
            Object.entries(this.dtwData.dtw_data).forEach(([pairKey, pairData], i) => {
                const div = document.createElement('div');
                div.id = `dtw-plot-${i}`;
                div.style.cssText = 'height:600px;background:#222;border-radius:5px;padding:5px;';
                grid.appendChild(div);
                configs.push({ id: div.id, pairKey, pairData });
            });
            container.appendChild(grid);
            setTimeout(() => {
                configs.forEach(c => this.createDTWPlot(c.id, c.pairKey, c.pairData));
                this.showStatus('DTW plots loaded. Click any point to synchronize.');
            }, 100);
        },

        createDTWPlot(containerId, pairKey, pairData) {
            if (!window.Plotly) return;
            const wm   = pairData.windowed_metrics;
            const glob = pairData.global;
            const snames = pairData.series_names;
            const t   = wm.time;
            const dist = wm.dtw_distance;
            const lag  = wm.mean_phase_lag_sec;
            const ext  = wm.warping_extent_sec;

            const posLag = lag.map(v => v >= 0 ? v : 0);
            const negLag = lag.map(v => v <  0 ? v : 0);

            const traces = [
                { x: t, y: dist, type: 'scatter', mode: 'lines', fill: 'tozeroy',
                  line: { color: 'mediumpurple', width: 2 }, fillcolor: 'rgba(147,112,219,0.25)',
                  name: 'DTW distance', xaxis: 'x', yaxis: 'y',
                  hovertemplate: 'Time: %{x:.1f}s<br>Dist: %{y:.4f}<extra></extra>' },
                { x: t, y: lag, type: 'scatter', mode: 'lines',
                  line: { color: 'white', width: 1.5 }, showlegend: false,
                  xaxis: 'x2', yaxis: 'y2',
                  hovertemplate: 'Time: %{x:.1f}s<br>Lag: %{y:+.3f}s<extra></extra>' },
                { x: t, y: posLag, type: 'scatter', mode: 'lines', fill: 'tozeroy',
                  line: { width: 0 }, fillcolor: 'rgba(50,200,100,0.4)',
                  name: `${snames[0]} leads`, xaxis: 'x2', yaxis: 'y2' },
                { x: t, y: negLag, type: 'scatter', mode: 'lines', fill: 'tozeroy',
                  line: { width: 0 }, fillcolor: 'rgba(220,80,80,0.4)',
                  name: `${snames[1]} leads`, xaxis: 'x2', yaxis: 'y2' },
                { x: t, y: ext, type: 'scatter', mode: 'lines', fill: 'tozeroy',
                  line: { color: 'gold', width: 2 }, fillcolor: 'rgba(255,215,0,0.2)',
                  name: 'Warping extent', xaxis: 'x3', yaxis: 'y3',
                  hovertemplate: 'Time: %{x:.1f}s<br>Extent: %{y:.3f}s<extra></extra>' },
            ];

            const titleLabel = pairKey.replace('_vs_', ' ↔ ');
            const layout = {
                title: { text: `DTW: ${titleLabel}<br><sub>Global dist: ${glob.dtw_distance.toFixed(4)} | Mean lag: ${glob.mean_phase_lag_sec > 0 ? '+' : ''}${glob.mean_phase_lag_sec.toFixed(3)}s</sub>`,
                         font: { color: 'white', size: 12 } },
                paper_bgcolor: '#222', plot_bgcolor: '#333', font: { color: 'white' },
                margin: { t: 55, r: 15, b: 35, l: 55 },
                grid: { rows: 3, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
                xaxis:  { domain: [0, 1], anchor: 'y',  showticklabels: false, showgrid: false },
                yaxis:  { domain: [0.68, 1],   anchor: 'x',  title: 'DTW dist',  showgrid: true, gridcolor: 'rgba(255,255,255,0.08)' },
                xaxis2: { domain: [0, 1], anchor: 'y2', showticklabels: false, showgrid: false },
                yaxis2: { domain: [0.34, 0.64], anchor: 'x2', title: 'Lag (s)', zeroline: true, zerolinecolor: 'rgba(255,255,255,0.3)', showgrid: true, gridcolor: 'rgba(255,255,255,0.08)' },
                xaxis3: { domain: [0, 1], anchor: 'y3', title: 'Time (s)', showgrid: false },
                yaxis3: { domain: [0, 0.30], anchor: 'x3', title: 'Extent (s)', showgrid: true, gridcolor: 'rgba(255,255,255,0.08)' },
                legend: { font: { color: 'white' }, bgcolor: 'rgba(0,0,0,0.3)', orientation: 'h', y: 1.08 },
                hovermode: 'x unified',
                shapes: this._dtwShapes(this.lastClickedPoint),
            };

            Plotly.newPlot(containerId, traces, layout, { responsive: true });
            document.getElementById(containerId).on('plotly_click', d => {
                if (d.points[0]) this.handleTimeClick(d.points[0].x);
            });
        },

        _dtwShapes(t) {
            if (t === null) return [];
            return [
                { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x',  yref: 'y domain',  line: { color: 'yellow', width: 1.5 } },
                { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x2', yref: 'y2 domain', line: { color: 'yellow', width: 1.5 } },
                { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x3', yref: 'y3 domain', line: { color: 'yellow', width: 1.5 } },
            ];
        },

        updateDTWHighlights() {
            if (!this.dtwData?.dtw_data) return;
            const shapes = this._dtwShapes(this.lastClickedPoint);
            Object.keys(this.dtwData.dtw_data).forEach((_, i) => {
                const el = document.getElementById(`dtw-plot-${i}`);
                if (el) Plotly.relayout(`dtw-plot-${i}`, { shapes });
            });
        }
    });

    window.DIMS.registerTab({
        id: 'dtw',
        label: 'DTW (Beta)',
        order: 45,
        gate: cfg => cfg.include_dtw === true,
        async onActivate(app, container) {
        if (app.currentVideoID && !app.dtwData) await app.loadDTWData(app.currentVideoID);
        else if (app.dtwData) app.displayDTWPlots();
        },
        onTimeUpdate(app) {
        if (app.dtwData) app.updateDTWHighlights();
        },
        onVideoChange(app) {
            app.dtwData = null;
        },
    });
})();
