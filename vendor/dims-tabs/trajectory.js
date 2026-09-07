// Trajectory tab.
//
// Where two people moved through a shared physical space, drawn over a
// background image of that space, with the playhead marking the moment.
//
// Lifted from DIMS_Dashboard_Ortho, where it was added by editing three regions
// of a 2500-line class -- which is exactly why it could never reach any other
// study. Self-registering now: see docs/contracts/tab.md.
(function () {
    'use strict';

    window.DIMS.extendHost({
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
        },

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
        },

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
    });

    window.DIMS.registerTab({
        id: 'trajectory',
        label: 'Trajectory',
        order: 25,
        gate: cfg => cfg.include_trajectory === true,
        async onActivate(app, container) {
        await app.calculateAndShowTrajectory();
        },
        onTimeUpdate(app) {
        app.updateTrajectoryHighlight();
        },
        onVideoChange(app) {
            app.trajectoryData = null;
        },
    });
})();
