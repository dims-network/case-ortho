// DIMS Dashboard - Main Application Logic with Cross-Wavelet Support

// Theme is driven entirely by CSS custom properties (see css/theme.css).
// Charts read the active theme's tokens at render time, so adding/changing a
// theme means editing CSS only.
// Where this file was loaded from, so assets that belong to the CORE (the
// logo, the mark) resolve wherever a study chose to vendor it. They used to be
// looked for under the study's own assets/branding/, which meant every study
// had to carry its own copy of the DIMS logo -- and the two studies that never
// did simply showed a broken image.
const CORE_BASE = (function () {
    const el = document.currentScript;
    if (!el || !el.src) return '';
    return el.src.replace(/[^/]*$/, '');
})();

const THEMES = ['aurora', 'midnight'];

function readTheme() {
    const s = getComputedStyle(document.documentElement);
    const v = n => s.getPropertyValue(n).trim();
    return {
        paper: v('--panel'), plot: v('--panel2'), grid: v('--line'),
        font: v('--text'), text: v('--text'), muted: v('--muted'),
        trace: v('--text'), accent: v('--accent'),
        highlight: v('--accent'), highlightFill: v('--accent-soft')
    };
}
let THEME = readTheme();

// ---------------------------------------------------------------------------
// The tab registry.
//
// Every tab registers itself here -- the built-in ones in packages/dims-tabs/
// included. That is deliberate: if this mechanism breaks, ELAN and RQA break
// with it, in the same commit, so it cannot rot unnoticed while only
// third-party tabs suffer.
//
// Load order is dims-core.js first, then the tab files. Registering after the
// app has been constructed is too late and is ignored.
//
// Contract, with the acceptance checks: docs/contracts/tab.md
// ---------------------------------------------------------------------------
window.DIMS = window.DIMS || {
    _tabs: [],

    registerTab(def) {
        if (!def || !def.id) {
            console.error('DIMS.registerTab: a tab needs an id', def);
            return;
        }
        if (this._tabs.some(t => t.id === def.id)) {
            console.error(`DIMS.registerTab: duplicate tab id '${def.id}' ignored`);
            return;
        }
        this._tabs.push(def);
    },

    // Tabs whose rendering lives in their own file attach it to the host here.
    // Explicit rather than magic, so it can be grepped for.
    extendHost(methods) {
        if (!this._appProto) {
            console.error('DIMS.extendHost called before dims-core.js defined the host');
            return;
        }
        Object.assign(this._appProto, methods);
    },

    // Tabs must style themselves with CSS custom properties. This is exposed
    // only for the plot libraries, which need concrete colour values.
    theme() { return THEME; }
};

class DIMSApp {
    constructor() {
        this.config = null;
        this.currentData = null;
        this.currentTranscript = null;
        this.currentVideoID = null;
        this.lastClickedPoint = null;
        this.timeSlider = null;
        this.rqaData = null;
        this.crossWaveletData = null;
        this.crqaData = null;
        this.elanData = null;
        this.elanSelectedTiers = null;
        this.currentTab = null;
        this.currentPerspective = '';
        this.tabs = [];
        this._timeSubscribers = [];
    }

    async initialize() {
        try {
            this.showStatus('Loading configuration...');
            
            // Load configuration
            this.config = await this.loadJSON('config.json');
            
            if (!this.config) {
                throw new Error('Failed to load config.json');
            }
            
            this.showStatus('Setting up interface...');

            this.watchViewportSize();

            // Setup UI
            this.setupTheme();
            this.setupHeader();
            this.setupTabs();
            this.setupControls();
            this.setupPerspectiveControl();
            this.setupEventListeners();
            
            // Load first video by default
            if (this.config.videoIDs && this.config.videoIDs.length > 0) {
                const firstVideoID = this.config.videoIDs[0];
                document.getElementById('videoSelect').value = firstVideoID;
                await this.loadVideoData(firstVideoID);
            } else {
                this.showStatus('No videos configured. Please check config.json');
            }
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showError(`Failed to initialize: ${error.message}`);
        }
    }

