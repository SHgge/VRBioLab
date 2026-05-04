/**
 * @file Procedural specimen drawing for the Explore-mode eyepiece view.
 *
 * Each slide carries an `id` (A..D) that the optics module dispatches to
 * `drawSpecimen(id, ctx, w, h, magnification, focus, brightness)`. The
 * underlying draw functions sketch the biology straight onto a 2D canvas
 * so we don't need to ship any image assets — the shapes scale cleanly
 * with magnification and respond to focus / brightness in real time.
 *
 *   • magnification — total optical zoom (e.g. 4×10 = 40, 100×10 = 1000).
 *     Drives the world-to-canvas scaling so the specimen physically grows
 *     in the eyepiece viewport.
 *   • focus — 0..1. 0.5 is sharp; deviation in either direction blurs the
 *     image proportionally to (focus - 0.5)².
 *   • brightness — 0..1. Driven by the diaphragm aperture; modulates a
 *     full-screen overlay AFTER the specimen is drawn.
 *
 * The microscope inverts the image — the Letter-E slide is the canonical
 * demonstration of this; we draw it 180° rotated so the user sees the
 * inverted "E" they would see in a real eyepiece.
 */

export const SLIDES = [
	{
		id: 'A',
		name: 'Onion Cell',
		mn: 'Сонгины эс',
		dropColor: '#e9d8b8', // pale ivory specimen droplet on the slide
	},
	{
		id: 'B',
		name: 'Blood Cell',
		mn: 'Цусны эс',
		dropColor: '#c64242',
	},
	{
		id: 'C',
		name: 'Letter e',
		mn: 'e үсэг',
		dropColor: '#1a1a1a',
	},
	{
		id: 'D',
		name: 'Plant Leaf',
		mn: 'Ургамлын навч',
		dropColor: '#3aa758',
	},
];

const SLIDES_BY_ID = new Map(SLIDES.map((s) => [s.id, s]));

export function getSpecimenInfo(slideId) {
	return SLIDES_BY_ID.get(slideId) || null;
}

// =====================================================================
// PUBLIC DISPATCHER
// =====================================================================

/**
 * Render the specimen for `slideId` onto a 2D canvas context.
 *
 * Draws to a CIRCULAR aperture — the eyepiece field of view is round in
 * a real microscope, so we mask everything outside a centred disc.
 *
 * @param {string}  slideId        'A' | 'B' | 'C' | 'D'
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}  w              canvas width  (px)
 * @param {number}  h              canvas height (px)
 * @param {number}  magnification  total optical zoom (e.g. 40 for 4×)
 * @param {number}  focus          0..1 focus position
 * @param {number}  brightness     0..1 light level
 */
// ── Off-screen specimen cache ──────────────────────────────────────
// Rendering 600 cells with gradients per frame was the dominant FPS
// killer when the kid spun a focus knob. We now render the specimen
// ONCE into an off-screen canvas keyed on (slide, magnification, size)
// — knob-driven focus changes only touch the BLUR amount, applied via
// drawImage(filter), and brightness changes only touch a darkening
// overlay. Both are pure GPU blits; the heavy gradient/cell drawing
// only happens on slide-swap or objective-change.

let _cacheCanvas = null;
let _cacheCtx = null;
let _cacheKey = null;

function regenerateCache(slideId, w, h, magnification) {
	if (!_cacheCanvas || _cacheCanvas.width !== w || _cacheCanvas.height !== h) {
		_cacheCanvas = document.createElement('canvas');
		_cacheCanvas.width = w;
		_cacheCanvas.height = h;
		_cacheCtx = _cacheCanvas.getContext('2d');
	}
	const ctx = _cacheCtx;
	const cx = w / 2, cy = h / 2;
	const radius = Math.min(w, h) * 0.35;

	ctx.clearRect(0, 0, w, h);
	ctx.save();
	// Black backdrop
	ctx.fillStyle = '#0a0a0a';
	ctx.fillRect(0, 0, w, h);

	// Clip to the eyepiece circle
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.clip();

	// Full-brightness cream illumination — actual brightness is applied
	// later as a dark overlay so brightness changes don't invalidate
	// the cache.
	ctx.fillStyle = 'rgb(245, 238, 220)';
	ctx.fillRect(0, 0, w, h);

	switch (slideId) {
		case 'A': drawOnionCell(ctx, w, h, magnification); break;
		case 'B': drawBloodCell(ctx, w, h, magnification); break;
		case 'C': drawLetterE(ctx, w, h, magnification);   break;
		case 'D': drawPlantLeaf(ctx, w, h, magnification); break;
		default:  drawEmpty(ctx, w, h);                     break;
	}

	// Vignette
	const grad = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
	grad.addColorStop(0, 'rgba(0,0,0,0)');
	grad.addColorStop(1, 'rgba(0,0,0,0.45)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);

	// Reticle
	ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy);
	ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
	ctx.stroke();
	ctx.restore();

	// Black surround outside the circle
	ctx.fillStyle = '#000000';
	ctx.beginPath();
	ctx.rect(0, 0, w, h);
	ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
	ctx.fill('evenodd');
}

