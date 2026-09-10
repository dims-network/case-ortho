// The human figure the cross-effector network is drawn on — one copy of it.
//
// Two things draw this body: the dashboard's network tab (network.js, beside
// this file) and the wizard's step 4 diagram (apps/builder/dims_builder/static/
// builder.js). They have to agree to the pixel, because what you arrange in the
// wizard is what the dashboard draws. They used to agree by hand, with a comment
// in the builder saying "copied from the tab's appendFigure(); if that geometry
// moves, this follows" — and a third copy of the body-token list a few hundred
// lines away from either.
//
// **To move a body part, change it here.** The number you change moves the node
// in the wizard, and in every study on its next `dims-case sync` — a built study
// keeps the copy under its own `vendor/dims-tabs/` until then, which is the
// whole point of vendoring.
//
// No build step and no module system: this is a plain script that hangs one
// object off `window`, loaded before its two consumers. The dashboard gets it
// through `vendor/dims-tabs/`, which `dims-case` copies wholesale; the builder
// is served it from the checkout it already needs.
(function (global) {
    'use strict';

    // The coordinate space. Everything below is in viewBox units, so it scales
    // with the picture rather than with the window.
    const VIEW_W = 1000;        // the diagram's viewBox width
    // Two radii for what looks like one circle, because it is doing two jobs.
    // In the wizard the circle is a drop target: it has to be comfortably
    // clickable, and an empty one has to read as a place where something could
    // go. On the dashboard it is a dot at the end of a line, and the line is the
    // measurement — a node the size of the wizard's swallows the width channel,
    // since the heaviest edge the tab can draw is 16 px against a 52 px circle.
    const NODE_R = 26;          // the wizard's drop target
    const TAB_NODE_R = 12;      // the dashboard's dot at the end of an edge
    const HEAD_Y = 85, HEAD_R = 30;
    const SHOULDER_Y = 150, SHOULDER_DX = 60;
    const TORSO_Y = 235;
    const HIP_Y = 330, HIP_DX = 32;
    const HAND_Y = 300, HAND_DX = 100;
    const FOOT_Y = 545, FOOT_DX = 35;

    // Six places something can sit, each with a name to draw under an empty one.
    // `dx` is measured from the figure's centre line.
    const SPOTS = [
        { part: 'head',      label: 'head',       dx: 0,         y: HEAD_Y },
        { part: 'righthand', label: 'right hand', dx: -HAND_DX,  y: HAND_Y },
        { part: 'lefthand',  label: 'left hand',  dx: HAND_DX,   y: HAND_Y },
        { part: 'torso',     label: 'torso',      dx: 0,         y: TORSO_Y },
        { part: 'hip',       label: 'hip',        dx: 0,         y: HIP_Y },
        { part: 'foot',      label: 'foot',       dx: 0,         y: FOOT_Y },
    ];

    // Eight names, six places: two of them are older spellings for a place that
    // already exists. Written once here rather than duplicated inline in one
    // consumer and mapped in the other.
    const ALIASES = { nose: 'head', hand: 'lefthand' };

    // Longest token first, so `lefthand` is not swallowed by `hand`. This is how
    // a study that predates `effectors` still lands its measures on a body: the
    // part is read out of what is left of the name once the group prefix is
    // stripped, so `teacher_righthandspeed` becomes `righthandspeed` and finds
    // `righthand`.
    const BODY_TOKENS = ['lefthand', 'righthand', 'hand', 'nose', 'head',
                         'torso', 'hip', 'foot'];

    /** The real place a part name refers to, following the aliases. */
    function spotOf(part) {
        return ALIASES[part] || part;
    }

    /** The part a measure's name mentions, or null. */
    function bodyPart(name) {
        const n = String(name).toLowerCase();
        return BODY_TOKENS.find(part => n.includes(part)) || null;
    }

    /** The spot record for a part name, following the aliases. */
    function spot(part) {
        const want = spotOf(part);
        return SPOTS.find(sp => sp.part === want) || null;
    }

    /**
     * Every part name — aliases included — as an {x, y} on a figure centred at
     * `cx`. Derived from SPOTS rather than written out, so the alias and the
     * place it points at cannot drift apart.
     */
    function positions(cx) {
        const out = {};
        SPOTS.forEach(sp => { out[sp.part] = { x: cx + sp.dx, y: sp.y }; });
        Object.entries(ALIASES).forEach(([from, to]) => { out[from] = out[to]; });
        return out;
    }

    /** Where the nth of `total` figures is centred. */
    function personCx(index, total) {
        return (VIEW_W * (index + 1)) / (total + 1);
    }

    /**
     * A translucent body under the nodes, so a chart of people looks like one.
     *
     * `el` is the caller's element-maker — the tab and the wizard each have one
     * already — taking (name, attrs) and returning an SVG element.
     */
    function appendFigure(svg, opts) {
        const { cx, color, el, opacity = 0.3 } = opts;
        const g = el('g', {
            class: 'dims-figure', opacity, fill: color, stroke: color,
            'stroke-width': 10, 'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        });
        const shoulderL = cx - SHOULDER_DX, shoulderR = cx + SHOULDER_DX;
        const hipL = cx - HIP_DX, hipR = cx + HIP_DX;
        const at = positions(cx);

        g.appendChild(el('circle', { cx, cy: HEAD_Y, r: HEAD_R, stroke: 'none' }));
        g.appendChild(el('path', {
            d: `M ${shoulderL} ${SHOULDER_Y} L ${shoulderR} ${SHOULDER_Y} `
             + `L ${hipR} ${HIP_Y} L ${hipL} ${HIP_Y} Z`, stroke: 'none' }));

        // Each arm to the hand on its own side. The figure faces the viewer, so
        // the person's left hand is drawn on the viewer's right — and so is
        // their left shoulder. Pairing the left shoulder with the left hand
        // reached across the chest and drew the two arms as an X.
        [[shoulderR, SHOULDER_Y, at.lefthand.x, at.lefthand.y],
         [shoulderL, SHOULDER_Y, at.righthand.x, at.righthand.y],
         [hipL, HIP_Y, cx - FOOT_DX, FOOT_Y],
         [hipR, HIP_Y, cx + FOOT_DX, FOOT_Y]].forEach(([x1, y1, x2, y2]) => {
            g.appendChild(el('line', { x1, y1, x2, y2, fill: 'none' }));
        });
        svg.appendChild(g);
        return g;
    }

    // --- the lines between the nodes -----------------------------------------
    //
    // Every edge is bowed perpendicular to its chord, and no two by the same
    // amount. Straight lines between collinear nodes are *the same line*: three
    // within-body edges drew one thick bar and the reader had no way to tell one
    // from three. Lines that merely share an endpoint are nearly as bad — every
    // cross-body edge crosses the middle, and they arrive at a node as a single
    // smear. Fanning the whole set is what separates them.
    //
    // The fan lives here rather than in the tab because the wizard draws the
    // same lines, and a request for an analysis should be the same shape as the
    // result that comes back.
    const BOW_FLOOR = 22;   // even a lone edge curves a little
    const BOW_STEP = 30;    // between neighbours in the fan
    const BOW_MAX = 240;    // the widest arc, so a large fan stays in frame

    /** A rank per edge, symmetrical about zero: the fan's spread. */
    function bowRanks(count) {
        const out = [];
        for (let i = 0; i < count; i++) out.push(i - (count - 1) / 2);
        return out;
    }

    /**
     * How far apart to space the fan. BOW_STEP until the outermost arc would
     * leave the picture, then whatever fits — a study with twenty edges gets a
     * tighter fan rather than arcs sweeping off the top of the viewBox.
     */
    function bowStep(count) {
        const outer = Math.max(1, (count - 1) / 2);
        return Math.min(BOW_STEP, (BOW_MAX - BOW_FLOOR) / outer);
    }

    /** A quadratic curve between two points, bowed by this edge's rank. */
    function edgePath(p1, p2, rank, step) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = -dy / len, oy = dx / len;          // unit perpendicular
        const r = rank || 0;
        // The floor is signed with the rank so the fan stays symmetrical, and it
        // is there so even rank 0 curves: two nodes joined by a single straight
        // line look like structure rather than like a measurement.
        const amt = r * (step === undefined || step === null ? BOW_STEP : step)
                  + (r >= 0 ? BOW_FLOOR : -BOW_FLOOR);
        return `M ${p1.x} ${p1.y} Q ${(p1.x + p2.x) / 2 + ox * amt} `
             + `${(p1.y + p2.y) / 2 + oy * amt} ${p2.x} ${p2.y}`;
    }

    global.DIMS_FIGURE = {
        VIEW_W, NODE_R, TAB_NODE_R, HEAD_Y, HEAD_R, SHOULDER_Y, SHOULDER_DX,
        TORSO_Y, HIP_Y, HIP_DX, HAND_Y, HAND_DX, FOOT_Y, FOOT_DX,
        SPOTS, ALIASES, BODY_TOKENS,
        BOW_FLOOR, BOW_STEP, BOW_MAX,
        spotOf, bodyPart, spot, positions, personCx, appendFigure,
        bowRanks, bowStep, edgePath,
    };
})(typeof window !== 'undefined' ? window : globalThis);