    setupTabs() {
        // Which tabs apply to this study. Nothing is listed here: tabs register
        // themselves and decide for themselves whether they apply.
        this.tabs = (window.DIMS._tabs || [])
            .filter(t => {
                try {
                    return !t.gate || t.gate(this.config);
                } catch (err) {
                    console.error(`Tab '${t.id}' gate threw; hiding it.`, err);
                    return false;
                }
            })
            .sort((a, b) => (a.order == null ? 100 : a.order) - (b.order == null ? 100 : b.order));

        // Wrap the time slider (and the tab bar, below) in one sticky toolbar so
        // they pin to the top of the page together while scrolling.
        const sliderContainer = document.querySelector('.slider-container');
        let stickyBar = document.getElementById('stickyBar');
        if (sliderContainer && !stickyBar) {
            stickyBar = document.createElement('div');
            stickyBar.id = 'stickyBar';
            sliderContainer.parentNode.insertBefore(stickyBar, sliderContainer);
            stickyBar.appendChild(sliderContainer);
        }

        const plotContainer = document.getElementById('plotContainer');
        if (!plotContainer) return;

        // A single tab is no choice at all, so the bar is hidden entirely.
        const showBar = this.tabs.length > 1;

        let tabContainer = document.getElementById('tabContainer');
        if (!tabContainer) {
            tabContainer = document.createElement('div');
            tabContainer.id = 'tabContainer';
            (stickyBar || plotContainer.parentNode).appendChild(tabContainer);
        }
        tabContainer.innerHTML = showBar
            ? `<div class="tabs">${this.tabs.map((t, i) =>
                `<button class="tab-button${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label || t.id}</button>`
              ).join('')}</div>`
            : '';

        // One pane per tab. containerId lets a tab keep an id that other code
        // already depends on (#plotContainer, #crossWaveletContainer).
        this.tabs.forEach((t, i) => {
            const id = this.paneIdFor(t);
            let pane = document.getElementById(id);
            if (!pane) {
                pane = document.createElement('div');
                pane.id = id;
                pane.className = 'plot-pane';
                pane.style.minHeight = '800px';
                pane.style.padding = '20px';
                plotContainer.parentNode.insertBefore(pane, plotContainer.nextSibling);
            }
            pane.style.display = i === 0 ? 'block' : 'none';
        });

        this.currentTab = this.tabs.length ? this.tabs[0].id : null;

        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
    }

    paneIdFor(tab) {
        return tab.containerId || `${tab.id}Container`;
    }

    switchTab(tabName) {
        const tab = (this.tabs || []).find(t => t.id === tabName);
        if (!tab) return;

        const previous = this.currentTab;
        if (previous && previous !== tabName) {
            const prev = (this.tabs || []).find(t => t.id === previous);
            if (prev && prev.onDeactivate) {
                try { prev.onDeactivate(this); }
                catch (err) { console.error(`Tab '${previous}' onDeactivate failed:`, err); }
            }
        }
        this.currentTab = tabName;

        document.querySelectorAll('.tab-button').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabName);
        });
        (this.tabs || []).forEach(t => {
            const el = document.getElementById(this.paneIdFor(t));
            if (el) el.style.display = t.id === tabName ? 'block' : 'none';
        });

        const container = document.getElementById(this.paneIdFor(tab));
        try {
            if (!tab._activated) {
                tab._activated = true;
                Promise.resolve(tab.onActivate && tab.onActivate(this, container))
                    .catch(err => console.error(`Tab '${tabName}' onActivate failed:`, err));
            } else if (tab.onUpdate) {
                tab.onUpdate(this, container);
            }
        } catch (err) {
            console.error(`Tab '${tabName}' failed to activate:`, err);
        }

        this.resizePlotsIn(container);
    }

    // Re-measure every Plotly figure in a pane that has just been shown.
    //
    // Panes are hidden with display:none. A figure drawn -- or last laid out --
    // while its pane was hidden has no width to measure, so Plotly keeps
    // whatever size it had and does not notice when the pane reappears. The
    // symptom is a plot that comes back the wrong size and stays that way until
    // something forces a relayout, which is why dragging the time slider
    // "repaired" it: the redraw was the fix, not the slider.
    //
    // requestAnimationFrame, because display:block has only just been set and
    // the element has no layout yet in this frame.
    resizePlotsIn(root) {
        const target = root || document;
        const run = () => {
            if (typeof Plotly === 'undefined' || !Plotly.Plots || !Plotly.Plots.resize) return;
            // querySelectorAll walks descendants only, never the root itself. A
            // tab whose container IS the graph div is therefore invisible to it,
            // and the timeseries tab is exactly that: it draws straight into
            // #plotContainer, which is also its pane. The first version of this
            // shipped with that hole and fixed every tab except the one people
            // noticed.
            const figures = [];
            if (target.matches && target.matches('.js-plotly-plot')) figures.push(target);
            target.querySelectorAll('.js-plotly-plot').forEach(el => figures.push(el));
            figures.forEach(el => {
                // A figure can be removed between the frame being queued and it
                // running, and one that never finished drawing has no layout to
                // resize; neither is worth failing a tab switch over.
                if (!el.isConnected || !el._fullLayout) return;
                try { Plotly.Plots.resize(el); }
                catch (err) { console.warn('Could not resize a figure:', err); }
            });
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else run();
    }

    // Figures do not follow the window on their own either, and a pane that was
    // hidden while the window changed size comes back at the old one. Resizing
    // the visible pane on a settled window size covers the first; switchTab
    // covers the second.
    watchViewportSize() {
        if (this._viewportWatched) return;
        this._viewportWatched = true;
        let timer = null;
        window.addEventListener('resize', () => {
            clearTimeout(timer);
            // Plotly relayout is not cheap and a drag fires this continuously,
            // so act on the size the user settled on, not every frame of it.
            timer = setTimeout(() => {
                const tab = (this.tabs || []).find(t => t.id === this.currentTab);
                this.resizePlotsIn(tab ? document.getElementById(this.paneIdFor(tab)) : null);
            }, 150);
        });
    }

    // Metric strip specs shared by the RQA and cRQA recurrence figures:
    // [key, title, color, y-axis label].
    _metricSpecs() {
        return [
            ['RR', 'Recurrence Rate (RR)', '#4fc3f7', 'RR'],
            ['DET', 'Determinism (DET)', '#81c784', 'DET'],
            ['LAM', 'Laminarity (LAM)', '#ffb74d', 'LAM'],
            ['L_MAX', 'Longest diagonal line (L_MAX)', '#e57373', 'seconds'],
        ];
    }

    // Single figure: the square recurrence plot with a top raw-series marginal,
    // a left rotated-series marginal, and the windowed-metric strips stacked
    // below — all sharing one time x-axis so they stay perfectly aligned.
    // `rerender` is called after a time selection to redraw the window.
    _renderRecurrenceFigure(containerId, opts, rerender) {
        const el = document.getElementById(containerId);
        if (!el || !window.Plotly) return;
        const { titleText, time, matrix, topSeries, leftSeries, xTitle, yTitle, wm } = opts;
        const t0 = time[0], t1 = time[time.length - 1];

        const hasMetrics = !!(wm && wm.time && wm.time.length > 0);
        const metrics = hasMetrics ? this._metricSpecs() : []; // [key,title,color,yLabel]
        const nMet = metrics.length;

        // ---- pixel layout so the heatmap is a true square ----
        const PAD = 20, L = 80, R = 50, T = 70, B = 55, SHRINK = 0.85;
        const availW = (el.clientWidth || 900) - PAD - L - R;
        const Wp = Math.max(300, Math.round(availW * SHRINK));
        const W = Wp + L + R;
        const xMain = [0.15, 0.95];
        const S = (xMain[1] - xMain[0]) * Wp;     // square side (px)
        const tsH = 60, g1 = 16, gm = 50, msH = 95, mg = 26;
        const metricsBlock = nMet > 0 ? gm + nMet * msH + (nMet - 1) * mg : 0;
        const Hp = tsH + g1 + S + metricsBlock;
        const H = Hp + T + B;
        el.style.height = (H + PAD) + 'px';
        const fy = px => px / Hp;

        // vertical domains from the bottom up: metrics, heatmap, top series
        let yb = 0;
        const metDomain = {};
        for (let i = nMet - 1; i >= 0; i--) {     // bottom-up => RR ends up on top
            metDomain[metrics[i][0]] = [fy(yb), fy(yb + msH)];
            yb += msH + mg;
        }
        if (nMet > 0) yb += gm - mg;
        const mapDomain = [fy(yb), fy(yb + S)];
        yb += S + g1;
        const topDomain = [fy(yb), fy(yb + tsH)];

        // ---- traces ----
        const traces = [
            { x: time, y: time, z: matrix, type: 'heatmap',
              colorscale: [[0, 'white'], [1, 'black']], showscale: false,
              xaxis: 'x', yaxis: 'y',
              hovertemplate: `${xTitle}: %{x:.1f}s<br>${yTitle}: %{y:.1f}s<extra></extra>` },
            { x: time, y: topSeries.values, type: 'scatter', mode: 'lines',
              line: { color: topSeries.color, width: 2 }, xaxis: 'x2', yaxis: 'y2',
              hovertemplate: 'Time: %{x:.1f}s<br>Value: %{y:.2f}<extra></extra>' },
            { x: leftSeries.values, y: time, type: 'scatter', mode: 'lines',
              line: { color: leftSeries.color, width: 2 }, xaxis: 'x3', yaxis: 'y',
              hovertemplate: 'Value: %{x:.2f}<br>Time: %{y:.1f}s<extra></extra>' }
        ];

        // ---- layout / axes ----
        const layout = {
            title: { text: titleText, font: { color: THEME.font, size: 16 } },
            width: W, height: H,
            paper_bgcolor: THEME.paper, plot_bgcolor: THEME.plot,
            font: { color: THEME.font },
            margin: { t: T, r: R, b: B, l: L },
            hovermode: 'closest', showlegend: false,
            xaxis: { domain: xMain, anchor: 'y', range: [t0, t1], gridcolor: THEME.grid,
                     showticklabels: nMet === 0, title: nMet === 0 ? xTitle : '' },
            yaxis: { domain: mapDomain, anchor: 'x', title: yTitle, gridcolor: THEME.grid },
            xaxis2: { domain: xMain, anchor: 'y2', matches: 'x', showticklabels: false, gridcolor: THEME.grid },
            yaxis2: { domain: topDomain, anchor: 'x2', title: 'Value', gridcolor: THEME.grid },
            xaxis3: { domain: [0, 0.10], anchor: 'y', title: 'Value', autorange: 'reversed', gridcolor: THEME.grid }
        };

        // metric strips share the time x-axis (matches: 'x') => always aligned
        metrics.forEach(([key, , color, yLabel], i) => {
            const n = i + 4;
            const isBottom = i === nMet - 1;
            traces.push({
                x: wm.time, y: wm[key], type: 'scatter', mode: 'lines+markers',
                line: { color, width: 1.5 }, marker: { color, size: 3 },
                xaxis: `x${n}`, yaxis: `y${n}`,
                hovertemplate: `${key} %{x:.1f}s: %{y:.3f}<extra></extra>`
            });
            layout[`xaxis${n}`] = { domain: xMain, anchor: `y${n}`, matches: 'x',
                gridcolor: THEME.grid, showticklabels: isBottom, title: isBottom ? xTitle : '' };
            layout[`yaxis${n}`] = { domain: metDomain[key], anchor: `x${n}`,
                title: yLabel || key, gridcolor: THEME.grid, rangemode: 'tozero' };
        });

        // ---- window highlight ----
        if (this.lastClickedPoint !== null) {
            const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
            const start = Math.max(t0, this.lastClickedPoint - windowSize / 2);
            const end = Math.min(t1, this.lastClickedPoint + windowSize / 2);
            layout.shapes = [
                // vertical window band across heatmap, top series and all metrics
                { type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: end, y0: 0, y1: 1,
                  fillcolor: THEME.highlight, opacity: 0.12, line: { width: 0 } },
                { type: 'line', xref: 'x', yref: 'paper',
                  x0: this.lastClickedPoint, x1: this.lastClickedPoint, y0: 0, y1: 1,
                  line: { color: THEME.highlight, width: 1.5 } },
                // horizontal window band on the heatmap and the left series
                { type: 'rect', xref: 'x', yref: 'y', x0: t0, x1: t1, y0: start, y1: end,
                  fillcolor: THEME.highlight, opacity: 0.10, line: { width: 0 } },
                { type: 'rect', xref: 'x3 domain', yref: 'y', x0: 0, x1: 1, y0: start, y1: end,
                  fillcolor: THEME.highlight, opacity: 0.12, line: { width: 0 } }
            ];
        }

        Plotly.newPlot(containerId, traces, layout, { responsive: false });
        el.on('plotly_click', (data) => {
            if (!data.points || !data.points.length) return;
            const p = data.points[0];
            // any time-based subplot (everything except the rotated left series x3)
            if (p.xaxis && p.xaxis._id !== 'x3') {
                this.handleTimeClick(p.x);
                if (rerender) setTimeout(rerender, 100);
            }
        });
    }

    setupHeader() {
        try {
            // The browser tab is how you tell two dashboards apart when both
            // are open, so it must carry the study name. It was hardcoded to
            // "DIMS Dashboard" in every case repo, which made a mis-served
            // dashboard indistinguishable from the right one.
            if (this.config.title) document.title = this.config.title;

            const subtitleEl = document.getElementById('subtitle');
            const authorsEl = document.getElementById('authors');
            const contactsEl = document.getElementById('contacts');

            // Title now lives in the logo image; keep subtitle/authors/contacts.
            if (subtitleEl) subtitleEl.textContent = this.config.subtitle || '';
            if (authorsEl) authorsEl.textContent = this.config.authors || '';
            if (contactsEl) contactsEl.textContent = this.config.contacts || '';
        } catch (error) {
            console.error('Error setting up header:', error);
        }
    }

    setupControls() {
        try {
            // Populate video selector
            const videoSelect = document.getElementById('videoSelect');
            if (!videoSelect) {
                console.error('Video select element not found');
                return;
            }
            
            videoSelect.innerHTML = '<option value="">Select a video...</option>';
            
            if (this.config.videoIDs && Array.isArray(this.config.videoIDs)) {
                this.config.videoIDs.forEach(videoID => {
                    const option = document.createElement('option');
                    option.value = videoID;
                    option.textContent = videoID;
                    videoSelect.appendChild(option);
                });
            }

            // Set default window size
            const windowSizeEl = document.getElementById('windowSize');
            if (windowSizeEl && this.config.defaultWindowSize) {
                windowSizeEl.value = this.config.defaultWindowSize;
            }
        } catch (error) {
            console.error('Error setting up controls:', error);
        }
    }

    setupPerspectiveControl() {
        // Built from config rather than shipped in index.html, so a study that
        // does not use perspectives has no dead control, and one that does need
        // not edit its markup.
        const list = Array.isArray(this.config.perspectives) ? this.config.perspectives : [];
        if (!list.length) return;

        const controls = document.querySelector('.controls');
        if (!controls || document.getElementById('perspectiveSelect')) return;

        const label = document.createElement('label');
        label.setAttribute('for', 'perspectiveSelect');
        label.textContent = 'Perspective:';
        label.style.marginLeft = '8px';

        const select = document.createElement('select');
        select.id = 'perspectiveSelect';
        select.innerHTML = '<option value="">auto</option>' +
            list.map(p => `<option value="${p}">${p}</option>`).join('');

        controls.appendChild(label);
        controls.appendChild(select);
        this.currentPerspective = '';

        select.addEventListener('change', (e) => {
            this.currentPerspective = e.target.value || '';
            const t = this.lastClickedPoint ?? 0;
            const win = parseInt(document.getElementById('windowSize').value)
                || this.config.defaultWindowSize || 5;
            this.updateVideos(t, win);
        });
    }

    setupEventListeners() {
        document.getElementById('videoSelect').addEventListener('change', (e) => {
            this.loadVideoData(e.target.value);
        });
        
        document.getElementById('windowSize').addEventListener('change', () => {
            if (this.lastClickedPoint !== null) {
                this.handleTimeClick(this.lastClickedPoint);
            }
        });
    }

    // ---- Theming (all colors live in css/theme.css) ----
    setupTheme() {
        let saved = localStorage.getItem('dims-theme');
        if (!THEMES.includes(saved)) saved = 'aurora';

        const select = document.getElementById('themeSelect');
        if (select) {
            // Options are built from THEMES rather than trusted from the markup.
            // They used to be hardcoded in every index.html, which meant adding
            // a theme to the core reached nobody: a study vendors the core but
            // owns its markup, so the new theme would exist and be unofferable.
            select.innerHTML = THEMES.map(t =>
                `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('');
            select.value = saved;
            select.addEventListener('change', (e) => this.applyTheme(e.target.value));
        }

        // Apply before the first render so charts read the right tokens.
        this.applyTheme(saved, false);
    }

    applyTheme(name, rerender = true) {
        if (!THEMES.includes(name)) name = 'aurora';
        document.documentElement.dataset.theme = name;
        localStorage.setItem('dims-theme', name);
        THEME = readTheme();

        const logo = document.getElementById('logo');
        if (logo) {
            const variant = name === 'aurora' ? 'light' : 'dark';
            logo.src = `${CORE_BASE}branding/dims-logo-${variant}.png`;
        }

        if (rerender) this.rerenderAll();
    }

    // Redraw everything with the active theme. Clears per-tab caches so each
    // tab is freshly drawn (reading the new THEME) when shown.
    rerenderAll() {
        const vid = this.currentVideoID;
        if (!vid) return;
        const tab = this.currentTab;
        this.rqaData = null;
        this.crossWaveletData = null;
        this.crqaData = null;
        this.elanData = null;
        Promise.resolve(this.loadVideoData(vid)).then(() => this.switchTab(tab));
    }

    async loadJSON(url) {
        try {
            console.log(`Attempting to load JSON from: ${url}`);
            const response = await fetch(url);
            console.log(`Fetch response for ${url}:`, response.status, response.statusText);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const text = await response.text();
            console.log(`Raw response length for ${url}:`, text.length);
            
            try {
                const data = JSON.parse(text);
                console.log(`Successfully parsed JSON from: ${url}`, data);
                return data;
            } catch (parseError) {
                console.error(`JSON parse error for ${url}:`, parseError);
                console.error('First 500 chars of response:', text.substring(0, 500));
                throw parseError;
            }
        } catch (error) {
            console.error(`Failed to load JSON from ${url}:`, error);
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                console.error('This might be a CORS issue. Make sure you are running a local server.');
            }
            return null;
        }
    }

    async loadCSV(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const res = Papa.parse(text, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });
            // Accept the time column under any casing/whitespace (e.g. "time",
            // "TIME", " Time ") by normalizing it to the canonical "Time" key the
            // rest of the dashboard reads.
            const fields = (res.meta && res.meta.fields) || [];
            const timeField = fields.find(f => String(f).trim().toLowerCase() === 'time');
            if (timeField && timeField !== 'Time') {
                res.data.forEach(row => {
                    row.Time = row[timeField];
                    delete row[timeField];
                });
            }
            return res;
        } catch (error) {
            console.warn(`Failed to load CSV: ${url}`, error);
            return null;
        }
    }

    cleanTimeseriesData(data) {
        // Sort data by time first
        const sortedData = [...data].sort((a, b) => a.Time - b.Time);
        
        // Check if time values reset (wrap around)
        let wrapDetected = false;
        let wrapIndex = -1;
        
        for (let i = 1; i < sortedData.length; i++) {
            if (sortedData[i].Time < sortedData[i-1].Time - 0.1) { // Allow small tolerance for floating point
                console.warn(`Time wrap detected at index ${i}: ${sortedData[i-1].Time} -> ${sortedData[i].Time}`);
                wrapDetected = true;
                wrapIndex = i;
                break;
            }
        }
        
        if (wrapDetected) {
            // Return only the first segment before the wrap
            console.log(`Removing wrapped data after index ${wrapIndex}`);
            return sortedData.slice(0, wrapIndex);
        }
        
        return sortedData;
    }

    async loadDataForVideoID(videoID) {
        const dataTypes = this.config.dataTypes[videoID] || [];
        
        // Load all timeseries files for this video ID
        const timeseriesPromises = dataTypes.map(dataType => 
            this.loadCSV(`assets/timeseries/${videoID}_${dataType}.csv`)
        );
        
        const [timeseriesResults, transcript] = await Promise.all([
            Promise.all(timeseriesPromises),
            this.loadJSON(`assets/transcripts/${videoID}_transcript.json`)
        ]);
        
        // Keep datasets separate instead of merging
        const datasets = [];
        dataTypes.forEach((dataType, index) => {
            if (timeseriesResults[index] && timeseriesResults[index].data) {
                const rawData = timeseriesResults[index].data;
                const cleanedData = this.cleanTimeseriesData(rawData);
                
                console.log(`Dataset ${dataType}:`, {
                    rawRows: rawData.length,
                    cleanedRows: cleanedData.length,
                    columns: Object.keys(cleanedData[0] || {}),
                    timeRange: cleanedData.length > 0 ? [cleanedData[0].Time, cleanedData[cleanedData.length - 1].Time] : []
                });
                
                datasets.push({
                    name: dataType,
                    data: cleanedData
                });
            }
        });
        
        console.log('Loaded datasets:', datasets);
        
        return {
            timeseries: datasets,
            transcript: transcript
        };
    }

    getTranscriptForSegment(transcript, startTime, endTime) {
        if (!transcript || !transcript.segments) return "No transcript available";
        
        const segmentTranscript = [];
        transcript.segments.forEach(segment => {
            const segStart = segment.start;
            const segEnd = segment.end;
            
            // Check if segment overlaps with our time range
            if ((startTime <= segStart && segStart < endTime) || 
                (startTime < segEnd && segEnd <= endTime) || 
                (segStart <= startTime && segEnd >= endTime)) {
                segmentTranscript.push(`[${segment.speaker}]: ${segment.text}`);
            }
        });
        
        return segmentTranscript.length > 0 ? segmentTranscript.join(' ') : "No transcript for this time range";
    }

    createTimeSlider(minTime, maxTime, onChange) {
        const container = document.getElementById('timeSlider');
        container.innerHTML = '';
        
        // Create range slider
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = minTime;
        slider.max = maxTime;
        slider.value = minTime;
        slider.step = 0.1;
        slider.style.width = '100%';
        slider.style.background = THEME.grid;
        
        const valueDisplay = document.createElement('div');
        valueDisplay.style.textAlign = 'center';
        valueDisplay.style.marginTop = '10px';
        valueDisplay.style.color = THEME.muted;
        
        const updateDisplay = () => {
            valueDisplay.textContent = `Time: ${parseFloat(slider.value).toFixed(1)}s / ${maxTime.toFixed(1)}s`;
        };
        
        slider.addEventListener('input', () => {
            updateDisplay();
            if (onChange) onChange(parseFloat(slider.value));
        });
        
        container.appendChild(slider);
        container.appendChild(valueDisplay);
        updateDisplay();
        
        return slider;
    }

    handleTimeClick(time) {
        this.lastClickedPoint = time;
        const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
        
        // Update plot with highlight
        this.plotTimeseries(this.currentData, time);
        
        // Update videos
        this.updateVideos(time, windowSize);
        
        // Update transcript
        this.updateTranscript(time, windowSize);
        
        // The time bus. This was an if/else chain naming every tab, which meant
        // adding a tab required editing this method -- the single biggest
        // obstacle to tabs being separable at all.
        this.emitTimeChange(time, windowSize);
        
        // Update status
        document.getElementById('status').textContent = 
            `Selected time: ${time.toFixed(2)}s (window: ${windowSize}s)`;
    }

    emitTimeChange(time, windowSize) {
        // The visible tab gets first refusal, since it is the one on screen.
        const active = (this.tabs || []).find(t => t.id === this.currentTab);
        if (active && active.onTimeUpdate) {
            try { active.onTimeUpdate(this, time, windowSize); }
            catch (err) { console.error(`Tab '${active.id}' onTimeUpdate failed:`, err); }
        }
        // Anything else that asked to follow the playhead, tab or not.
        (this._timeSubscribers || []).forEach(fn => {
            try { fn(time, windowSize); }
            catch (err) { console.error('A time subscriber failed:', err); }
        });
    }

    onTimeChange(fn) {
        if (typeof fn !== 'function') return () => {};
        this._timeSubscribers = this._timeSubscribers || [];
        this._timeSubscribers.push(fn);
        return () => { this._timeSubscribers = this._timeSubscribers.filter(f => f !== fn); };
    }

    buildVideoSrc() {
        // Some studies film the same session from several angles and want to
        // switch between them. Ortho had this, wired into its own copy of the
        // dashboard; it is a property of video, so it belongs to the host
        // rather than to any one tab.
        //
        // With no videoSrcTemplate configured this is exactly the old
        // behaviour: assets/videos/{videoID}.mp4
        const tmpl = this.config.videoSrcTemplate;
        const fallbackTmpl = this.config.fallbackVideoSrcTemplate || 'assets/videos/{videoID}.mp4';
        const fill = (t, persp) =>
            t.replace('{videoID}', this.currentVideoID).replace('{persp}', persp || '');

        if (tmpl) {
            if (this.currentPerspective) return fill(tmpl, this.currentPerspective);
            // "auto": the first angle that actually exists for this video.
            // Not every session has every angle -- recordings fail.
            const available = (this.config.videoPerspectives || {})[this.currentVideoID];
            if (Array.isArray(available) && available.length) return fill(tmpl, available[0]);
            if (Array.isArray(this.config.perspectives) && this.config.perspectives.length) {
                return fill(tmpl, this.config.perspectives[0]);
            }
        }
        return fill(fallbackTmpl, '');
    }

    updateVideos(clickTime, windowSize) {
        const videoSrc = this.buildVideoSrc();
        const startTime = Math.max(0, clickTime - windowSize / 2);
        const endTime = clickTime + windowSize / 2;

        const fullVideoContainer = document.getElementById('fullVideoContainer');
        if (fullVideoContainer) {
            try {
                ReactDOM.render(
                    React.createElement(window.TimeRangeVideo, {
                        src: videoSrc,
                        title: 'Full Video'
                    }),
                    fullVideoContainer
                );
            } catch (e) {
                fullVideoContainer.innerHTML = `
                    <h3 style="color:white;">Full Video</h3>
                    <video src="${videoSrc}" controls style="width:100%;" preload="metadata"></video>
                `;
            }
        }

        const segmentVideoContainer = document.getElementById('segmentVideoContainer');
        if (segmentVideoContainer) {
            try {
                ReactDOM.render(
                    React.createElement(window.TimeRangeVideo, {
                        src: videoSrc,
                        startTime: startTime,
                        endTime: endTime,
                        title: `Segment (${startTime.toFixed(1)}s – ${endTime.toFixed(1)}s)`
                    }),
                    segmentVideoContainer
                );
            } catch (e) {
                console.error('Error rendering segment video:', e);
            }
        }
    }

    updateTranscript(clickTime, windowSize) {
        const startTime = Math.max(0, clickTime - windowSize / 2);
        const endTime = clickTime + windowSize / 2;
        const transcriptText = this.getTranscriptForSegment(this.currentTranscript, startTime, endTime);
        
        document.getElementById('transcriptDisplay').textContent = transcriptText;
    }

    async loadVideoData(videoID) {
        // A new video invalidates whatever each tab had drawn.
        (this.tabs || []).forEach(t => {
            t._activated = false;
            if (t.onVideoChange) {
                try { t.onVideoChange(this, videoID); }
                catch (err) { console.error(`Tab '${t.id}' onVideoChange failed:`, err); }
            }
        });

        if (!videoID) return;
        
        this.showStatus('Loading data...');
        
        try {
            const data = await this.loadDataForVideoID(videoID);
            this.currentData = data.timeseries;
            this.currentTranscript = data.transcript;
            this.currentVideoID = videoID;
            this.rqaData = null;
            this.crossWaveletData = null;
            this.crqaData = null;
            this.elanData = null;
            this.elanSelectedTiers = null;
            
            if (this.currentData && this.currentData.length > 0) {
                // Create time slider - find min/max across all datasets
                let minTime = Infinity;
                let maxTime = -Infinity;
                
                this.currentData.forEach(dataset => {
                    if (dataset.data && dataset.data.length > 0) {
                        const timeValues = dataset.data.map(d => d.Time).filter(t => t !== undefined);
                        minTime = Math.min(minTime, ...timeValues);
                        maxTime = Math.max(maxTime, ...timeValues);
                    }
                });
                
                if (minTime !== Infinity && maxTime !== -Infinity) {
                    this.timeSlider = this.createTimeSlider(minTime, maxTime, (time) => this.handleTimeClick(time));
                    
                    // Plot initial data
                    this.plotTimeseries(this.currentData);
                    
                    // Initialize videos with full video
                    this.updateVideos(minTime, this.config.defaultWindowSize);
                    
                    // Initialize transcript
                    this.updateTranscript(minTime, this.config.defaultWindowSize);
                    
                    this.showStatus(`Loaded data for ${videoID}. Click on any point to segment video.`);
                    
                    // Redraw whichever tab is on screen for the new video.
                    //
                    // Changing video resets every tab's _activated flag so it
                    // recomputes when next shown -- but the VISIBLE tab never
                    // gets a "next shown", so it kept displaying the previous
                    // video until you switched away and back. This was two
                    // hardcoded branches naming rqa and crosswavelet, which is
                    // also why the other tabs never refreshed at all.
                    if (this.currentTab) this.switchTab(this.currentTab);
                } else {
                    this.showStatus('No valid time data found for this video ID.');
                }
            } else {
                this.showStatus('No valid data found for this video ID.');
            }
        } catch (error) {
            console.error('Error loading video data:', error);
            this.showError('Error loading data. Check console for details.');
        }
    }

    showStatus(message) {
        console.log('Status:', message);
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = 'status';
        } else {
            console.warn('Status element not found');
        }
    }

    showError(message) {
        console.error('Error:', message);
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = 'status error';
        } else {
            console.warn('Status element not found');
            alert(message);
        }
    }

    // =========================================================================
    // MODULE: ELAN Annotations
    // =========================================================================

}