export function drawSpecimen(slideId, ctx, w, h, magnification, focus, brightness) {
	const cx = w / 2, cy = h / 2;
	const radius = Math.min(w, h) * 0.35;

	// Cache key — only invalidates on slide swap, objective change, or
	// canvas resize. Focus and brightness are FREE to vary.
	const key = `${slideId || '_'}|${magnification}|${w}x${h}`;
	if (key !== _cacheKey) {
		regenerateCache(slideId, w, h, magnification);
		_cacheKey = key;
	}

	// Defocus blur — applied via drawImage filter. Pure GPU blit + blur
	// shader, costs ~1-2 ms even at 30 px blur (was ~10-30 ms for the
	// per-cell gradient render path before caching).
	const focusErr = Math.abs(focus - 0.5) * 2;
	const blurPx = Math.round(focusErr * focusErr * 30);

	ctx.clearRect(0, 0, w, h);
	ctx.save();
	if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
	ctx.drawImage(_cacheCanvas, 0, 0);
	ctx.restore();

	// Brightness dimmer — single fillRect with alpha. Cheap.
	const dim = (1 - clamp(brightness, 0, 1)) * 0.85;
	if (dim > 0.02) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.clip();
		ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
		ctx.fillRect(0, 0, w, h);
		ctx.restore();
	}
}

/** Force the next drawSpecimen call to rebuild the cache — call this
 *  if the underlying drawing functions ever start to depend on extra
 *  state we haven't keyed in. (Currently unused; reserved for future
 *  per-cell randomisation seeds.) */
export function invalidateSpecimenCache() {
	_cacheKey = null;
}

// =====================================================================
// SLIDE A — Onion epidermis cells (rectangular, brick-like, with nucleus)
// =====================================================================

