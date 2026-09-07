// DIMS Dashboard - Main Application Logic with Cross-Wavelet Support

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
        this.elanData = null;
        this.elanSelectedTiers = null;
        this.trajectoryData = null;
        this.dtwData = null;
        this.currentTab = 'timeseries';
        this.currentPerspective = '';
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
            
            // Setup UI
            this.setupHeader();
            this.setupTabs();
            this.setupControls();
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
        const hasRQA = this.config.include_RQA && this.config.include_RQA.length > 0;
        const hasCrossWavelet = this.config.include_crosswavelet && this.config.include_crosswavelet.length >= 2;
        const hasTrajectory = this.config.include_trajectory === true;
        const hasDTW = !!this.config.include_dtw;
        const hasELAN = !!this.config.include_elan;

        // If no optional tabs, hide tab container
        if (!hasRQA && !hasCrossWavelet && !hasTrajectory && !hasDTW && !hasELAN) {
            const tabContainer = document.getElementById('tabContainer');
            if (tabContainer) tabContainer.style.display = 'none';
            return;
        }
        
        // Create tab UI if not exists
        let tabContainer = document.getElementById('tabContainer');
        if (!tabContainer) {
            // Create tab container above plot container
            const plotContainer = document.getElementById('plotContainer');
            tabContainer = document.createElement('div');
            tabContainer.id = 'tabContainer';
            
            let tabHTML = `<div class="tabs" style="margin: 20px 0; border-bottom: 2px solid #444;">
                <button class="tab-button active" data-tab="timeseries" style="
                    padding: 10px 20px;
                    background: #333;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid #007bff;
                ">Time Series</button>`;
            
            if (hasRQA) {
                tabHTML += `<button class="tab-button" data-tab="rqa" style="
                    padding: 10px 20px;
                    background: #222;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                ">RQA Plots</button>`;
            }
            
            if (hasCrossWavelet) {
                tabHTML += `<button class="tab-button" data-tab="crosswavelet" style="
                    padding: 10px 20px;
                    background: #222;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                ">Cross-Wavelet</button>`;
            }

            if (hasTrajectory) {
                tabHTML += `<button class="tab-button" data-tab="trajectory" style="
                    padding: 10px 20px;
                    background: #222;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                ">Trajectory</button>`;
            }

            if (hasDTW) {
                tabHTML += `<button class="tab-button" data-tab="dtw" style="
                    padding: 10px 20px;
                    background: #222;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                ">DTW</button>`;
            }

            if (hasELAN) {
                tabHTML += `<button class="tab-button" data-tab="elan" style="
                    padding: 10px 20px;
                    background: #222;
                    color: white;
                    border: none;
                    margin-right: 5px;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                ">ELAN Annotations</button>`;
            }

            tabHTML += `</div>`;
            tabContainer.innerHTML = tabHTML;
            plotContainer.parentNode.insertBefore(tabContainer, plotContainer);

            // Create RQA container if needed
            if (hasRQA) {
                const rqaContainer = document.createElement('div');
                rqaContainer.id = 'rqaContainer';
                rqaContainer.style.display = 'none';
                rqaContainer.style.minHeight = '800px';
                rqaContainer.style.backgroundColor = '#111';
                rqaContainer.style.padding = '20px';
                plotContainer.parentNode.insertBefore(rqaContainer, plotContainer.nextSibling);
            }
            
            // Create Cross-Wavelet container if needed
            if (hasCrossWavelet) {
                const cwContainer = document.createElement('div');
                cwContainer.id = 'crossWaveletContainer';
                cwContainer.style.display = 'none';
                cwContainer.style.minHeight = '800px';
                cwContainer.style.backgroundColor = '#111';
                cwContainer.style.padding = '20px';
                plotContainer.parentNode.insertBefore(cwContainer, plotContainer.nextSibling);
            }

            // Create Trajectory container if needed
            if (hasTrajectory) {
                const trajContainer = document.createElement('div');
                trajContainer.id = 'trajectoryContainer';
                trajContainer.style.display = 'none';
                trajContainer.style.height = '800px';
                trajContainer.style.backgroundColor = '#111';
                trajContainer.style.padding = '20px';
                plotContainer.parentNode.insertBefore(trajContainer, plotContainer.nextSibling);
            }

            // Create DTW container if needed
            if (hasDTW) {
                const dtwContainer = document.createElement('div');
                dtwContainer.id = 'dtwContainer';
                dtwContainer.style.display = 'none';
                dtwContainer.style.minHeight = '600px';
                dtwContainer.style.backgroundColor = '#111';
                dtwContainer.style.padding = '20px';
                plotContainer.parentNode.insertBefore(dtwContainer, plotContainer.nextSibling);
            }

            // Create ELAN container if needed
            if (hasELAN) {
                const elanContainer = document.createElement('div');
                elanContainer.id = 'elanContainer';
                elanContainer.style.display = 'none';
                elanContainer.style.minHeight = '600px';
                elanContainer.style.backgroundColor = '#111';
                elanContainer.style.padding = '20px';
                plotContainer.parentNode.insertBefore(elanContainer, plotContainer.nextSibling);
            }
        }
        
        // Add tab click handlers
        const tabButtons = tabContainer.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;
                this.switchTab(targetTab);
            });
        });
    }

    switchTab(tabName) {
        this.currentTab = tabName;
        
        // Update button styles
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            if (button.dataset.tab === tabName) {
                button.style.background = '#333';
                button.style.borderBottom = '3px solid #007bff';
                button.classList.add('active');
            } else {
                button.style.background = '#222';
                button.style.borderBottom = '3px solid transparent';
                button.classList.remove('active');
            }
        });
        
        // Hide all containers, then show the selected one
        ['plotContainer', 'rqaContainer', 'crossWaveletContainer', 'trajectoryContainer', 'dtwContainer', 'elanContainer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        if (tabName === 'timeseries') {
            document.getElementById('plotContainer').style.display = 'block';
            if (this.lastClickedPoint !== null) {
                this.handleTimeClick(this.lastClickedPoint);
            }
        } else if (tabName === 'rqa') {
            const rqaContainer = document.getElementById('rqaContainer');
            if (rqaContainer) rqaContainer.style.display = 'block';
            if (this.currentVideoID && !this.rqaData) {
                this.loadRQAData(this.currentVideoID);
            } else if (this.rqaData && this.lastClickedPoint !== null) {
                this.updateRQAHighlights();
            }
        } else if (tabName === 'crosswavelet') {
            const cwContainer = document.getElementById('crossWaveletContainer');
            if (cwContainer) cwContainer.style.display = 'block';
            if (this.currentVideoID && !this.crossWaveletData) {
                this.loadCrossWaveletData(this.currentVideoID);
            } else if (this.crossWaveletData && this.lastClickedPoint !== null) {
                this.updateCrossWaveletHighlights();
            }
        } else if (tabName === 'trajectory') {
            const trajContainer = document.getElementById('trajectoryContainer');
            if (trajContainer) trajContainer.style.display = 'block';
            if (this.currentVideoID && (!this.trajectoryData || this.trajectoryData.videoID !== this.currentVideoID)) {
                this.calculateAndShowTrajectory();
            } else if (this.trajectoryData) {
                this.updateTrajectoryHighlight();
                Plotly.Plots.resize('trajectoryContainer');
            }
        } else if (tabName === 'dtw') {
            const dtwContainer = document.getElementById('dtwContainer');
            if (dtwContainer) dtwContainer.style.display = 'block';
            if (this.currentVideoID && !this.dtwData) {
                this.loadDTWData(this.currentVideoID);
            } else if (this.dtwData && this.lastClickedPoint !== null) {
                this.updateDTWHighlights();
            }
        } else if (tabName === 'elan') {
            const elanContainer = document.getElementById('elanContainer');
            if (elanContainer) elanContainer.style.display = 'block';
            if (this.currentVideoID && !this.elanData) {
                this.loadELANData(this.currentVideoID);
            } else if (this.elanData) {
                this.updateELANHighlight();
            }
        }
    }

    // --- DTW (Dynamic Time Warping) — Beta, enabled via include_dtw ----------
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
    }

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
    }

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
    }

    _dtwShapes(t) {
        if (t === null) return [];
        return [
            { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x',  yref: 'y domain',  line: { color: 'yellow', width: 1.5 } },
            { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x2', yref: 'y2 domain', line: { color: 'yellow', width: 1.5 } },
            { type: 'line', x0: t, x1: t, y0: 0, y1: 1, xref: 'x3', yref: 'y3 domain', line: { color: 'yellow', width: 1.5 } },
        ];
    }

    updateDTWHighlights() {
        if (!this.dtwData?.dtw_data) return;
        const shapes = this._dtwShapes(this.lastClickedPoint);
        Object.keys(this.dtwData.dtw_data).forEach((_, i) => {
            const el = document.getElementById(`dtw-plot-${i}`);
            if (el) Plotly.relayout(`dtw-plot-${i}`, { shapes });
        });
    }

    // Show the ball trajectory. If the current video has a per-level entry in
    // config.trajectory_tracks, plot the real ball x/y (game coordinates) over
    // that level's calibrated path image. Otherwise fall back to reconstructing
    // the path by integrating velocity (vx, vy) over the global field image.
    async calculateAndShowTrajectory() {
        const track = this.config.trajectory_tracks?.[this.currentVideoID];
        if (track) {
            const [xRes, yRes] = await Promise.all([
                this.loadCSV(`assets/timeseries/${this.currentVideoID}_x.csv`),
                this.loadCSV(`assets/timeseries/${this.currentVideoID}_y.csv`)
            ]);
            if (!xRes || !yRes || !xRes.data || !yRes.data) {
                this.showError('Trajectory Error: missing x/y position data.');
                return;
            }
            const xs = [...xRes.data].sort((a, b) => a.Time - b.Time);
            const ys = [...yRes.data].sort((a, b) => a.Time - b.Time);
            const n = Math.min(xs.length, ys.length);
            const xArr = [], yArr = [], tArr = [];
            for (let i = 0; i < n; i++) {
                xArr.push(xs[i].x); yArr.push(ys[i].y); tArr.push(xs[i].Time);
            }
            this.trajectoryData = {
                videoID: this.currentVideoID, x: xArr, y: yArr, time: tArr, track
            };
            this.renderTrajectoryPlot();
            return;
        }

        if (!this.currentData) return;

        // Velocity series (CSV column headers must be exactly 'vx' and 'vy')
        const vxSeries = this.currentData.find(d => d.name === 'vx');
        const vySeries = this.currentData.find(d => d.name === 'vy');

        if (!vxSeries || !vySeries) {
            this.showError('Trajectory Error: Missing "vx" or "vy" data columns.');
            return;
        }

        const getSorted = (series) => [...series.data].sort((a, b) => a.Time - b.Time);
        const vxData = getSorted(vxSeries);
        const vyData = getSorted(vySeries);

        const xArr = [];
        const yArr = [];
        const tArr = [];

        let currX = this.config.trajectory_settings?.startX || 0;
        let currY = this.config.trajectory_settings?.startY || 0;

        const len = Math.min(vxData.length, vyData.length);
        for (let i = 0; i < len; i++) {
            const t = vxData[i].Time;
            const vx = vxData[i].vx;
            const vy = vyData[i].vy;

            if (i > 0) {
                const dt = t - tArr[i - 1];
                currX += vx * dt; // Euler integration
                currY += vy * dt;
            }

            xArr.push(currX);
            yArr.push(currY);
            tArr.push(t);
        }

        this.trajectoryData = { videoID: this.currentVideoID, x: xArr, y: yArr, time: tArr };
        this.renderTrajectoryPlot();
    }

    renderTrajectoryPlot() {
        const containerId = 'trajectoryContainer';
        // Per-level path image. trajectory_tracks[videoID].image names a path PNG;
        // its game-coord calibration {x0,y0,x1,y1} is looked up in config.path_images.
        // Blank image -> plot the ball path alone (autoranged, no background) until
        // the user picks one. No track entry -> legacy global trajectory_settings.
        const track = this.trajectoryData.track;
        const cal = track && track.image ? this.config.path_images?.[track.image] : null;
        let bgImage = '', xRange, yRange, imgX, imgY, imgW, imgH;
        if (cal) {
            bgImage = `assets/images/${track.image}`;
            xRange = [cal.x0, cal.x1];
            yRange = [cal.y0, cal.y1];
            imgX = cal.x0; imgY = cal.y1;                      // top-left anchor
            imgW = cal.x1 - cal.x0; imgH = cal.y1 - cal.y0;
        } else if (track) {
            xRange = undefined; yRange = undefined;            // autorange, no image
        } else {
            bgImage = this.config.trajectory_settings?.imagePath || '';
            const fieldW = this.config.trajectory_settings?.fieldWidth || 100;
            const fieldH = this.config.trajectory_settings?.fieldHeight || 100;
            xRange = [0, fieldW]; yRange = [0, fieldH];
            imgX = 0; imgY = fieldH; imgW = fieldW; imgH = fieldH;
        }

        const traceFull = {
            x: this.trajectoryData.x,
            y: this.trajectoryData.y,
            mode: 'lines',
            type: 'scatter',
            name: 'Full Path',
            line: { color: 'rgba(0, 255, 255, 0.3)', width: 1 },
            hoverinfo: 'none'
        };

        // Active window highlight, populated by updateTrajectoryHighlight
        const traceWindow = {
            x: [], y: [],
            mode: 'lines',
            type: 'scatter',
            name: 'Active Window',
            line: { color: 'red', width: 4 },
            hoverinfo: 'none'
        };

        const traceMarker = {
            x: [this.trajectoryData.x[0]],
            y: [this.trajectoryData.y[0]],
            mode: 'markers',
            type: 'scatter',
            name: 'Current Pos',
            marker: { size: 12, color: 'yellow', line: { color: 'black', width: 2 } },
            hovertemplate: 'X: %{x:.2f}<br>Y: %{y:.2f}<extra></extra>'
        };

        const layout = {
            title: { text: 'Trajectory', font: { color: 'white' } },
            paper_bgcolor: '#111',
            plot_bgcolor: '#222',
            font: { color: 'white' },
            showlegend: true,
            legend: { x: 0, y: 1, font: { size: 10 } },
            xaxis: { range: xRange, showgrid: false, zeroline: false, visible: false },
            yaxis: {
                range: yRange, showgrid: false, zeroline: false, visible: false,
                scaleanchor: 'x', scaleratio: 1 // 1:1 aspect ratio
            },
            images: bgImage ? [{
                source: bgImage,
                xref: 'x', yref: 'y',
                x: imgX, y: imgY,
                sizex: imgW, sizey: imgH,
                sizing: 'stretch', opacity: 0.6, layer: 'below'
            }] : [],
            margin: { t: 40, l: 10, r: 10, b: 10 },
            hovermode: 'closest',
            dragmode: 'pan'
        };

        Plotly.newPlot(containerId, [traceFull, traceWindow, traceMarker], layout, { responsive: true });

        // Click on the path -> seek to the nearest time
        document.getElementById(containerId).on('plotly_click', (data) => {
            if (data.points && data.points.length > 0) {
                const pt = data.points[0];
                let closestIdx = 0;
                let minDist = Infinity;
                const dataX = this.trajectoryData.x;
                const dataY = this.trajectoryData.y;
                for (let i = 0; i < dataX.length; i++) {
                    const dx = dataX[i] - pt.x;
                    const dy = dataY[i] - pt.y;
                    const dist = dx * dx + dy * dy;
                    if (dist < minDist) { minDist = dist; closestIdx = i; }
                }
                this.handleTimeClick(this.trajectoryData.time[closestIdx]);
            }
        });

        if (this.lastClickedPoint !== null) {
            this.updateTrajectoryHighlight();
        }
    }

    updateTrajectoryHighlight() {
        if (this.currentTab !== 'trajectory') return;
        if (!this.trajectoryData) return;

        const currentTime = this.lastClickedPoint !== null ? this.lastClickedPoint : 0;
        const windowSize = parseFloat(document.getElementById('windowSize').value) || 5;
        const halfWin = windowSize / 2;
        const startTime = currentTime - halfWin;
        const endTime = currentTime + halfWin;

        const xWin = [];
        const yWin = [];
        let markerX = this.trajectoryData.x[0];
        let markerY = this.trajectoryData.y[0];
        let minTimeDiff = Infinity;

        for (let i = 0; i < this.trajectoryData.time.length; i++) {
            const t = this.trajectoryData.time[i];
            if (t >= startTime && t <= endTime) {
                xWin.push(this.trajectoryData.x[i]);
                yWin.push(this.trajectoryData.y[i]);
            }
            const diff = Math.abs(t - currentTime);
            if (diff < minTimeDiff) {
                minTimeDiff = diff;
                markerX = this.trajectoryData.x[i];
                markerY = this.trajectoryData.y[i];
            }
        }

        // Trace 1 = window, Trace 2 = marker
        Plotly.restyle('trajectoryContainer', {
            x: [xWin, [markerX]],
            y: [yWin, [markerY]]
        }, [1, 2]);
    }

    async loadCrossWaveletData(videoID) {
        this.showStatus('Loading cross-wavelet data...');
        
        try {
            const dataPath = `assets/crosswavelet/${videoID}_crosswavelet_data.json`;
            console.log('Loading cross-wavelet data from:', dataPath);
            
            const cwData = await this.loadJSON(dataPath);
            
            if (!cwData) {
                this.showError('Cross-wavelet data not found. Run the Python cross-wavelet script first.');
                return;
            }
            
            console.log('Cross-wavelet data loaded:', cwData);
            
            // Validate data structure
            if (!cwData.crosswavelet_pairs || Object.keys(cwData.crosswavelet_pairs).length === 0) {
                this.showError('Cross-wavelet data is empty or invalid format.');
                console.error('Invalid cross-wavelet data structure:', cwData);
                return;
            }
            
            this.crossWaveletData = cwData;
            this.displayCrossWaveletPlots();
            
        } catch (error) {
            console.error('Error loading cross-wavelet data:', error);
            this.showError(`Failed to load cross-wavelet data: ${error.message}`);
        }
    }

    displayCrossWaveletPlots() {
        const container = document.getElementById('crossWaveletContainer');
        if (!container) {
            console.error('Cross-wavelet container element not found!');
            return;
        }
        
        if (!this.crossWaveletData) {
            console.error('No cross-wavelet data to display');
            return;
        }
        
        console.log('Displaying cross-wavelet plots for:', this.crossWaveletData);
        
        container.innerHTML = '<h2 style="color: white; margin-bottom: 20px;">Cross-Wavelet Coherence Analysis</h2>';
        
        // Create grid for cross-wavelet plots
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(600px, 1fr))';
        grid.style.gap = '20px';
        
        // Create all plot containers first
        const plotConfigs = [];
        Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
            console.log(`Creating cross-wavelet plot container ${index} for ${pairKey}`);
            
            const plotDiv = document.createElement('div');
            plotDiv.id = `cw-plot-${index}`;
            plotDiv.style.height = '800px'; // Increased for 4-panel layout
            plotDiv.style.backgroundColor = '#222';
            plotDiv.style.padding = '10px';
            plotDiv.style.borderRadius = '5px';
            
            grid.appendChild(plotDiv);
            
            // Store config for later plotting
            plotConfigs.push({
                containerId: plotDiv.id,
                pairKey: pairKey,
                pairData: pairData
            });
        });
        
        // Add grid to container
        container.appendChild(grid);
        
        // Now create all plots after DOM is updated
        setTimeout(() => {
            plotConfigs.forEach(config => {
                try {
                    console.log(`Creating cross-wavelet plot for ${config.pairKey} in ${config.containerId}`);
                    this.createCrossWaveletPlot(config.containerId, config.pairKey, config.pairData);
                } catch (error) {
                    console.error(`Error creating cross-wavelet plot for ${config.pairKey}:`, error);
                    const plotDiv = document.getElementById(config.containerId);
                    if (plotDiv) {
                        plotDiv.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                    }
                }
            });
            
            this.showStatus('Cross-wavelet plots loaded. Click on any plot to select a time point.');
        }, 100);
    }

    createCrossWaveletPlot(containerId, pairKey, pairData) {
        // Check if Plotly is loaded
        if (!window.Plotly) {
            throw new Error('Plotly library not loaded. Make sure to include Plotly in your HTML.');
        }
        
        // Verify container exists
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container ${containerId} not found in DOM`);
        }
        
        // Validate plot data
        if (!pairData.visualization) {
            throw new Error('Missing visualization data');
        }
        
        const vis = pairData.visualization;
        const stats = pairData.statistics;
        
        // Validate required fields
        if (!vis.time || !vis.power || !vis.period) {
            throw new Error('Missing required visualization fields (need power for cross-wavelet)');
        }
        
        console.log(`Creating cross-wavelet plot for ${pairKey}`);
        
        // Extract data type names
        const dataType1 = pairData.data_type1;
        const dataType2 = pairData.data_type2;
        
        // Get colors for the two data types
        let color1 = 'rgb(31, 119, 180)';
        let color2 = 'rgb(255, 127, 14)';
        if (this.currentData) {
            const idx1 = this.currentData.findIndex(d => d.name === dataType1);
            const idx2 = this.currentData.findIndex(d => d.name === dataType2);
            if (idx1 !== -1) color1 = `hsl(${idx1 * 360 / this.currentData.length}, 70%, 50%)`;
            if (idx2 !== -1) color2 = `hsl(${idx2 * 360 / this.currentData.length}, 70%, 50%)`;
        }
        
        // Get the actual time series data for the two data types
        let timeSeries1 = null;
        let timeSeries2 = null;
        if (this.currentData) {
            const data1 = this.currentData.find(d => d.name === dataType1);
            const data2 = this.currentData.find(d => d.name === dataType2);
            if (data1 && data1.data) timeSeries1 = data1.data;
            if (data2 && data2.data) timeSeries2 = data2.data;
        }
        
        // Create traces array
        const traces = [];
        
        // ========== PANEL A: Original time series (top) ==========
        if (timeSeries1) {
            const sortedData1 = [...timeSeries1].sort((a, b) => a.Time - b.Time);
            const columns1 = Object.keys(sortedData1[0]).filter(col => col !== 'Time');
            
            let yData1;
            if (columns1.length > 1) {
                yData1 = sortedData1.map(row => {
                    const values = columns1.map(col => row[col]).filter(v => v !== null && v !== undefined);
                    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                });
            } else if (columns1.length === 1) {
                yData1 = sortedData1.map(d => d[columns1[0]]);
            }
            
            if (yData1) {
                // Normalize for display
                const mean1 = yData1.reduce((a, b) => a + b, 0) / yData1.length;
                const std1 = Math.sqrt(yData1.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / yData1.length);
                const normalized1 = yData1.map(v => (v - mean1) / std1);
                
                traces.push({
                    x: sortedData1.map(d => d.Time),
                    y: normalized1,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: color1, width: 1.5 },
                    name: dataType1,
                    xaxis: 'x4',
                    yaxis: 'y4',
                    hovertemplate: `${dataType1}<br>Time: %{x:.1f}s<br>Normalized: %{y:.3f}<extra></extra>`
                });
            }
        }
        
        if (timeSeries2) {
            const sortedData2 = [...timeSeries2].sort((a, b) => a.Time - b.Time);
            const columns2 = Object.keys(sortedData2[0]).filter(col => col !== 'Time');
            
            let yData2;
            if (columns2.length > 1) {
                yData2 = sortedData2.map(row => {
                    const values = columns2.map(col => row[col]).filter(v => v !== null && v !== undefined);
                    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                });
            } else if (columns2.length === 1) {
                yData2 = sortedData2.map(d => d[columns2[0]]);
            }
            
            if (yData2) {
                // Normalize for display
                const mean2 = yData2.reduce((a, b) => a + b, 0) / yData2.length;
                const std2 = Math.sqrt(yData2.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / yData2.length);
                const normalized2 = yData2.map(v => (v - mean2) / std2);
                
                traces.push({
                    x: sortedData2.map(d => d.Time),
                    y: normalized2,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: color2, width: 1.5 },
                    name: dataType2,
                    xaxis: 'x4',
                    yaxis: 'y4',
                    hovertemplate: `${dataType2}<br>Time: %{x:.1f}s<br>Normalized: %{y:.3f}<extra></extra>`
                });
            }
        }
        
        // Calculate log2 of periods for proper display
        const log2Period = vis.period.map(p => Math.log2(p));
        
        // ========== PANEL B: Cross-wavelet power spectrum (middle-left) ==========
        traces.push({
            x: vis.time,
            y: log2Period,
            z: vis.power,
            type: 'heatmap',
            colorscale: 'Viridis',
            colorbar: {
                title: 'Power',
                titleside: 'right',
                x: 0.72,
                y: 0.55,
                yanchor: 'middle',
                len: 0.34,
                lenmode: 'fraction'
            },
            xaxis: 'x',
            yaxis: 'y',
            hovertemplate: 'Time: %{x:.1f}s<br>Period: %{customdata:.2f}s<br>Power: %{z:.4f}<extra></extra>',
            customdata: vis.period
        });
        
        // Add significance contour (95% confidence level)
        if (vis.sig95_xwt && vis.sig95_xwt.length > 0) {
            traces.push({
                x: vis.time,
                y: log2Period,
                z: vis.sig95_xwt,
                type: 'contour',
                contours: {
                    start: 0.95,
                    end: 1.5,
                    size: 0.5,
                    coloring: 'none'
                },
                line: { color: 'black', width: 2 },
                showscale: false,
                xaxis: 'x',
                yaxis: 'y',
                name: '95% Confidence',
                hoverinfo: 'skip'
            });
        }

        // ========== ADD PHASE ARROWS ==========
        // Subsample the phase data for clearer visualization
        const arrowSkipTime = Math.max(1, Math.floor(vis.time.length / 20)); // ~20 arrows in time
        const arrowSkipFreq = Math.max(1, Math.floor(log2Period.length / 12)); // ~12 arrows in frequency

        // Build arrays for arrow plot
        const arrowData = {
            x: [],
            y: [],
            text: [],
            mode: 'markers+text',
            type: 'scatter',
            marker: {
                size: 0.1,
                color: 'rgba(0,0,0,0)'
            },
            text: [],
            textfont: {
                family: 'Arial',
                size: 16,
                color: 'white'
            },
            textposition: 'middle center',
            xaxis: 'x',
            yaxis: 'y',
            hovertemplate: '%{customdata}<extra></extra>',
            customdata: [],
            showlegend: false
        };

        // Only show arrows within the 95% confidence ridges
        for (let i = 0; i < vis.phase.length; i += arrowSkipFreq) {
            for (let j = 0; j < vis.phase[i].length; j += arrowSkipTime) {
                // Check if this point is within 95% significance ridge
                const isSignificant = vis.sig95_xwt && vis.sig95_xwt[i] && vis.sig95_xwt[i][j] > 1.0;
                
                if (isSignificant) { // Only show arrows within 95% confidence ridges
                    const coherence = vis.coherence ? vis.coherence[i][j] : 0;
                    const phase = vis.phase[i][j];
                    
                    // Convert phase to arrow symbol
                    // Phase is in radians: 0 = in phase, π/2 = signal1 leads, π = anti-phase, -π/2 = signal2 leads
                    let arrow;
                    const phaseDeg = (phase * 180 / Math.PI + 360) % 360;
                    
                    // Map phase to arrow direction (8 directions)
                    if (phaseDeg >= 337.5 || phaseDeg < 22.5) {
                        arrow = '→';  // In phase
                    } else if (phaseDeg >= 22.5 && phaseDeg < 67.5) {
                        arrow = '↗';  // Signal 1 leads slightly
                    } else if (phaseDeg >= 67.5 && phaseDeg < 112.5) {
                        arrow = '↑';  // Signal 1 leads by 90°
                    } else if (phaseDeg >= 112.5 && phaseDeg < 157.5) {
                        arrow = '↖';  // Signal 1 leads, approaching anti-phase
                    } else if (phaseDeg >= 157.5 && phaseDeg < 202.5) {
                        arrow = '←';  // Anti-phase
                    } else if (phaseDeg >= 202.5 && phaseDeg < 247.5) {
                        arrow = '↙';  // Signal 2 leads, approaching anti-phase
                    } else if (phaseDeg >= 247.5 && phaseDeg < 292.5) {
                        arrow = '↓';  // Signal 2 leads by 90°
                    } else {
                        arrow = '↘';  // Signal 2 leads slightly
                    }
                    
                    // Interpret phase relationship
                    let relationship;
                    if (phaseDeg < 45 || phaseDeg >= 315) {
                        relationship = `${dataType1} & ${dataType2} in phase`;
                    } else if (phaseDeg >= 45 && phaseDeg < 135) {
                        relationship = `${dataType1} leads ${dataType2}`;
                    } else if (phaseDeg >= 135 && phaseDeg < 225) {
                        relationship = `${dataType1} & ${dataType2} anti-phase`;
                    } else {
                        relationship = `${dataType2} leads ${dataType1}`;
                    }
                    
                    arrowData.x.push(vis.time[j]);
                    arrowData.y.push(log2Period[i]);
                    arrowData.text.push(arrow);
                    arrowData.customdata.push(
                        `Time: ${vis.time[j].toFixed(1)}s | ` +
                        `Period: ${vis.period[i].toFixed(2)}s<br>` +
                        `Phase: ${phaseDeg.toFixed(0)}°<br>` +
                        `Power: ${vis.power[i][j].toFixed(4)}<br>`
                    );
                }
            }
        }

// Add arrow trace if we have any arrows
if (arrowData.x.length > 0) {
    traces.push(arrowData);
}
        
        // Add Cone of Influence (COI) as filled area
        if (vis.coi && vis.coi.length > 0) {
            const coiLog2 = vis.coi.map(c => Math.log2(Math.max(c, vis.period[0])));
            const maxLog2Period = Math.max(...log2Period);
            
            // Create COI boundary
            const coiX = [...vis.time, vis.time[vis.time.length - 1], vis.time[0]];
            const coiY = [...coiLog2, maxLog2Period, maxLog2Period];
            
            traces.push({
                x: coiX,
                y: coiY,
                type: 'scatter',
                mode: 'none',
                fill: 'toself',
                fillcolor: 'rgba(0, 0, 0, 0.3)',
                line: { width: 0 },
                xaxis: 'x',
                yaxis: 'y',
                name: 'COI',
                hoverinfo: 'skip',
                showlegend: false
            });
            
            // Add COI boundary line
            traces.push({
                x: vis.time,
                y: coiLog2,
                type: 'scatter',
                mode: 'lines',
                line: { color: 'white', width: 2, dash: 'dash' },
                xaxis: 'x',
                yaxis: 'y',
                name: 'COI',
                hovertemplate: 'Time: %{x:.1f}s<br>COI Period: %{customdata:.2f}s<extra></extra>',
                customdata: vis.coi,
                showlegend: false
            });
        }
        
        // ========== PANEL C: Global cross-wavelet spectrum (middle-right) ==========
        if (stats.global_power && stats.global_power.length > 0) {
            traces.push({
                x: stats.global_power,
                y: log2Period,
                type: 'scatter',
                mode: 'lines',
                line: { color: 'white', width: 2 },
                name: 'Global XWT Power',
                xaxis: 'x2',
                yaxis: 'y2',
                hovertemplate: 'Power: %{x:.4f}<br>Period: %{customdata:.2f}s<extra></extra> ',
                customdata: vis.period,
                showlegend: false
            });
        }
        
        // ========== PANEL D: Scale-averaged cross-wavelet power (bottom) ==========
        if (vis.scale_avg_power && vis.scale_avg_power.length > 0) {
            traces.push({
                x: vis.time,
                y: vis.scale_avg_power,
                type: 'scatter',
                mode: 'lines',
                line: { color: 'white', width: 2 },
                name: 'Scale-Avg XWT Power',
                xaxis: 'x3',
                yaxis: 'y3',
                hovertemplate: 'Time: %{x:.1f}s<br>Power: %{y:.4f}<extra></extra>',
                showlegend: false
            });
        }
        
        // Create period tick labels (powers of 2)
        const minPeriod = Math.min(...vis.period);
        const maxPeriod = Math.max(...vis.period);
        const minLog2 = Math.ceil(Math.log2(minPeriod));
        const maxLog2 = Math.floor(Math.log2(maxPeriod));
        const periodTicks = [];
        const periodTickLabels = [];
        for (let i = minLog2; i <= maxLog2; i++) {
            periodTicks.push(i);
            const periodVal = Math.pow(2, i);
            periodTickLabels.push(periodVal < 1 ? periodVal.toFixed(1) : periodVal.toFixed(0));
        }
        
        // Create layout with 4 subplots similar to pycwt
        const layout = {
        title: {
            text: `Cross-Wavelet: ${dataType1} ↔ ${dataType2}<br>` +
                `<sub>Mean Coherence: ${stats.mean_coherence.toFixed(3)}, Max: ${stats.max_coherence.toFixed(3)}, ` +
                `AR1: α₁=${pairData.alpha1.toFixed(3)}, α₂=${pairData.alpha2.toFixed(3)}</sub><br>` +
                `<sub style="font-size: 9px;">Phase arrows (in 95% ridges): ` +
                `→ in-phase (0°) | ↗ ${dataType1} leads 45° | ↑ ${dataType1} leads 90° | ↖ ${dataType1} leads 135° | ` +
                `← anti-phase (180°) | ↙ ${dataType2} leads 135° | ↓ ${dataType2} leads 90° | ↘ ${dataType2} leads 45°</sub>`,
            font: { color: 'white', size: 14 }
        },
            paper_bgcolor: '#222',
            plot_bgcolor: '#333',
            font: { color: 'white', size: 10 },
            showlegend: true,
            legend: {
                x: 0.75,
                y: 0.95,
                bgcolor: 'rgba(0,0,0,0.5)',
                font: { size: 9 }
            },
            
            // PANEL A: Time series (top)
            xaxis4: {
                domain: [0.08, 0.70],
                anchor: 'y4',
                title: '',
                showticklabels: false,
                gridcolor: '#444'
            },
            yaxis4: {
                domain: [0.78, 0.95],
                anchor: 'x4',
                title: 'Normalized',
                titlefont: { size: 10 },
                gridcolor: '#444'
            },
            
            // PANEL B: Cross-wavelet power spectrum (middle-left)
            xaxis: {
                domain: [0.08, 0.70],
                anchor: 'y',
                title: '',
                showticklabels: false,
                gridcolor: '#444'
            },
            yaxis: {
                domain: [0.38, 0.72],
                anchor: 'x',
                title: 'Period (s)',
                tickmode: 'array',
                tickvals: periodTicks,
                ticktext: periodTickLabels,
                gridcolor: '#444'
            },
            
            // PANEL C: Global spectrum (middle-right)
            xaxis2: {
                domain: [0.75, 0.95],
                anchor: 'y2',
                title: 'Power',
                titlefont: { size: 10 },
                gridcolor: '#444'
            },
            yaxis2: {
                domain: [0.38, 0.72],
                anchor: 'x2',
                title: '',
                showticklabels: false,
                tickmode: 'array',
                tickvals: periodTicks,
                ticktext: periodTickLabels,
                gridcolor: '#444'
            },
            
            // PANEL D: Scale-averaged power (bottom)
            xaxis3: {
                domain: [0.08, 0.70],
                anchor: 'y3',
                title: 'Time (s)',
                gridcolor: '#444'
            },
            yaxis3: {
                domain: [0.05, 0.30],
                anchor: 'x3',
                title: {
                    text: `${pairData.scale_avg_band ? pairData.scale_avg_band[0].toFixed(1) + '–' + pairData.scale_avg_band[1].toFixed(1) : '2–8'}s avg`,
                    font: { size: 10 }
                },
                gridcolor: '#444'
            },
            
            margin: { t: 70, r: 30, b: 50, l: 60 },
            hovermode: 'closest'
        };
        
        // Add highlight shapes if there's a selected time
        if (this.lastClickedPoint !== null) {
            const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
            const minTime = Math.min(...vis.time);
            const maxTime = Math.max(...vis.time);
            const minLog2Period = Math.min(...log2Period);
            const maxLog2Period = Math.max(...log2Period);
            
            const startTime = Math.max(minTime, this.lastClickedPoint - windowSize / 2);
            const endTime = Math.min(maxTime, this.lastClickedPoint + windowSize / 2);
            
            layout.shapes = [
                // Vertical lines on time series (panel A)
                {
                    type: 'line',
                    x0: startTime, x1: startTime,
                    y0: 0, y1: 1,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x4', yref: 'y4 domain'
                },
                {
                    type: 'line',
                    x0: endTime, x1: endTime,
                    y0: 0, y1: 1,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x4', yref: 'y4 domain'
                },
                // Highlight box on time series
                {
                    type: 'rect',
                    x0: startTime, x1: endTime,
                    y0: 0, y1: 1,
                    fillcolor: 'yellow',
                    opacity: 0.15,
                    line: { width: 0 },
                    xref: 'x4', yref: 'y4 domain'
                },
                // Vertical lines on XWT spectrum (panel B)
                {
                    type: 'line',
                    x0: startTime, x1: startTime,
                    y0: minLog2Period, y1: maxLog2Period,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                {
                    type: 'line',
                    x0: endTime, x1: endTime,
                    y0: minLog2Period, y1: maxLog2Period,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                // Highlight box on XWT spectrum
                {
                    type: 'rect',
                    x0: startTime, x1: endTime,
                    y0: minLog2Period, y1: maxLog2Period,
                    fillcolor: 'yellow',
                    opacity: 0.15,
                    line: { width: 0 },
                    xref: 'x', yref: 'y'
                },
                // Vertical lines on scale-averaged plot (panel D)
                {
                    type: 'line',
                    x0: startTime, x1: startTime,
                    y0: 0, y1: 1,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x3', yref: 'y3 domain'
                },
                {
                    type: 'line',
                    x0: endTime, x1: endTime,
                    y0: 0, y1: 1,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x3', yref: 'y3 domain'
                },
                // Highlight box on scale-averaged plot
                {
                    type: 'rect',
                    x0: startTime, x1: endTime,
                    y0: 0, y1: 1,
                    fillcolor: 'yellow',
                    opacity: 0.15,
                    line: { width: 0 },
                    xref: 'x3', yref: 'y3 domain'
                }
            ];
        }
        
        console.log(`Calling Plotly.newPlot for ${containerId}`);
        Plotly.newPlot(containerId, traces, layout, { responsive: true });
        
        // Add click handler
        document.getElementById(containerId).on('plotly_click', (data) => {
            if (data.points && data.points.length > 0) {
                const point = data.points[0];
                
                // Get clicked time (works for all three time-based panels)
                const clickedTime = point.x;
                console.log(`Cross-wavelet clicked at time: ${clickedTime.toFixed(2)}s`);
                
                // Update video and timeseries
                this.handleTimeClick(clickedTime);
                
                // Update all cross-wavelet plots to show highlight
                setTimeout(() => this.updateCrossWaveletHighlights(), 100);
            }
        });
    }

    updateCrossWaveletHighlights() {
        // Re-render all cross-wavelet plots with updated highlights
        if (this.crossWaveletData && this.crossWaveletData.crosswavelet_pairs) {
            Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
                const containerId = `cw-plot-${index}`;
                if (document.getElementById(containerId)) {
                    this.createCrossWaveletPlot(containerId, pairKey, pairData);
                }
            });
        }
    }

    async loadRQAData(videoID) {
        this.showStatus('Loading RQA data...');
        
        try {
            // Load RQA data
            const dataPath = `assets/rqa/${videoID}_rqa_data.json`;
            console.log('Loading RQA data from:', dataPath);
            
            const rqaData = await this.loadJSON(dataPath);
            
            if (!rqaData) {
                this.showError('RQA data not found. Run the Python RQA script first.');
                return;
            }
            
            console.log('RQA data loaded:', rqaData);
            
            // Validate data structure
            if (!rqaData.rqa_data || Object.keys(rqaData.rqa_data).length === 0) {
                this.showError('RQA data is empty or invalid format.');
                console.error('Invalid RQA data structure:', rqaData);
                return;
            }
            
            // Check if data types match config
            const configDataTypes = this.config.include_RQA || [];
            const rqaDataTypes = Object.keys(rqaData.rqa_data);
            console.log('Config data types:', configDataTypes);
            console.log('RQA data types:', rqaDataTypes);
            
            // Warn about mismatches
            const missingInRQA = configDataTypes.filter(dt => !rqaDataTypes.includes(dt));
            if (missingInRQA.length > 0) {
                console.warn('Data types in config but not in RQA data:', missingInRQA);
            }
            
            this.rqaData = rqaData;
            this.displayRQAPlots();
            
        } catch (error) {
            console.error('Error loading RQA data:', error);
            this.showError(`Failed to load RQA data: ${error.message}`);
        }
    }

    displayRQAPlots() {
        const container = document.getElementById('rqaContainer');
        if (!container) {
            console.error('RQA container element not found!');
            return;
        }
        
        if (!this.rqaData) {
            console.error('No RQA data to display');
            return;
        }
        
        console.log('Displaying RQA plots for:', this.rqaData);
        
        container.innerHTML = '<h2 style="color: white; margin-bottom: 20px;">Recurrence Quantification Analysis</h2>';
        
        // Create grid for RQA plots
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        grid.style.gap = '20px';
        
        // Create all plot containers first
        const plotConfigs = [];
        Object.entries(this.rqaData.rqa_data).forEach(([dataType, plotData], index) => {
            console.log(`Creating RQA plot container ${index} for ${dataType}`);
            
            const plotDiv = document.createElement('div');
            plotDiv.id = `rqa-plot-${index}`;
            plotDiv.style.height = '500px';
            plotDiv.style.backgroundColor = '#222';
            plotDiv.style.padding = '10px';
            plotDiv.style.borderRadius = '5px';
            
            grid.appendChild(plotDiv);
            
            // Store config for later plotting
            plotConfigs.push({
                containerId: plotDiv.id,
                dataType: dataType,
                plotData: plotData
            });
        });
        
        // Add grid to container
        container.appendChild(grid);
        
        // Now create all plots after DOM is updated
        setTimeout(() => {
            plotConfigs.forEach(config => {
                try {
                    console.log(`Creating RQA plot for ${config.dataType} in ${config.containerId}`);
                    this.createRQAPlot(config.containerId, config.dataType, config.plotData);
                } catch (error) {
                    console.error(`Error creating RQA plot for ${config.dataType}:`, error);
                    const plotDiv = document.getElementById(config.containerId);
                    if (plotDiv) {
                        plotDiv.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                    }
                }
            });
            
            this.showStatus('RQA plots loaded. Click on any plot to select a time point.');
        }, 100); // Give DOM time to update
    }

    createRQAPlot(containerId, dataType, plotData) {
        // Check if Plotly is loaded
        if (!window.Plotly) {
            throw new Error('Plotly library not loaded. Make sure to include Plotly in your HTML.');
        }
        
        // Verify container exists
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container ${containerId} not found in DOM`);
        }
        
        // Validate plot data
        if (!plotData.visualization) {
            throw new Error('Missing visualization data');
        }
        
        const vis = plotData.visualization;
        
        // Validate required fields
        if (!vis.time || !vis.data || !vis.matrix_size || !vis.sparse_matrix) {
            throw new Error('Missing required visualization fields');
        }
        
        console.log(`Creating RQA plot for ${dataType} with matrix size ${vis.matrix_size}`);
        
        // Find the color for this dataType from the main timeseries
        let dataColor = 'blue'; // default
        if (this.currentData) {
            const dataIndex = this.currentData.findIndex(dataset => dataset.name === dataType);
            if (dataIndex !== -1) {
                // Use the same HSL color calculation as in plotTimeseries
                dataColor = `hsl(${dataIndex * 360 / this.currentData.length}, 70%, 50%)`;
            }
        }
        
        // Sort time and data arrays together to prevent wrapping
        const timeDataPairs = vis.time.map((t, i) => ({ time: t, data: vis.data[i] }));
        timeDataPairs.sort((a, b) => a.time - b.time);
        const sortedTime = timeDataPairs.map(pair => pair.time);
        const sortedData = timeDataPairs.map(pair => pair.data);
        
        // Convert sparse matrix to dense for heatmap
        const matrix = new Array(vis.matrix_size).fill(null).map(() => 
            new Array(vis.matrix_size).fill(0)
        );
        
        // Fill in the recurrence points
        vis.sparse_matrix.forEach(([row, col]) => {
            if (row < vis.matrix_size && col < vis.matrix_size) {
                matrix[row][col] = 1;
            }
        });

        // Categorical (gaze) RQA: no line plots — just the recurrence plot, where
        // hovering a black point reveals which AOI category the gaze was on.
        if (plotData.categorical) {
            const labels = vis.labels || sortedData.map(String);
            const customdata = matrix.map((rowArr, i) =>
                rowArr.map(v => (v ? labels[i] : null)));
            const tEnd = sortedTime[sortedTime.length - 1];
            const catTrace = {
                x: sortedTime, y: sortedTime, z: matrix, customdata: customdata,
                type: 'heatmap', colorscale: [[0, 'white'], [1, 'black']],
                showscale: false,
                hovertemplate: 'Gaze: %{customdata}<br>Time X: %{x:.1f}s<br>Time Y: %{y:.1f}s<extra></extra>'
            };
            const catLayout = {
                title: { text: `${dataType}<br><sub>Categorical gaze RQA — Recurrence Rate: ${(plotData.recurrence_rate * 100).toFixed(2)}%</sub>`, font: { color: 'white', size: 16 } },
                paper_bgcolor: '#222', plot_bgcolor: '#333', font: { color: 'white' },
                xaxis: { title: 'Time (s)', gridcolor: '#444', constrain: 'domain' },
                yaxis: { title: 'Time (s)', gridcolor: '#444', scaleanchor: 'x', scaleratio: 1 },
                margin: { t: 80, r: 50, b: 80, l: 80 }, hovermode: 'closest'
            };
            if (this.lastClickedPoint !== null) {
                const ws = parseInt(document.getElementById('windowSize').value) || 5;
                const st = Math.max(sortedTime[0], this.lastClickedPoint - ws / 2);
                const et = Math.min(tEnd, this.lastClickedPoint + ws / 2);
                const ln = (x0, x1, y0, y1) => ({ type: 'line', x0, x1, y0, y1, line: { color: 'yellow', width: 2 }, xref: 'x', yref: 'y' });
                catLayout.shapes = [
                    ln(st, st, sortedTime[0], tEnd), ln(et, et, sortedTime[0], tEnd),
                    ln(sortedTime[0], tEnd, st, st), ln(sortedTime[0], tEnd, et, et),
                    { type: 'rect', x0: st, x1: et, y0: st, y1: et, fillcolor: 'yellow', opacity: 0.1, line: { width: 0 }, xref: 'x', yref: 'y' }
                ];
            }
            Plotly.newPlot(containerId, [catTrace], catLayout, { responsive: true });
            document.getElementById(containerId).on('plotly_click', (data) => {
                if (data.points && data.points.length > 0) {
                    this.handleTimeClick(data.points[0].x);
                    setTimeout(() => this.updateRQAHighlights(), 100);
                }
            });
            return;
        }

        // Create traces
        const traces = [
            // Main RQA heatmap
            {
                x: sortedTime,
                y: sortedTime,
                z: matrix,
                type: 'heatmap',
                colorscale: [[0, 'white'], [1, 'black']],
                showscale: false,
                xaxis: 'x',
                yaxis: 'y',
                hovertemplate: 'Time X: %{x:.1f}s<br>Time Y: %{y:.1f}s<extra></extra>'
            },
            // X-axis timeseries
            {
                x: sortedTime,
                y: sortedData,
                type: 'scatter',
                mode: 'lines',
                line: { color: dataColor, width: 2 },
                xaxis: 'x2',
                yaxis: 'y2',
                hovertemplate: 'Time: %{x:.1f}s<br>Value: %{y:.2f}<extra></extra>'
            },
            // Y-axis timeseries (rotated)
            {
                x: sortedData,
                y: sortedTime,
                type: 'scatter',
                mode: 'lines',
                line: { color: dataColor, width: 2 },
                xaxis: 'x3',
                yaxis: 'y3',
                hovertemplate: 'Value: %{x:.2f}<br>Time: %{y:.1f}s<extra></extra>'
            }
        ];
        
        // Create layout with subplots
        const layout = {
            title: {
                text: `${dataType}<br><sub>Recurrence Rate: ${(plotData.recurrence_rate * 100).toFixed(2)}%, Threshold: ${plotData.threshold.toFixed(4)}</sub>`,
                font: { color: 'white', size: 16 }
            },
            paper_bgcolor: '#222',
            plot_bgcolor: '#333',
            font: { color: 'white' },
            grid: {
                rows: 2,
                columns: 2,
                pattern: 'independent',
                roworder: 'bottom to top'
            },
            xaxis: {
                domain: [0.15, 0.95],
                anchor: 'y',
                title: 'Time (s)',
                gridcolor: '#444'
            },
            yaxis: {
                domain: [0, 0.8],
                anchor: 'x',
                title: 'Time (s)',
                gridcolor: '#444'
            },
            xaxis2: {
                domain: [0.15, 0.95],
                anchor: 'y2',
                title: 'Time (s)',
                gridcolor: '#444'
            },
            yaxis2: {
                domain: [0.85, 1],
                anchor: 'x2',
                title: 'Value',
                gridcolor: '#444'
            },
            xaxis3: {
                domain: [0, 0.1],
                anchor: 'y3',
                title: 'Value',
                gridcolor: '#444',
                autorange: 'reversed'
            },
            yaxis3: {
                domain: [0, 0.8],
                anchor: 'x3',
                title: '',
                showticklabels: false,
                gridcolor: '#444'
            },
            margin: { t: 80, r: 50, b: 80, l: 80 },
            hovermode: 'closest'
        };
        
        // Add highlight shape if there's a selected time
        if (this.lastClickedPoint !== null) {
            const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
            const startTime = Math.max(sortedTime[0], this.lastClickedPoint - windowSize / 2);
            const endTime = Math.min(sortedTime[sortedTime.length - 1], this.lastClickedPoint + windowSize / 2);
            
            layout.shapes = [
                // Vertical lines on main plot
                {
                    type: 'line',
                    x0: startTime, x1: startTime,
                    y0: sortedTime[0], y1: sortedTime[sortedTime.length - 1],
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                {
                    type: 'line',
                    x0: endTime, x1: endTime,
                    y0: sortedTime[0], y1: sortedTime[sortedTime.length - 1],
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                // Horizontal lines on main plot
                {
                    type: 'line',
                    x0: sortedTime[0], x1: sortedTime[sortedTime.length - 1],
                    y0: startTime, y1: startTime,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                {
                    type: 'line',
                    x0: sortedTime[0], x1: sortedTime[sortedTime.length - 1],
                    y0: endTime, y1: endTime,
                    line: { color: 'yellow', width: 2 },
                    xref: 'x', yref: 'y'
                },
                // Highlight box
                {
                    type: 'rect',
                    x0: startTime, x1: endTime,
                    y0: startTime, y1: endTime,
                    fillcolor: 'yellow',
                    opacity: 0.1,
                    line: { width: 0 },
                    xref: 'x', yref: 'y'
                }
            ];
        }
        
        console.log(`Calling Plotly.newPlot for ${containerId}`);
        Plotly.newPlot(containerId, traces, layout, { responsive: true });
        
        // Add click handler
        document.getElementById(containerId).on('plotly_click', (data) => {
            if (data.points && data.points.length > 0) {
                const point = data.points[0];
                
                // Check which subplot was clicked
                if (point.xaxis && point.xaxis._id === 'x' && point.yaxis._id === 'y') {
                    // Main RQA plot clicked
                    const clickedTime = point.x;
                    console.log(`RQA clicked at time: ${clickedTime.toFixed(2)}s`);
                    
                    // Update video and timeseries
                    this.handleTimeClick(clickedTime);
                    
                    // Update all RQA plots to show highlight
                    setTimeout(() => this.updateRQAHighlights(), 100);
                }
            }
        });
    }

    updateRQAHighlights() {
        // Re-render all RQA plots with updated highlights
        if (this.rqaData && this.rqaData.rqa_data) {
            Object.entries(this.rqaData.rqa_data).forEach(([dataType, plotData], index) => {
                const containerId = `rqa-plot-${index}`;
                if (document.getElementById(containerId)) {
                    this.createRQAPlot(containerId, dataType, plotData);
                }
            });
        }
    }

    setupHeader() {
        try {
            // The browser tab is how you tell two dashboards apart when both
            // are open, so it must carry the study name. It was hardcoded to
            // "DIMS Dashboard" in every case repo, which made a mis-served
            // dashboard indistinguishable from the right one.
            if (this.config.title) document.title = this.config.title;

            const titleEl = document.getElementById('title');
            const subtitleEl = document.getElementById('subtitle');
            const authorsEl = document.getElementById('authors');
            const contactsEl = document.getElementById('contacts');
            
            if (titleEl) titleEl.textContent = this.config.title || 'DIMS Dashboard';
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

            // Populate perspective selector (multi-perspective video)
            const pSel = document.getElementById('perspectiveSelect');
            if (pSel) {
                const list = Array.isArray(this.config.perspectives) ? this.config.perspectives : [];
                pSel.innerHTML = '<option value="">auto</option>';
                list.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    pSel.appendChild(opt);
                });
                this.currentPerspective = ''; // default "auto"
            }
        } catch (error) {
            console.error('Error setting up controls:', error);
        }
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

        const pSel = document.getElementById('perspectiveSelect');
        if (pSel) {
            pSel.addEventListener('change', (e) => {
                this.currentPerspective = e.target.value || '';
                // Re-render videos immediately with the current time/window
                const t = this.lastClickedPoint ?? 0;
                const win = parseInt(document.getElementById('windowSize').value) || (this.config.defaultWindowSize || 5);
                this.updateVideos(t, win);
            });
        }
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
            return Papa.parse(text, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });
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
        
        // Transcript is optional — tolerate a missing file without failing the load
        const transcriptPromise = this
            .loadJSON(`assets/transcripts/${videoID}_transcript.json`)
            .catch(() => null);

        const [timeseriesResults, transcript] = await Promise.all([
            Promise.all(timeseriesPromises),
            transcriptPromise
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
        slider.style.background = '#444';
        
        const valueDisplay = document.createElement('div');
        valueDisplay.style.textAlign = 'center';
        valueDisplay.style.marginTop = '10px';
        valueDisplay.style.color = '#888';
        
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

    plotTimeseries(datasets, selectedTime = null) {
        if (!datasets || datasets.length === 0) {
            document.getElementById('plotContainer').innerHTML = '<div class="error">No data to plot</div>';
            return;
        }
        
        // Create subplots for each dataset
        const traces = [];
        const annotations = [];
        
        datasets.forEach((dataset, i) => {
            if (!dataset.data || dataset.data.length === 0) return;
            
            // Sort data by time to prevent wrapping
            const sortedData = [...dataset.data].sort((a, b) => a.Time - b.Time);
            
            // Get all columns except Time for this dataset
            const columns = Object.keys(sortedData[0]).filter(col => col !== 'Time');
            
            // If multiple columns, create a single averaged trace
            if (columns.length > 1) {
                // Average all columns for this dataset
                const avgY = sortedData.map(row => {
                    const values = columns.map(col => row[col]).filter(v => v !== null && v !== undefined);
                    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                });
                
                traces.push({
                    x: sortedData.map(d => d.Time),
                    y: avgY,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${dataset.name} (averaged)`,
                    yaxis: `y${i + 1}`,
                    line: { color: `hsl(${i * 360 / datasets.length}, 70%, 50%)` }
                });
            } else if (columns.length === 1) {
                // Single column - plot directly
                traces.push({
                    x: sortedData.map(d => d.Time),
                    y: sortedData.map(d => d[columns[0]]),
                    type: 'scatter',
                    mode: 'lines',
                    name: dataset.name,
                    yaxis: `y${i + 1}`,
                    line: { color: `hsl(${i * 360 / datasets.length}, 70%, 50%)` }
                });
            }
            
            annotations.push({
                text: dataset.name,
                x: 0.02,
                y: 1 - (i / datasets.length) - 0.02,
                xref: 'paper',
                yref: 'paper',
                xanchor: 'left',
                yanchor: 'top',
                showarrow: false,
                font: { color: 'white', size: 12 }
            });
        });
        
        // Create layout with subplots
        const layout = {
            title: {
                text: `ROI Synchrony Over Time for Video ${this.currentVideoID}`,
                font: { color: 'white' }
            },
            paper_bgcolor: '#111',
            plot_bgcolor: '#222',
            font: { color: 'white' },
            xaxis: {
                title: 'Time (s)',
                color: 'white',
                gridcolor: '#444'
            },
            annotations: annotations,
            height: 800,
            margin: { t: 80, r: 50, b: 80, l: 50 },
            showlegend: false
        };
        
        // Add y-axes for each subplot
        datasets.forEach((dataset, i) => {
            const yAxisKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
            layout[yAxisKey] = {
                title: '',
                color: 'white',
                gridcolor: '#444',
                domain: [1 - (i + 1) / datasets.length + 0.02, 1 - i / datasets.length - 0.02]
            };
        });
        
        // Add highlight for selected time
        if (selectedTime !== null) {
            const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
            const startTime = Math.max(0, selectedTime - windowSize / 2);
            const endTime = selectedTime + windowSize / 2;
            
            layout.shapes = datasets.map((dataset, i) => ({
                type: 'rect',
                x0: startTime,
                x1: endTime,
                y0: 0,
                y1: 1,
                yref: `y${i + 1} domain`,
                fillcolor: 'rgba(255, 255, 255, 0.3)',
                line: { color: 'white', width: 2 }
            }));
        }
        
        Plotly.newPlot('plotContainer', traces, layout, { responsive: true });
        
        // Add click handler
        document.getElementById('plotContainer').on('plotly_click', (data) => {
            if (data.points && data.points.length > 0) {
                const clickedTime = data.points[0].x;
                this.handleTimeClick(clickedTime);
            }
        });
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
        
        // Update highlights based on current tab
        if (this.currentTab === 'rqa' && this.rqaData) {
            this.updateRQAHighlights();
        } else if (this.currentTab === 'crosswavelet' && this.crossWaveletData) {
            this.updateCrossWaveletHighlights();
        } else if (this.currentTab === 'trajectory' && this.trajectoryData) {
            this.updateTrajectoryHighlight();
        } else if (this.currentTab === 'dtw' && this.dtwData) {
            this.updateDTWHighlights();
        } else if (this.currentTab === 'elan' && this.elanData) {
            this.updateELANHighlight();
        }
        
        // Update status
        document.getElementById('status').textContent = 
            `Selected time: ${time.toFixed(2)}s (window: ${windowSize}s)`;
    }

    // Build the video source URL, honoring perspective templates when configured.
    // Falls back to assets/videos/{videoID}.mp4 when no perspectives are set.
    buildVideoSrc() {
        const tmpl = this.config.videoSrcTemplate;
        const fallbackTmpl = this.config.fallbackVideoSrcTemplate || 'assets/videos/{videoID}.mp4';
        const fill = (t, persp) =>
            t.replace('{videoID}', this.currentVideoID).replace('{persp}', persp || '');

        if (tmpl) {
            if (this.currentPerspective) {
                return fill(tmpl, this.currentPerspective);
            }
            // "auto" -> first perspective that actually exists for this video.
            // videoPerspectives lists the clips present (some sources are
            // short/broken, so not every level has wide/parent).
            const avail = this.config.videoPerspectives?.[this.currentVideoID];
            if (Array.isArray(avail) && avail.length) {
                return fill(tmpl, avail[0]);
            }
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
        if (!videoID) return;
        
        this.showStatus('Loading data...');
        
        try {
            const data = await this.loadDataForVideoID(videoID);
            this.currentData = data.timeseries;
            this.currentTranscript = data.transcript;
            this.currentVideoID = videoID;
            this.rqaData = null;
            this.crossWaveletData = null;
            this.elanData = null;
            this.elanSelectedTiers = null;
            this.trajectoryData = null;
            this.dtwData = null;
            
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
                    
                    // Load RQA data if on RQA tab
                    if (this.currentTab === 'rqa' && this.config.include_RQA) {
                        this.loadRQAData(videoID);
                    }
                    
                    // Load cross-wavelet data if on cross-wavelet tab
                    if (this.currentTab === 'crosswavelet' && this.config.include_crosswavelet) {
                        this.loadCrossWaveletData(videoID);
                    }

                    if (this.currentTab === 'elan' && this.config.include_elan) {
                        this.loadELANData(videoID);
                    }

                    // Recompute trajectory when switching video while on the tab
                    // (otherwise the previous video's path/image stays shown).
                    if (this.currentTab === 'trajectory' && this.config.include_trajectory) {
                        this.calculateAndShowTrajectory();
                    }
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
            this.showStatus('ELAN annotations loaded.');
        } catch (e) {
            console.error('Error loading ELAN data:', e);
            this.showError(`Failed to load ELAN data: ${e.message}`);
        }
    }

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
                <label style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;" onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" data-tier="${tier.tierID}" ${checked}
                        style="width:13px;height:13px;accent-color:${color};cursor:pointer;flex-shrink:0;">
                    <span style="display:inline-block;width:11px;height:11px;background:${color};border-radius:2px;flex-shrink:0;"></span>
                    <span style="color:#ddd;font-size:12px;" title="${tier.tierID}">${tier.tierID}</span>
                </label>`;
        }).join('');

        container.innerHTML = `
            <h2 style="color:white;margin-bottom:12px;">ELAN Annotations</h2>
            <div style="background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:8px 10px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
                    <span style="color:#aaa;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">Tiers</span>
                    <button id="elanSelectAll" style="font-size:10px;color:#888;background:none;border:none;cursor:pointer;padding:0;" onmouseover="this.style.color='white'" onmouseout="this.style.color='#888'">all</button>
                    <button id="elanSelectNone" style="font-size:10px;color:#888;background:none;border:none;cursor:pointer;padding:0;" onmouseover="this.style.color='white'" onmouseout="this.style.color='#888'">none</button>
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
    }

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
                  fillcolor: 'rgba(255,255,80,0.1)', line: { width: 0 }, xref: 'x', yref: 'y' },
                { type: 'line', x0: t, x1: t, y0: 0, y1: N,
                  line: { color: 'yellow', width: 2, dash: 'dot' }, xref: 'x', yref: 'y' }
            );
        }

        const layout = {
            paper_bgcolor: '#111', plot_bgcolor: '#1a1a1a', font: { color: 'white' },
            margin: { t: 20, r: 20, b: 50, l: leftMargin },
            xaxis: {
                title: 'Time (s)', color: 'white', gridcolor: '#333', zeroline: false,
                range: this.mergedData
                    ? [0, Math.max(...this.mergedData.map(d => d.Time))]
                    : undefined
            },
            yaxis: {
                tickvals: tiers.map((_, i) => i + 0.5),
                ticktext: tiers.map(t => t.tierID),
                tickfont: { color: 'white', size: 10 },
                gridcolor: '#2a2a2a',
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
    }

    updateELANHighlight() {
        if (!this.elanData || !document.getElementById('elanPlot')) return;
        this._renderELANPlot();
    }
}

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