// Tab files load after this one and attach their rendering through
// DIMS.extendHost(), which needs the prototype.
window.DIMS._appProto = DIMSApp.prototype;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing DIMS app...');
    
    // Check dependencies
    console.log('=== DEPENDENCY CHECK ===');
    console.log('React loaded:', !!window.React);
    console.log('ReactDOM loaded:', !!window.ReactDOM);
    console.log('Plotly loaded:', !!window.Plotly);
    console.log('Papa (PapaParse) loaded:', !!window.Papa);
    console.log('TimeRangeVideo component loaded:', !!window.TimeRangeVideo);
    
    // Check if required elements exist
    const requiredElements = ['status', 'videoSelect', 'windowSize', 'plotContainer', 'fullVideoContainer', 'segmentVideoContainer'];
    const missingElements = requiredElements.filter(id => !document.getElementById(id));
    
    if (missingElements.length > 0) {
        console.error('Missing required elements:', missingElements);
        alert(`Missing required HTML elements: ${missingElements.join(', ')}`);
        return;
    }
    
    // Check for missing dependencies
    const missingDeps = [];
    if (!window.React) missingDeps.push('React');
    if (!window.ReactDOM) missingDeps.push('ReactDOM');
    if (!window.Plotly) missingDeps.push('Plotly');
    if (!window.Papa) missingDeps.push('PapaParse');
    if (!window.TimeRangeVideo) missingDeps.push('TimeRangeVideo component');
    
    if (missingDeps.length > 0) {
        console.error('Missing dependencies:', missingDeps);
        alert(`Missing required dependencies: ${missingDeps.join(', ')}\n\nMake sure all scripts are loaded in your HTML.`);
        return;
    }
    
    const app = new DIMSApp();
    window.dimsApp = app; // Make app accessible for debugging
    app.initialize();
});