function drawOnionCell(ctx, w, h, mag) {
	const cx = w / 2;
	const cy = h / 2;

	// At 40× total magnification one cell is ~60 px wide.
	// Scale linearly so 1000× makes them ~1500 px (one cell fills view).
	const cellW = (60 / 40) * mag;
	const cellH = cellW * 0.55;

	const cols = Math.ceil(w / cellW) + 2;
	const rows = Math.ceil(h / cellH) + 2;

	const offsetX = ((((mag * 0.13) % cellW) + cellW) % cellW) - cellW;
	const offsetY = -cellH;

	ctx.lineWidth = Math.max(1, cellW * 0.015);
	ctx.strokeStyle = '#7a5a3a';

	// Brick-pattern — every other row offsets by half a cell.
	for (let r = 0; r < rows; r++) {
		const yTop = offsetY + r * cellH;
		const xShift = (r % 2 === 0 ? 0 : cellW / 2);
		for (let c = -1; c < cols; c++) {
			const xLeft = offsetX + c * cellW + xShift;
			// Slight per-cell tint variation
			const tint = 232 + ((r * 7 + c * 13) % 14);
			ctx.fillStyle = `rgb(${tint}, ${tint - 12}, ${tint - 32})`;
			ctx.beginPath();
			roundedRect(ctx, xLeft, yTop, cellW, cellH, cellW * 0.08);
			ctx.fill();
			ctx.stroke();

			// Nucleus — small darker dot, position varies by cell.
			const nucX = xLeft + cellW * (0.3 + ((r * c) % 5) * 0.08);
			const nucY = yTop + cellH * (0.4 + ((r + c) % 3) * 0.08);
			const nucR = cellW * 0.08;
			ctx.fillStyle = '#5e3a1a';
			ctx.beginPath();
			ctx.arc(nucX, nucY, nucR, 0, Math.PI * 2);
			ctx.fill();
			// Nucleolus highlight
			ctx.fillStyle = '#3a2410';
			ctx.beginPath();
			ctx.arc(nucX + nucR * 0.2, nucY - nucR * 0.2, nucR * 0.35, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Subtle iris ring at centre — gives the user a fixed reference.
	ctx.strokeStyle = 'rgba(60, 35, 15, 0.18)';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2);
	ctx.stroke();
}

// =====================================================================
// SLIDE B — Blood cells (red biconcave discs + a few white cells)
// =====================================================================

function drawBloodCell(ctx, w, h, mag) {
	const cx = w / 2;
	const cy = h / 2;

	// At 100× total a single RBC is ~6 px; at 1000× ~60 px.
	const rbcR = (5 / 100) * mag;

	// Deterministic but pseudo-random PRNG so cells don't dance between
	// frames — same magnification, same layout.
	const rng = mulberry32(0x9e37);

	// Cap count to keep low-mag draws fast. At 4×/10× the formula gave
	// 5000+ cells which baked the framerate (each radial gradient =
	// expensive). 600 cells fills the field of view cleanly without
	// individual gaps.
	const rawCount = Math.round((w * h) / Math.max(40, rbcR * rbcR * 8));
	const count = Math.min(600, rawCount);

	// Pre-render a single blood-cell sprite once per draw pass and
	// stamp it via drawImage. drawImage is ~10-50× faster than
	// createRadialGradient + arc + fill per cell.
	const sprite = getBloodCellSprite(rbcR);
	const sw = sprite.width;
	for (let i = 0; i < count; i++) {
		const x = rng() * w;
		const y = rng() * h;
		const scale = 0.85 + rng() * 0.3;
		const drawW = sw * scale;
		ctx.drawImage(sprite, x - drawW / 2, y - drawW / 2, drawW, drawW);
	}

	// A handful of larger white blood cells (lobed nucleus).
	const wbcCount = Math.max(1, Math.round(count * 0.012));
	for (let i = 0; i < wbcCount; i++) {
		const x = rng() * w;
		const y = rng() * h;
		const r = rbcR * 1.6;
		ctx.fillStyle = '#d6ddee';
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
		// Multilobed purple nucleus
		ctx.fillStyle = '#6a3aa8';
		for (let lobe = 0; lobe < 3; lobe++) {
			const a = (lobe / 3) * Math.PI * 2;
			const lx = x + Math.cos(a) * r * 0.35;
			const ly = y + Math.sin(a) * r * 0.35;
			ctx.beginPath();
			ctx.arc(lx, ly, r * 0.4, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Faint plasma streaks for context.
	ctx.strokeStyle = 'rgba(150, 80, 80, 0.10)';
	ctx.lineWidth = 1;
	for (let i = 0; i < 6; i++) {
		ctx.beginPath();
		ctx.moveTo(0, cy + (i - 3) * h * 0.08);
		ctx.bezierCurveTo(w * 0.4, cy + i * 8, w * 0.6, cy - i * 4, w, cy + (i - 3) * h * 0.07);
		ctx.stroke();
	}

	void cx;
}

// =====================================================================
// SLIDE C — Letter E (drawn 180° rotated to mimic microscope inversion)
// =====================================================================

function drawLetterE(ctx, w, h, mag) {
	const cx = w / 2;
	const cy = h / 2;

	// At 40× total the e should occupy ~35% of the viewport; scales from there.
	const eHeight = (h * 0.35) * (mag / 40);

	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(Math.PI); // microscope inversion — flips top↔bottom AND left↔right
	ctx.fillStyle = '#0a0a0a';
	ctx.font = `bold ${eHeight}px serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	// Lowercase 'e' — the canonical microscope demo: a printed lowercase
	// letter appears UPSIDE DOWN through the eyepiece because the lens
	// system flips the image both vertically AND horizontally.
	ctx.fillText('e', 0, 0);
	ctx.restore();

	// Paper fibres — thin random brown squiggles to sell that this is on
	// a slide and not a digital readout.
	const rng = mulberry32(0x7c91);
	ctx.strokeStyle = 'rgba(120, 100, 80, 0.18)';
	ctx.lineWidth = 1;
	for (let i = 0; i < 60; i++) {
		const x0 = rng() * w;
		const y0 = rng() * h;
		const len = 30 + rng() * 60;
		const ang = rng() * Math.PI * 2;
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
		ctx.stroke();
	}
}

// =====================================================================
// SLIDE D — Plant leaf (recursive vein branching + chloroplast cells)
// =====================================================================

function drawPlantLeaf(ctx, w, h, mag) {
	const cx = w / 2;

	// Background tint: leaf green, brighter at higher mag (more cells visible).
	ctx.fillStyle = 'rgba(120, 180, 90, 0.20)';
	ctx.fillRect(0, 0, w, h);

	// Cell wall mosaic — irregular polygons clustered loosely on a grid.
	// Floor cellSize so low-mag (4×/10×) doesn't generate hundreds of
	// tiny polygons that nuke the framerate. 35 px is the smallest
	// cell we draw — anything tinier is invisible anyway.
	const cellSize = Math.max(35, (50 / 40) * mag);
	const cols = Math.min(20, Math.ceil(w / cellSize) + 2);
	const rows = Math.min(20, Math.ceil(h / cellSize) + 2);
	const rng = mulberry32(0x4321);

	ctx.lineWidth = Math.max(1, cellSize * 0.025);
	for (let r = -1; r < rows; r++) {
		for (let c = -1; c < cols; c++) {
			const x = c * cellSize + (r % 2) * cellSize * 0.5 + rng() * cellSize * 0.15;
			const y = r * cellSize + rng() * cellSize * 0.15;
			ctx.fillStyle = `rgb(${130 + ((r + c) % 4) * 8}, ${190 + ((r * 3 + c) % 4) * 6}, ${100 + ((r + c * 2) % 4) * 8})`;
			ctx.strokeStyle = '#3a6c2a';
			drawIrregularPolygon(ctx, x, y, cellSize * 0.55, 6, rng);
			ctx.fill();
			ctx.stroke();

			// Chloroplasts — small green dots inside the cell. Number scales
			// with magnification (more visible up close).
			const chloroN = Math.min(8, Math.max(2, Math.round(mag / 80)));
			for (let k = 0; k < chloroN; k++) {
				const ang = (k / chloroN) * Math.PI * 2 + rng() * 0.6;
				const dist = cellSize * 0.20;
				const px = x + Math.cos(ang) * dist;
				const py = y + Math.sin(ang) * dist;
				ctx.fillStyle = '#1f6024';
				ctx.beginPath();
				ctx.arc(px, py, cellSize * 0.06, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	// Central vein + recursive branches — only meaningful at lower mags.
	if (mag <= 200) {
		ctx.strokeStyle = '#3a6c2a';
		ctx.lineWidth = Math.max(1, mag * 0.02);
		drawVein(ctx, cx, h + 20, cx, -20, mag * 0.06, 4);
	}
}

function drawVein(ctx, x0, y0, x1, y1, branchLen, depth) {
	ctx.beginPath();
	ctx.moveTo(x0, y0);
	ctx.lineTo(x1, y1);
	ctx.stroke();
	if (depth <= 0) return;

	const steps = 6;
	for (let i = 1; i < steps; i++) {
		const t = i / steps;
		const px = x0 + (x1 - x0) * t;
		const py = y0 + (y1 - y0) * t;
		const angBase = Math.atan2(y1 - y0, x1 - x0);
		// Two branches — one each side.
		for (const sign of [-1, 1]) {
			const ang = angBase + sign * (Math.PI / 3);
			const ex = px + Math.cos(ang) * branchLen;
			const ey = py + Math.sin(ang) * branchLen;
			drawVein(ctx, px, py, ex, ey, branchLen * 0.55, depth - 1);
		}
	}
}

// =====================================================================
// FALLBACK
// =====================================================================

function drawEmpty(ctx, w, h) {
	ctx.fillStyle = '#222';
	ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = '#888';
	ctx.font = '24px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('— слайд тавиагүй —', w / 2, h / 2);
}

// =====================================================================
// HELPERS
// =====================================================================

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function roundedRect(ctx, x, y, w, h, r) {
	r = Math.min(r, w / 2, h / 2);
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawIrregularPolygon(ctx, cx, cy, r, sides, rng) {
	ctx.beginPath();
	for (let i = 0; i < sides; i++) {
		const a = (i / sides) * Math.PI * 2;
		const rad = r * (0.75 + rng() * 0.4);
		const x = cx + Math.cos(a) * rad;
		const y = cy + Math.sin(a) * rad;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

/** Pre-rendered red-blood-cell sprite, keyed by integer radius bucket
 *  so close mag values share the same texture. drawImage stamping is
 *  ~10-50× cheaper than recreating a radial gradient per cell. */
const _bloodCache = new Map();
function getBloodCellSprite(rbcR) {
	// Bucket by 2-px radius so we don't blow up the cache.
	const key = Math.max(2, Math.round(rbcR / 2) * 2);
	let sprite = _bloodCache.get(key);
	if (sprite) return sprite;
	const size = Math.ceil(key * 2.4);
	sprite = document.createElement('canvas');
	sprite.width = size; sprite.height = size;
	const c = sprite.getContext('2d');
	const cx = size / 2;
	const g = c.createRadialGradient(cx, cx, 0, cx, cx, key);
	g.addColorStop(0.00, '#e87a7a');
	g.addColorStop(0.55, '#c63333');
	g.addColorStop(1.00, '#7a1818');
	c.fillStyle = g;
	c.beginPath();
	c.arc(cx, cx, key, 0, Math.PI * 2);
	c.fill();
	_bloodCache.set(key, sprite);
	return sprite;
}

/** Deterministic PRNG — same seed → same sequence. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
