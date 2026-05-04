/**
 * lab-environment.js
 *
 * VR BioLab — Realistic biology laboratory environment
 *
 * Builds a fully procedural school biology laboratory designed for K-12
 * students on Meta Quest 3S. Everything (geometry, textures, posters,
 * labels) is generated in code; no external asset files are loaded.
 *
 * Layout (room is 8m wide × 6m deep × 3m tall, centered at origin):
 *   - North wall (z=-3): main supply cabinets, periodic-table poster
 *   - South wall (z=+3): whiteboard, secondary bench
 *   - East wall  (x=+4): three tall windows (warm daylight)
 *   - West wall  (x=-4): door, safety poster, first-aid kit, clock
 *   - Center: main lab bench at (0.2, *, 0); microscope reservation
 *     square (40×40 cm) is left clear at world (0.2, 0.98, 0).
 *
 * Usage (call once, after PMREMGenerator + RoomEnvironment is set up):
 *
 *   import { createLabEnvironment } from './lab-environment.js';
 *   const lab = createLabEnvironment(scene, renderer);
 *   // lab.room, lab.mainBench, lab.decorGroup, lab.lights are exposed
 *
 * Triangle budget: ~75–95k for the entire room (well under the 150k
 * Quest 3S target). The single most expensive item is the floor tile
 * grid; everything else is sub-1k tris.
 */

import * as THREE from 'three';

import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

// =====================================================================
// HELPERS (exported)
// =====================================================================

/**
 * Build a box geometry with rounded/beveled edges so nothing in the lab
 * has perfectly sharp 90° corners (real-world manufacturing always has
 * some chamfer). Centered on the origin.
 *
 * @param {number} w  width  (X)
 * @param {number} h  height (Y)
 * @param {number} d  depth  (Z)
 * @param {number} bevel  bevel radius in metres
 */
export function beveledBoxGeom(w, h, d, bevel = 0.004) {
	const safeBevel = Math.min(bevel, w / 2 - 0.001, d / 2 - 0.001, h / 2 - 0.001);
	const hw = w / 2 - safeBevel;
	const hd = d / 2 - safeBevel;

	const shape = new THREE.Shape();
	shape.absarc(-hw, -hd, safeBevel, Math.PI, 1.5 * Math.PI, false);
	shape.absarc(hw, -hd, safeBevel, 1.5 * Math.PI, 0, false);
	shape.absarc(hw, hd, safeBevel, 0, 0.5 * Math.PI, false);
	shape.absarc(-hw, hd, safeBevel, 0.5 * Math.PI, Math.PI, false);
	shape.closePath();

	const geom = new THREE.ExtrudeGeometry(shape, {
		depth: h - safeBevel * 2,
		bevelEnabled: true,
		bevelThickness: safeBevel,
		bevelSize: safeBevel,
		bevelSegments: 1,
		curveSegments: 3,
		steps: 1,
	});
	geom.rotateX(-Math.PI / 2);
	geom.translate(0, h / 2, 0);
	geom.center();
	return geom;
}

/**
 * Generate a CanvasTexture by drawing on a 2D canvas. Used for every
 * tile, label, poster, and book cover in the lab.
 *
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} drawFn
 * @param {number} width
 * @param {number} height
 */
export function makeCanvasTexture(drawFn, width = 512, height = 512) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	drawFn(ctx, width, height);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;
}

// =====================================================================
// SMALL UTILITIES (internal)
// =====================================================================

/** Random number in [-amount, +amount]. */
const jitter = (amount) => (Math.random() - 0.5) * 2 * amount;

/** Apply small (±3°) rotational + (±1cm) positional jitter to an object. */
function imperfect(obj, posJitter = 0.01, rotJitter = (3 * Math.PI) / 180) {
	obj.position.x += jitter(posJitter);
	obj.position.z += jitter(posJitter);
	obj.rotation.y += jitter(rotJitter);
}

/**
 * Place an object so its lowest vertex rests exactly on the given Y plane
 * (defaults to the bench surface at 0.98 m). Uses an axis-aligned bounding
 * box to find the local bottom — works for any geometry, regardless of
 * how its origin is anchored. Caller can pre-rotate the object before
 * calling; rotation is honoured by setFromObject.
 */
function restOnBench(obj, x, z, benchY = 0.98) {
	obj.position.set(x, benchY, z);
	obj.updateMatrixWorld(true);
	const bbox = new THREE.Box3().setFromObject(obj);
	obj.position.y += benchY - bbox.min.y;
}

/** Slight HSL shift around a base color, returns a new THREE.Color. */
function shiftedColor(hex, hueShift = 0.02, lightShift = 0.05) {
	const c = new THREE.Color(hex);
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	c.setHSL(
		(hsl.h + jitter(hueShift) + 1) % 1,
		THREE.MathUtils.clamp(hsl.s + jitter(0.05), 0, 1),
		THREE.MathUtils.clamp(hsl.l + jitter(lightShift), 0, 1),
	);
	return c;
}

// =====================================================================
// PROCEDURAL TEXTURES
// =====================================================================

/** Dark slate floor tiles — 60×60 cm pattern with faint cyan veining. */
function createFloorTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = THEME.floorBase;
			ctx.fillRect(0, 0, w, h);

			const baseColor = new THREE.Color(THEME.floorTint);
			const tile = w / 2;
			for (let i = 0; i < 2; i++) {
				for (let j = 0; j < 2; j++) {
					const k = 1 + (Math.random() - 0.5) * 0.12;
					const r = Math.round(baseColor.r * 255 * k);
					const g = Math.round(baseColor.g * 255 * k);
					const b = Math.round(baseColor.b * 255 * k);
					ctx.fillStyle = `rgb(${r},${g},${b})`;
					ctx.fillRect(i * tile + 1, j * tile + 1, tile - 2, tile - 2);
				}
			}

			// Faint cyan veining (subtle holographic shimmer cue)
			ctx.strokeStyle = THEME.floorVein;
			ctx.lineWidth = 1;
			for (let k = 0; k < 80; k++) {
				const x = Math.random() * w;
				const y = Math.random() * h;
				const len = Math.random() * 30 + 10;
				const ang = Math.random() * Math.PI;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
				ctx.stroke();
			}

			// Dark grout
			ctx.strokeStyle = THEME.floorGrout;
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(tile, 0);
			ctx.lineTo(tile, h);
			ctx.moveTo(0, tile);
			ctx.lineTo(w, tile);
			ctx.stroke();

			// Specular speckle (hint of polished surface)
			for (let k = 0; k < 1200; k++) {
				const x = Math.random() * w;
				const y = Math.random() * h;
				ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
				ctx.fillRect(x, y, 1, 1);
			}
		},
		512,
		512,
	);
}

/** Lower-wall steel-blue ceramic dado — 15 cm tile pattern with dark grout. */
function createWallTileTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = THEME.wallDado;
			ctx.fillRect(0, 0, w, h);

			const base = new THREE.Color(THEME.wallDado);
			const cols = 4;
			const rows = 4;
			const tileW = w / cols;
			const tileH = h / rows;

			for (let i = 0; i < cols; i++) {
				for (let j = 0; j < rows; j++) {
					const k = 1 + (Math.random() - 0.5) * 0.16;
					const r = Math.round(base.r * 255 * k);
					const g = Math.round(base.g * 255 * k);
					const b = Math.round(base.b * 255 * k);
					ctx.fillStyle = `rgb(${r},${g},${b})`;
					ctx.fillRect(i * tileW + 1, j * tileH + 1, tileW - 2, tileH - 2);
				}
			}

			ctx.strokeStyle = '#0c1929';
			ctx.lineWidth = 2;
			for (let i = 1; i < cols; i++) {
				ctx.beginPath();
				ctx.moveTo(i * tileW, 0);
				ctx.lineTo(i * tileW, h);
				ctx.stroke();
			}
			for (let j = 1; j < rows; j++) {
				ctx.beginPath();
				ctx.moveTo(0, j * tileH);
				ctx.lineTo(w, j * tileH);
				ctx.stroke();
			}
		},
		512,
		512,
	);
}

/** Paint texture for upper walls — auto-darkens or lightens grain by base value. */
function createWallPaintTexture(baseHex = THEME.wallPaint) {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = baseHex;
			ctx.fillRect(0, 0, w, h);
			// Light walls take dark grain, dark walls take light grain so the
			// noise is visible either way.
			const hsl = { h: 0, s: 0, l: 0 };
			new THREE.Color(baseHex).getHSL(hsl);
			const grainColor = hsl.l < 0.4 ? '255,255,255' : '0,0,0';
			for (let k = 0; k < 4000; k++) {
				const x = Math.random() * w;
				const y = Math.random() * h;
				ctx.fillStyle = `rgba(${grainColor},${Math.random() * 0.04})`;
				ctx.fillRect(x, y, 1, 1);
			}
		},
		256,
		256,
	);
}

/** Suspended ceiling — pale cool panel inset into a very dark T-bar frame. */
function createCeilingTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			// Dark T-bar grid as the canvas background
			ctx.fillStyle = THEME.ceilingTBar;
			ctx.fillRect(0, 0, w, h);
			// Inset cool-tinted tile
			const inset = 8;
			ctx.fillStyle = THEME.ceilingTile;
			ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
			// Subtle speckle on the tile
			for (let k = 0; k < 200; k++) {
				const x = inset + Math.random() * (w - inset * 2);
				const y = inset + Math.random() * (h - inset * 2);
				ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
				ctx.fillRect(x, y, 1, 1);
			}
		},
		256,
		256,
	);
}

/** Soft outdoor sky + blurred building silhouettes for window backdrop. */
function createOutdoorViewTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			const sky = ctx.createLinearGradient(0, 0, 0, h);
			sky.addColorStop(0, '#9bbed8');
			sky.addColorStop(0.6, '#cfdfe7');
			sky.addColorStop(1, '#e8e3d2');
			ctx.fillStyle = sky;
			ctx.fillRect(0, 0, w, h);

			// Distant tree-line / hills
			ctx.fillStyle = 'rgba(110,130,110,0.55)';
			ctx.beginPath();
			ctx.moveTo(0, h * 0.7);
			for (let x = 0; x <= w; x += 16) {
				ctx.lineTo(x, h * 0.7 + Math.sin(x * 0.04) * 12 - Math.random() * 6);
			}
			ctx.lineTo(w, h);
			ctx.lineTo(0, h);
			ctx.closePath();
			ctx.fill();

			// Mid-distance buildings
			ctx.fillStyle = 'rgba(150,150,160,0.55)';
			for (let i = 0; i < 8; i++) {
				const bw = 30 + Math.random() * 60;
				const bh = 60 + Math.random() * 80;
				const bx = (i / 8) * w + jitter(20);
				const by = h * 0.65 - bh;
				ctx.fillRect(bx, by, bw, bh);
				ctx.fillStyle = 'rgba(255,240,180,0.4)';
				for (let r = 0; r < 4; r++) {
					for (let c = 0; c < 3; c++) {
						if (Math.random() < 0.5) {
							ctx.fillRect(bx + 6 + c * 10, by + 8 + r * 14, 6, 8);
						}
					}
				}
				ctx.fillStyle = 'rgba(150,150,160,0.55)';
			}
		},
		512,
		512,
	);
}

/** Reagent-bottle paper label with a fake (Latin-style) chemical name. */
function createReagentLabelTexture(name = 'Solutio Natrii Chloridi') {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#f5efd9';
			ctx.fillRect(0, 0, w, h);
			ctx.strokeStyle = '#94795b';
			ctx.lineWidth = 4;
			ctx.strokeRect(8, 8, w - 16, h - 16);

			ctx.fillStyle = '#3a2a18';
			ctx.font = 'bold 28px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(name, w / 2, 60);

			ctx.font = '20px sans-serif';
			ctx.fillText('Conc. 0.9 % m/V', w / 2, 100);
			ctx.fillText('500 mL', w / 2, 130);

			ctx.font = 'bold 22px sans-serif';
			ctx.fillStyle = '#a32020';
			ctx.fillText('⚠  IRRITANT', w / 2, 175);

			ctx.fillStyle = '#3a2a18';
			ctx.font = '16px sans-serif';
			ctx.fillText('Lot 24-A-117', w / 2, 215);
			ctx.fillText('Indra Cyber Lab', w / 2, 235);
		},
		256,
		256,
	);
}

/** Mongolian-language laboratory safety rules poster. */
function createSafetyPosterTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#fffbe9';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#a32020';
			ctx.fillRect(0, 0, w, 90);
			ctx.fillStyle = '#fffbe9';
			ctx.font = 'bold 36px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('ЛАБОРАТОРИЙН', w / 2, 42);
			ctx.fillText('ЭРҮҮЛ АХУЙН ДҮРЭМ', w / 2, 80);

			ctx.fillStyle = '#1d1d1d';
			ctx.font = '24px sans-serif';
			ctx.textAlign = 'left';
			const rules = [
				'1. Хамгаалалтын нүдний шил заавал зүүх.',
				'2. Цагаан халат, бээлий өмсөх.',
				'3. Хүнсний бүтээгдэхүүн авч ирэхгүй.',
				'4. Реагент үнэрлэхгүй, амтлахгүй.',
				'5. Багшийн зөвшөөрөлгүй туршилт хийхгүй.',
				'6. Гэмтэл гарвал шууд багшид хэлэх.',
				'7. Ажил дууссаны дараа гараа сайтар угаах.',
				'8. Хог хаягдлыг ангилж, зөв хогийн саванд.',
			];
			rules.forEach((r, i) => ctx.fillText(r, 30, 140 + i * 56));

			ctx.fillStyle = '#1d4ea0';
			ctx.font = 'italic 18px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('Indra Cyber School — Биологийн лаб', w / 2, h - 28);
		},
		512,
		768,
	);
}

/** Stylised periodic table — colored groups, generic public-domain layout. */
function createPeriodicTableTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#1c1c1c';
			ctx.fillRect(0, 0, w, h);

			ctx.fillStyle = '#f5f5f5';
			ctx.font = 'bold 30px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('ПЕРИОДЛОГ ХҮСНЭГТ', w / 2, 38);
			ctx.font = '16px sans-serif';
			ctx.fillText('Periodic Table of the Elements', w / 2, 62);

			const cols = 18;
			const rows = 7;
			const padX = 24;
			const padTop = 90;
			const cellW = (w - padX * 2) / cols;
			const cellH = (h - padTop - 110) / rows;

			const groupColor = (col, row) => {
				if (col === 1) return '#e0664a';
				if (col === 2) return '#e0a44a';
				if (col >= 3 && col <= 12) return '#4a8fd0';
				if (col === 13) return '#7e6fd2';
				if (col === 14) return '#5fae7a';
				if (col === 15) return '#5fa4d2';
				if (col === 16) return '#d8628f';
				if (col === 17) return '#d8c64a';
				if (col === 18) return '#7ad1d8';
				if (row === 6 && col >= 3 && col <= 17) return '#d0709e';
				return '#4a8fd0';
			};

			const placed = {
				1: { 1: 'H', 18: 'He' },
				2: { 1: 'Li', 2: 'Be', 13: 'B', 14: 'C', 15: 'N', 16: 'O', 17: 'F', 18: 'Ne' },
				3: { 1: 'Na', 2: 'Mg', 13: 'Al', 14: 'Si', 15: 'P', 16: 'S', 17: 'Cl', 18: 'Ar' },
				4: { 1: 'K', 2: 'Ca', 8: 'Fe', 11: 'Cu', 12: 'Zn', 17: 'Br' },
				5: { 11: 'Ag', 17: 'I' },
				6: { 11: 'Au', 12: 'Hg', 14: 'Pb' },
				7: { 1: 'Fr', 2: 'Ra' },
			};

			for (let r = 1; r <= rows; r++) {
				for (let c = 1; c <= cols; c++) {
					const skip =
						(r === 1 && c > 1 && c < 18) ||
						(r === 2 && c > 2 && c < 13) ||
						(r === 3 && c > 2 && c < 13) ||
						(r === 6 && c === 3) ||
						(r === 7 && c === 3);
					if (skip) continue;

					const x = padX + (c - 1) * cellW;
					const y = padTop + (r - 1) * cellH;
					ctx.fillStyle = groupColor(c, r);
					ctx.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);

					const sym = placed[r] && placed[r][c];
					if (sym) {
						ctx.fillStyle = '#1c1c1c';
						ctx.font = `bold ${Math.floor(cellH * 0.45)}px sans-serif`;
						ctx.textAlign = 'center';
						ctx.fillText(sym, x + cellW / 2, y + cellH * 0.7);
					}
				}
			}

			// Legend swatches
			const legendY = h - 78;
			const legend = [
				['Шүлтлэг металл', '#e0664a'],
				['Шилжилтийн', '#4a8fd0'],
				['Металлоид', '#5fae7a'],
				['Галоген', '#d8c64a'],
				['Эрхэмсэг хий', '#7ad1d8'],
			];
			ctx.font = '14px sans-serif';
			ctx.textAlign = 'left';
			let lx = padX;
			for (const [label, col] of legend) {
				ctx.fillStyle = col;
				ctx.fillRect(lx, legendY, 20, 18);
				ctx.fillStyle = '#f5f5f5';
				ctx.fillText(label, lx + 26, legendY + 14);
				lx += 130;
			}
		},
		1024,
		640,
	);
}

/** A book cover — solid color with a faux title. Vary by seed. */
function createBookCoverTexture(seed = 0) {
	return makeCanvasTexture(
		(ctx, w, h) => {
			const palette = ['#3b5e8c', '#7a3142', '#436c4a', '#2f3a55', '#8a5a2f', '#5d3a6e'];
			const base = palette[seed % palette.length];
			ctx.fillStyle = base;
			ctx.fillRect(0, 0, w, h);

			ctx.strokeStyle = 'rgba(255,255,220,0.4)';
			ctx.lineWidth = 4;
			ctx.strokeRect(12, 12, w - 24, h - 24);

			const titles = [
				'BIOLOGY 101',
				'CELL BASICS',
				'FLORA NOTES',
				'GENETICS',
				'ECOLOGY',
				'ANATOMIA',
			];
			ctx.fillStyle = 'rgba(255,255,220,0.95)';
			ctx.font = 'bold 28px serif';
			ctx.textAlign = 'center';
			ctx.fillText(titles[seed % titles.length], w / 2, h / 2);

			ctx.font = 'italic 14px serif';
			ctx.fillText('vol. ' + ((seed % 4) + 1), w / 2, h / 2 + 30);
		},
		128,
		180,
	);
}

/** Whiteboard surface — near-white with marker-residue streaks. */
function createWhiteboardTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#fafbfa';
			ctx.fillRect(0, 0, w, h);

			// Faint horizontal streaks as if poorly wiped
			for (let i = 0; i < 12; i++) {
				const y = Math.random() * h;
				const grad = ctx.createLinearGradient(0, y, w, y);
				const c = `rgba(${100 + Math.random() * 100},${110 + Math.random() * 80},${130 + Math.random() * 90},0.06)`;
				grad.addColorStop(0, 'rgba(0,0,0,0)');
				grad.addColorStop(0.5, c);
				grad.addColorStop(1, 'rgba(0,0,0,0)');
				ctx.fillStyle = grad;
				ctx.fillRect(0, y, w, 18);
			}

			// Ghost of a previous diagram
			ctx.strokeStyle = 'rgba(40,80,140,0.18)';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.ellipse(w * 0.32, h * 0.45, 70, 50, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(w * 0.32 + 70, h * 0.45);
			ctx.lineTo(w * 0.55, h * 0.45);
			ctx.stroke();

			ctx.font = '36px sans-serif';
			ctx.fillStyle = 'rgba(40,80,140,0.18)';
			ctx.fillText('Эс', w * 0.55, h * 0.45);
		},
		1024,
		512,
	);
}

/** Wall clock face — drawn with hands at the supplied time (default 10:25). */
function createClockFaceTexture(hour = 10, minute = 25) {
	return makeCanvasTexture(
		(ctx, w, h) => {
			const cx = w / 2;
			const cy = h / 2;
			const r = w / 2 - 6;

			ctx.fillStyle = '#fafafa';
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = '#1f1f1f';
			ctx.lineWidth = 6;
			ctx.stroke();

			// Hour ticks
			ctx.strokeStyle = '#1f1f1f';
			for (let i = 0; i < 12; i++) {
				const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
				const x1 = cx + Math.cos(a) * (r - 4);
				const y1 = cy + Math.sin(a) * (r - 4);
				const x2 = cx + Math.cos(a) * (r - 22);
				const y2 = cy + Math.sin(a) * (r - 22);
				ctx.lineWidth = i % 3 === 0 ? 6 : 3;
				ctx.beginPath();
				ctx.moveTo(x1, y1);
				ctx.lineTo(x2, y2);
				ctx.stroke();
			}

			// Hour hand
			const hourAng = ((hour % 12) / 12 + minute / 720) * Math.PI * 2 - Math.PI / 2;
			ctx.strokeStyle = '#1f1f1f';
			ctx.lineWidth = 10;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + Math.cos(hourAng) * r * 0.5, cy + Math.sin(hourAng) * r * 0.5);
			ctx.stroke();

			// Minute hand
			const minAng = (minute / 60) * Math.PI * 2 - Math.PI / 2;
			ctx.lineWidth = 6;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + Math.cos(minAng) * r * 0.78, cy + Math.sin(minAng) * r * 0.78);
			ctx.stroke();

			// Center cap
			ctx.fillStyle = '#a32020';
			ctx.beginPath();
			ctx.arc(cx, cy, 8, 0, Math.PI * 2);
			ctx.fill();
		},
		256,
		256,
	);
}

/** Glove-box cardboard side label. */
function createGloveBoxLabelTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#15407a';
			ctx.fillRect(0, 0, w, h);

			ctx.fillStyle = '#fafafa';
			ctx.font = 'bold 36px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('NITRILE', w / 2, 60);
			ctx.fillText('GLOVES', w / 2, 100);

			ctx.font = '20px sans-serif';
			ctx.fillText('Powder-Free  •  Size M', w / 2, 140);
			ctx.fillText('100 pcs', w / 2, 170);

			ctx.strokeStyle = '#fafafa';
			ctx.lineWidth = 3;
			ctx.strokeRect(20, 20, w - 40, h - 40);
		},
		256,
		200,
	);
}

/** Plain notebook cover with hand-written-style title. */
function createNotebookCoverTexture() {
	return makeCanvasTexture(
		(ctx, w, h) => {
			ctx.fillStyle = '#1d2a1f';
			ctx.fillRect(0, 0, w, h);

			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.lineWidth = 2;
			ctx.strokeRect(20, 20, w - 40, h - 40);

			ctx.fillStyle = '#f4ecd2';
			ctx.fillRect(40, 60, w - 80, 80);

			ctx.fillStyle = '#1d2a1f';
			ctx.font = 'italic 22px serif';
			ctx.textAlign = 'center';
			ctx.fillText('Lab Notebook', w / 2, 110);
			ctx.font = '16px serif';
			ctx.fillText('Биологийн дэвтэр', w / 2, 132);
		},
		256,
		256,
	);
}

// =====================================================================
// SHARED MATERIAL FACTORIES
// =====================================================================

/** Premium polished material (sink, glassware caps, bottle bodies). */
function metalMaterial(color = 0xc8cdd2) {
	return new THREE.MeshPhysicalMaterial({
		color,
		metalness: 0.9,
		roughness: 0.25,
		envMapIntensity: 1.2,
	});
}

/** Generic painted-metal / lacquer (lamp arms, stool frame, fixtures). */
function paintedMetalMaterial(color = 0x2c2c2e) {
	return new THREE.MeshStandardMaterial({
		color,
		metalness: 0.5,
		roughness: 0.45,
		envMapIntensity: 1.0,
	});
}

/** Glass body for beakers, bottles, faucet knobs.
 *  PERF: transmission/refraction has been removed. Each transmissive object
 *  costs ~1-3 ms on Quest 3S because it triggers a screen-space refraction
 *  pass. We get a passable glass look from low opacity + high envMapIntensity
 *  reflection alone — much cheaper. */
function glassMaterial(tintHex = 0xeaf3ff) {
	return new THREE.MeshStandardMaterial({
		color: tintHex,
		metalness: 0,
		roughness: 0.10,
		transparent: true,
		opacity: 0.30,
		envMapIntensity: 1.6,
		side: THREE.DoubleSide,
	});
}

/** Matte plastic / cardboard / paper. */
function matteMaterial(color = 0xdedede) {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.85,
		metalness: 0,
		envMapIntensity: 1.0,
	});
}

// =====================================================================
// ROOM SHELL
// =====================================================================

/**
 * Room dimensions (constants reused across builders).
 * Origin sits in the centre of the room; floor is y=0.
 */
const ROOM = { w: 8, d: 6, h: 3 };

/**
 * Cyber-night STEAM lab palette. Every texture, material and light
 * factory below reads from THEME, so the colour scheme can be retuned
 * from one place. Hex strings are kept as strings (used by canvas
 * fillStyle / strokeStyle) and converted to numbers when needed.
 */
const THEME = Object.freeze({
	wallPaint:    '#0F1B2D', // deep navy
	wallDado:     '#1E3A5F', // steel-blue ceramic dado
	floorBase:    '#1A2638', // dark slate base under tiles
	floorTint:    '#243349', // per-tile colour
	floorVein:    'rgba(0, 220, 200, 0.06)', // faint cyan veining
	floorGrout:   '#0c121b',
	ceilingTBar:  '#0a1422', // very dark T-bar grid
	ceilingTile:  '#cdd5e3', // pale cool panel (so fluorescents still read white)
	cabinetBody:  '#1E3A5F', // steel-blue cabinet body
	cabinetDoor:  '#27466e', // slightly lighter doors
	benchTop:     '#7d828a', // medium gray lab bench top
	benchEdge:    '#cfd6df', // edge tint
	accentCyan:   '#00E5C7', // strip lighting
	accentBlue:   '#4A90E2', // periodic table holographic glow
	hazeColor:    '#0F1B2D', // exponential fog (matches walls)
});

/** Convert a "#rrggbb" string to the THREE.js numeric form. */
function hexToInt(hex) {
	return parseInt(hex.slice(1), 16);
}

/** Tile floor (8×6 m) with grout pattern. */
function buildFloor() {
	const tex = createFloorTexture();
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(ROOM.w / 1.2, ROOM.d / 1.2);

	const mat = new THREE.MeshPhysicalMaterial({
		map: tex,
		roughness: 0.55,
		metalness: 0,
		clearcoat: 0.25,
		clearcoatRoughness: 0.5,
		envMapIntensity: 1.1,
	});
	const geom = new THREE.PlaneGeometry(ROOM.w, ROOM.d);
	const mesh = new THREE.Mesh(geom, mat);
	mesh.rotation.x = -Math.PI / 2;
	mesh.receiveShadow = true;
	mesh.name = 'LabFloor';
	return mesh;
}

/** Single wall — paint top with ceramic-tile dado on bottom 1.2 m. */
function buildWall(width, height, paintTex, tileTex, name) {
	const group = new THREE.Group();
	group.name = name;

	const dado = 1.2;

	const tileGeom = new THREE.PlaneGeometry(width, dado);
	const tileMatTex = tileTex.clone();
	tileMatTex.wrapS = tileMatTex.wrapT = THREE.RepeatWrapping;
	tileMatTex.repeat.set(width / 0.6, dado / 0.6);
	tileMatTex.needsUpdate = true;
	const tileMat = new THREE.MeshStandardMaterial({
		map: tileMatTex,
		roughness: 0.35,
		envMapIntensity: 1.1,
	});
	const tileMesh = new THREE.Mesh(tileGeom, tileMat);
	tileMesh.position.y = dado / 2;
	tileMesh.receiveShadow = true;
	tileMesh.name = `${name}_LowerTile`;
	group.add(tileMesh);

	const paintGeom = new THREE.PlaneGeometry(width, height - dado);
	const paintMatTex = paintTex.clone();
	paintMatTex.wrapS = paintMatTex.wrapT = THREE.RepeatWrapping;
	paintMatTex.repeat.set(width / 1.6, (height - dado) / 1.6);
	paintMatTex.needsUpdate = true;
	const paintMat = new THREE.MeshStandardMaterial({
		map: paintMatTex,
		roughness: 0.85,
		envMapIntensity: 0.9,
	});
	const paintMesh = new THREE.Mesh(paintGeom, paintMat);
	paintMesh.position.y = dado + (height - dado) / 2;
	paintMesh.receiveShadow = true;
	paintMesh.name = `${name}_Paint`;
	group.add(paintMesh);

	// Tile-to-paint trim
	const trimGeom = beveledBoxGeom(width, 0.02, 0.01, 0.002);
	const trimMat = matteMaterial(0xe7e7e2);
	const trim = new THREE.Mesh(trimGeom, trimMat);
	trim.position.y = dado + 0.005;
	trim.position.z = 0.005;
	trim.name = `${name}_Trim`;
	group.add(trim);

	// Baseboard at the bottom
	const baseGeom = beveledBoxGeom(width, 0.08, 0.012, 0.003);
	const baseMat = matteMaterial(0x3c3a36);
	const baseboard = new THREE.Mesh(baseGeom, baseMat);
	baseboard.position.y = 0.04;
	baseboard.position.z = 0.006;
	baseboard.name = `${name}_Baseboard`;
	group.add(baseboard);

	return group;
}

/** Build all four walls of the room. */
function buildWalls() {
	const group = new THREE.Group();
	group.name = 'Walls';

	const paint = createWallPaintTexture(THEME.wallPaint);
	const tile = createWallTileTexture();

	// North wall (z = -ROOM.d/2), faces +Z
	const nw = buildWall(ROOM.w, ROOM.h, paint, tile, 'Wall_North');
	nw.position.set(0, 0, -ROOM.d / 2 + 0.001);
	group.add(nw);

	// South wall (z = +ROOM.d/2), faces -Z
	const sw = buildWall(ROOM.w, ROOM.h, paint, tile, 'Wall_South');
	sw.position.set(0, 0, ROOM.d / 2 - 0.001);
	sw.rotation.y = Math.PI;
	group.add(sw);

	// East wall (x = +ROOM.w/2), faces -X
	const ew = buildWall(ROOM.d, ROOM.h, paint, tile, 'Wall_East');
	ew.position.set(ROOM.w / 2 - 0.001, 0, 0);
	ew.rotation.y = -Math.PI / 2;
	group.add(ew);

	// West wall (x = -ROOM.w/2), faces +X
	const ww = buildWall(ROOM.d, ROOM.h, paint, tile, 'Wall_West');
	ww.position.set(-ROOM.w / 2 + 0.001, 0, 0);
	ww.rotation.y = Math.PI / 2;
	group.add(ww);

	return group;
}

/** Suspended ceiling with 60 cm panel grid + 3 fluorescent fixtures. */
function buildCeiling() {
	const group = new THREE.Group();
	group.name = 'Ceiling';

	const tex = createCeilingTexture();
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(ROOM.w / 0.6, ROOM.d / 0.6);

	const mat = new THREE.MeshStandardMaterial({
		map: tex,
		roughness: 0.85,
		envMapIntensity: 0.7,
		side: THREE.DoubleSide,
	});
	const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), mat);
	ceiling.rotation.x = Math.PI / 2;
	ceiling.position.y = ROOM.h;
	ceiling.name = 'Ceiling_Panels';
	group.add(ceiling);

	// 3 fluorescent fixtures — cool-white diffusers in dark frames
	const fixtureMat = new THREE.MeshStandardMaterial({
		color: 0xeaf4ff,
		emissive: 0xffffff,
		emissiveIntensity: 0.55,
		roughness: 0.95,
		envMapIntensity: 0.3,
	});
	const fixtureFrame = paintedMetalMaterial(0x1a2638);

	for (let i = 0; i < 3; i++) {
		const x = (i - 1) * 2.5;
		const frameGeom = beveledBoxGeom(1.25, 0.08, 0.42, 0.005);
		const frame = new THREE.Mesh(frameGeom, fixtureFrame);
		frame.position.set(x, ROOM.h - 0.04, 0);
		frame.name = `CeilingFixture_${i + 1}`;
		group.add(frame);

		const diff = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.36), fixtureMat);
		diff.rotation.x = Math.PI / 2;
		diff.position.set(x, ROOM.h - 0.081, 0);
		diff.name = `CeilingFixture_Diffuser_${i + 1}`;
		group.add(diff);
	}

	return group;
}

/** Door on the west wall. */
function buildDoor() {
	const group = new THREE.Group();
	group.name = 'Door';

	const frameMat = matteMaterial(0x6b5840);
	const doorMat = new THREE.MeshStandardMaterial({
		color: 0xcec3a8,
		roughness: 0.7,
		envMapIntensity: 0.8,
	});

	const frame = new THREE.Mesh(beveledBoxGeom(1.0, 2.1, 0.05, 0.005), frameMat);
	frame.position.set(0, 1.05, 0);
	group.add(frame);

	const door = new THREE.Mesh(beveledBoxGeom(0.9, 2.0, 0.04, 0.004), doorMat);
	door.position.set(-0.02, 1.0, 0.025);
	door.name = 'Door_Panel';
	group.add(door);

	const handle = new THREE.Mesh(
		new THREE.CylinderGeometry(0.015, 0.015, 0.12, 16),
		metalMaterial(0xb7b9bb),
	);
	handle.rotation.z = Math.PI / 2;
	handle.position.set(0.32, 1.0, 0.06);
	handle.name = 'Door_Handle';
	group.add(handle);

	// Position the whole door group on the west wall
	group.position.set(-ROOM.w / 2 + 0.03, 0, -1.6);
	group.rotation.y = Math.PI / 2;
	return group;
}

/** Three tall windows on the east wall, each backed by an outdoor view. */
function buildWindows() {
	const group = new THREE.Group();
	group.name = 'Windows';

	const frameMat = matteMaterial(0x4d4842);
	const sillMat = matteMaterial(0xe8e3d4);
	const outdoorTex = createOutdoorViewTexture();
	const outdoorMat = new THREE.MeshBasicMaterial({ map: outdoorTex });

	for (let i = 0; i < 3; i++) {
		const z = -1.8 + i * 1.8;
		const winGroup = new THREE.Group();
		winGroup.name = `Window_${i + 1}`;

		// Outer frame
		const frame = new THREE.Mesh(beveledBoxGeom(0.04, 1.6, 1.2, 0.003), frameMat);
		frame.position.set(0, 1.85, 0);
		winGroup.add(frame);

		// Glass pane (slightly bluish) — opacity-only, no transmission (perf)
		const glass = new THREE.Mesh(
			new THREE.PlaneGeometry(1.15, 1.55),
			new THREE.MeshStandardMaterial({
				color: 0xeaf2f7,
				roughness: 0.10,
				transparent: true,
				opacity: 0.25,
				envMapIntensity: 1.4,
				side: THREE.DoubleSide,
			}),
		);
		glass.rotation.y = Math.PI / 2;
		glass.position.set(0.005, 1.85, 0);
		winGroup.add(glass);

		// Cross mullions
		const mullV = new THREE.Mesh(beveledBoxGeom(0.05, 1.6, 0.04, 0.002), frameMat);
		mullV.position.set(0, 1.85, 0);
		winGroup.add(mullV);
		const mullH = new THREE.Mesh(beveledBoxGeom(0.05, 0.04, 1.2, 0.002), frameMat);
		mullH.position.set(0, 1.85, 0);
		winGroup.add(mullH);

		// Outdoor backdrop (placed slightly outside the window)
		const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), outdoorMat);
		backdrop.rotation.y = -Math.PI / 2;
		backdrop.position.set(0.5, 1.85, 0);
		winGroup.add(backdrop);

		// Sill
		const sill = new THREE.Mesh(beveledBoxGeom(0.18, 0.05, 1.3, 0.005), sillMat);
		sill.position.set(-0.03, 1.05, 0);
		winGroup.add(sill);

		winGroup.position.set(ROOM.w / 2 - 0.05, 0, z);
		group.add(winGroup);
	}

	return group;
}

// =====================================================================
// MAIN BENCH + SINK
// =====================================================================

/** The big lab bench (2.4 × 0.75 m) including under-bench cabinets. */
function buildMainBench() {
	const group = new THREE.Group();
	group.name = 'MainBench';

	const benchW = 2.4;
	const benchD = 0.75;
	const surfaceY = 0.98;
	const topThickness = 0.04;

	// Bench top — black epoxy resin look. Includes a 30×30 cm sink hole on
	// the right end (centered around X = +1.0 in bench-local space).
	const sinkLocalX = 1.0;
	const sinkHalf = 0.15;

	const topShape = new THREE.Shape();
	topShape.moveTo(-benchW / 2, -benchD / 2);
	topShape.lineTo(benchW / 2, -benchD / 2);
	topShape.lineTo(benchW / 2, benchD / 2);
	topShape.lineTo(-benchW / 2, benchD / 2);
	topShape.closePath();

	const sinkHole = new THREE.Path();
	sinkHole.moveTo(sinkLocalX - sinkHalf, -sinkHalf);
	sinkHole.lineTo(sinkLocalX + sinkHalf, -sinkHalf);
	sinkHole.lineTo(sinkLocalX + sinkHalf, sinkHalf);
	sinkHole.lineTo(sinkLocalX - sinkHalf, sinkHalf);
	sinkHole.closePath();
	topShape.holes.push(sinkHole);

	const topGeom = new THREE.ExtrudeGeometry(topShape, {
		depth: topThickness,
		bevelEnabled: true,
		bevelThickness: 0.005,
		bevelSize: 0.005,
		bevelSegments: 1,
		curveSegments: 1,
	});
	topGeom.rotateX(-Math.PI / 2);
	// Shift so the TOP of the plate (not the bottom) lands at surfaceY.
	// Without this, items placed at y=surfaceY sat 4 cm below the visible
	// surface — sunk into the bench top.
	topGeom.translate(0, surfaceY - topThickness, 0);
	// White epoxy bench top — clearcoat dropped (PERF). The high
	// envMapIntensity + low roughness still gives a glossy reflective look
	// from the room HDRI without the second specular pass clearcoat costs.
	const topMat = new THREE.MeshStandardMaterial({
		color: hexToInt(THEME.benchTop),
		roughness: 0.22,
		metalness: 0.05,
		envMapIntensity: 1.6,
	});
	const top = new THREE.Mesh(topGeom, topMat);
	top.receiveShadow = true;
	top.name = 'MainBench_Top';
	group.add(top);

	// Cabinet body under the bench — steel-blue painted lacquer.
	// PERF: switched MeshPhysical→Standard, dropped clearcoat (cabinets are
	// background; metalness alone gives enough sheen).
	const cabH = surfaceY - topThickness - 0.02;
	const cabinetBodyMat = new THREE.MeshStandardMaterial({
		color: hexToInt(THEME.cabinetBody),
		metalness: 0.30,
		roughness: 0.55,
		envMapIntensity: 1.0,
	});
	const cabBody = new THREE.Mesh(
		beveledBoxGeom(benchW - 0.04, cabH, benchD - 0.04, 0.005),
		cabinetBodyMat,
	);
	cabBody.position.set(0, cabH / 2, 0);
	cabBody.castShadow = true;
	cabBody.receiveShadow = true;
	cabBody.name = 'MainBench_Cabinet';
	group.add(cabBody);

	// 3 cabinet doors on the front face
	const doorW = (benchW - 0.1) / 3;
	const doorH = cabH - 0.08;
	// PERF: dropped clearcoat — metalness 0.4 + low roughness already gives
	// a clean steel-blue sheen and cuts ~10% fragment cost per door.
	const cabinetDoorMat = new THREE.MeshStandardMaterial({
		color: hexToInt(THEME.cabinetDoor),
		metalness: 0.35,
		roughness: 0.50,
		envMapIntensity: 1.0,
	});
	for (let i = 0; i < 3; i++) {
		const door = new THREE.Mesh(
			beveledBoxGeom(doorW - 0.02, doorH, 0.018, 0.003),
			cabinetDoorMat,
		);
		const x = -benchW / 2 + 0.05 + doorW / 2 + i * doorW;
		door.position.set(x, cabH / 2, benchD / 2 - 0.02);
		door.name = `MainBench_Door_${i + 1}`;
		group.add(door);

		const handle = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12),
			metalMaterial(0xb6b9bd),
		);
		handle.rotation.z = Math.PI / 2;
		handle.position.set(x + doorW / 2 - 0.06, cabH / 2 + 0.18, benchD / 2 - 0.005);
		group.add(handle);
	}

	// Toe-kick at the floor — very dark to recede into the dim slate floor
	const kick = new THREE.Mesh(
		beveledBoxGeom(benchW - 0.04, 0.05, 0.02, 0.002),
		matteMaterial(hexToInt(THEME.ceilingTBar)),
	);
	kick.position.set(0, 0.025, benchD / 2 - 0.04);
	group.add(kick);

	// Sink basin (5 walls inserted into the cutout)
	const basinDepth = 0.18;
	const basinMat = metalMaterial(0xc4c8cc);
	const basinFloor = new THREE.Mesh(
		new THREE.BoxGeometry(2 * sinkHalf - 0.01, 0.005, 2 * sinkHalf - 0.01),
		basinMat,
	);
	basinFloor.position.set(sinkLocalX, surfaceY - basinDepth, 0);
	group.add(basinFloor);
	for (const [dx, dz, sx, sz] of [
		[sinkHalf, 0, 0.005, 2 * sinkHalf],
		[-sinkHalf, 0, 0.005, 2 * sinkHalf],
		[0, sinkHalf, 2 * sinkHalf, 0.005],
		[0, -sinkHalf, 2 * sinkHalf, 0.005],
	]) {
		const wall = new THREE.Mesh(
			new THREE.BoxGeometry(sx, basinDepth, sz),
			basinMat,
		);
		wall.position.set(sinkLocalX + dx, surfaceY - basinDepth / 2, dz);
		group.add(wall);
	}

	// Drain ring
	const drain = new THREE.Mesh(
		new THREE.CylinderGeometry(0.03, 0.03, 0.005, 24),
		metalMaterial(0x6c6e72),
	);
	drain.position.set(sinkLocalX, surfaceY - basinDepth + 0.003, 0);
	group.add(drain);

	// Position the whole bench at world (0.2, 0, 0) per spec
	group.position.set(0.2, 0, 0);
	return group;
}

/** Stainless-steel gooseneck faucet. */
function buildFaucet(parentGroup) {
	const group = new THREE.Group();
	group.name = 'Sink_Faucet';

	const steel = metalMaterial(0xd0d4d8);

	// Base flange
	const base = new THREE.Mesh(
		new THREE.CylinderGeometry(0.04, 0.045, 0.02, 32),
		steel,
	);
	base.position.set(1.0, 1.0, -0.18);
	group.add(base);

	// Vertical column
	const column = new THREE.Mesh(
		new THREE.CylinderGeometry(0.02, 0.022, 0.18, 32),
		steel,
	);
	column.position.set(1.0, 1.1, -0.18);
	group.add(column);

	// Gooseneck arc — TubeGeometry along a Bezier-like curve
	const curve = new THREE.CatmullRomCurve3(
		[
			new THREE.Vector3(1.0, 1.19, -0.18),
			new THREE.Vector3(1.0, 1.32, -0.16),
			new THREE.Vector3(1.0, 1.36, -0.10),
			new THREE.Vector3(1.0, 1.32, -0.04),
			new THREE.Vector3(1.0, 1.22, -0.02),
		],
		false,
		'catmullrom',
		0.6,
	);
	const goose = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.018, 32, false), steel);
	goose.name = 'Sink_Faucet_Gooseneck';
	group.add(goose);

	// Spout aerator
	const aerator = new THREE.Mesh(
		new THREE.CylinderGeometry(0.022, 0.020, 0.025, 24),
		steel,
	);
	aerator.position.set(1.0, 1.21, -0.02);
	group.add(aerator);

	// Two handles (hot/cold)
	for (const dx of [-0.07, 0.07]) {
		const hbase = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.028, 0.015, 24),
			steel,
		);
		hbase.position.set(1.0 + dx, 1.0, -0.18);
		group.add(hbase);
		const hknob = new THREE.Mesh(
			new THREE.CylinderGeometry(0.022, 0.022, 0.035, 16),
			glassMaterial(dx < 0 ? 0xd4544c : 0x4ca6d4),
		);
		hknob.position.set(1.0 + dx, 1.025, -0.18);
		group.add(hknob);
	}

	parentGroup.add(group);
	return group;
}

// =====================================================================
// IMMEDIATE-AREA DECOR
// =====================================================================

/** Wire-frame metal rack with 6 glass test tubes. */
function makeTestTubeRack() {
	const group = new THREE.Group();
	group.name = 'TestTubeRack';

	const wire = paintedMetalMaterial(0xc0c4c8);
	const glass = glassMaterial(0xd6e6df);

	// Base
	const base = new THREE.Mesh(beveledBoxGeom(0.22, 0.012, 0.06, 0.002), wire);
	group.add(base);
	// Two vertical posts at each end
	for (const dx of [-0.1, 0.1]) {
		for (const dz of [-0.022, 0.022]) {
			const post = new THREE.Mesh(
				new THREE.CylinderGeometry(0.003, 0.003, 0.10, 8),
				wire,
			);
			post.position.set(dx, 0.058, dz);
			group.add(post);
		}
	}
	// Top rail with 6 holes (just a slim bar with 5 short connectors)
	const rail = new THREE.Mesh(beveledBoxGeom(0.22, 0.008, 0.06, 0.002), wire);
	rail.position.y = 0.108;
	group.add(rail);

	// 6 test tubes
	for (let i = 0; i < 6; i++) {
		const x = -0.085 + i * 0.034;
		const tube = new THREE.Group();

		const body = new THREE.Mesh(
			new THREE.CylinderGeometry(0.012, 0.012, 0.10, 16, 1, true),
			glass,
		);
		body.position.y = 0;
		tube.add(body);

		// Rounded bottom
		const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 8), glass);
		bottom.position.y = -0.05;
		bottom.scale.y = 0.6;
		tube.add(bottom);

		// Liquid (random color/level for some tubes) — opacity-only (perf)
		if (i % 2 === 0) {
			const liquidH = 0.04 + Math.random() * 0.03;
			const liquid = new THREE.Mesh(
				new THREE.CylinderGeometry(0.011, 0.011, liquidH, 16),
				new THREE.MeshStandardMaterial({
					color: shiftedColor(0x8acdc0),
					roughness: 0.25,
					transparent: true,
					opacity: 0.85,
					envMapIntensity: 0.9,
				}),
			);
			liquid.position.y = -0.045 + liquidH / 2;
			tube.add(liquid);
		}

		tube.position.set(x, 0.06, 0);
		group.add(tube);
	}

	return group;
}

/**
 * Glass beaker.
 * @param {number} volumeMl  — affects size; 250 or 500 typical
 */
function makeBeaker(volumeMl = 250) {
	const group = new THREE.Group();
	group.name = `Beaker_${volumeMl}ml`;

	const r = volumeMl >= 500 ? 0.045 : 0.034;
	const h = volumeMl >= 500 ? 0.11 : 0.085;
	const glass = glassMaterial(0xeaf2ff);

	const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), glass);
	body.position.y = h / 2;
	group.add(body);

	const bottom = new THREE.Mesh(
		new THREE.CylinderGeometry(r * 0.99, r * 0.99, 0.005, 32),
		glass,
	);
	bottom.position.y = 0.0025;
	group.add(bottom);

	// Spout — small notch on the rim (use a small triangular wedge box)
	const spout = new THREE.Mesh(
		new THREE.ConeGeometry(0.012, 0.015, 8, 1, true, 0, Math.PI),
		glass,
	);
	spout.rotation.z = Math.PI / 2;
	spout.position.set(r, h - 0.005, 0);
	group.add(spout);

	// Volume markings (dark thin lines via canvas)
	const labelTex = makeCanvasTexture(
		(ctx, w, hC) => {
			ctx.clearRect(0, 0, w, hC);
			ctx.fillStyle = 'rgba(40,40,40,0.85)';
			ctx.font = 'bold 26px sans-serif';
			ctx.textAlign = 'left';
			const total = volumeMl;
			const steps = 5;
			for (let i = 1; i <= steps; i++) {
				const y = hC - (i / (steps + 1)) * hC;
				ctx.fillRect(20, y, 50, 3);
				ctx.fillText(`${Math.round((i / steps) * total)}`, 80, y + 9);
			}
			ctx.font = 'bold 32px sans-serif';
			ctx.fillText(`${total} mL`, 20, hC * 0.92);
		},
		256,
		256,
	);
	const labelMat = new THREE.MeshBasicMaterial({
		map: labelTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const label = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.6, h * 0.9), labelMat);
	label.position.set(0, h / 2, r + 0.001);
	group.add(label);

	// A small amount of liquid for visual interest (250 only) — opacity-only
	if (volumeMl === 250) {
		const lvl = h * 0.45;
		const liquid = new THREE.Mesh(
			new THREE.CylinderGeometry(r * 0.97, r * 0.97, lvl, 32),
			new THREE.MeshStandardMaterial({
				color: 0xb0d3a8,
				roughness: 0.18,
				transparent: true,
				opacity: 0.85,
				envMapIntensity: 0.9,
			}),
		);
		liquid.position.y = lvl / 2 + 0.002;
		group.add(liquid);
	}

	return group;
}

/** Brown reagent bottle with a paper label. */
function makeReagentBottle(label = 'Solutio Natrii Chloridi') {
	const group = new THREE.Group();
	group.name = 'ReagentBottle';

	const bodyR = 0.04;
	const bodyH = 0.13;
	// Brown amber glass — opaque enough that we don't need transmission (perf)
	const bodyMat = new THREE.MeshStandardMaterial({
		color: 0x5a3d1f,
		roughness: 0.30,
		metalness: 0.05,
		envMapIntensity: 1.1,
	});
	const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR, bodyH, 32), bodyMat);
	body.position.y = bodyH / 2;
	group.add(body);

	const neck = new THREE.Mesh(
		new THREE.CylinderGeometry(0.018, 0.022, 0.02, 24),
		bodyMat,
	);
	neck.position.y = bodyH + 0.01;
	group.add(neck);

	const cap = new THREE.Mesh(
		new THREE.CylinderGeometry(0.022, 0.022, 0.022, 24),
		paintedMetalMaterial(0x111111),
	);
	cap.position.y = bodyH + 0.031;
	group.add(cap);

	// Paper label wraps around the front
	const labelTex = createReagentLabelTexture(label);
	const labelMat = new THREE.MeshStandardMaterial({
		map: labelTex,
		roughness: 0.95,
		side: THREE.DoubleSide,
	});
	const labelMesh = new THREE.Mesh(
		new THREE.CylinderGeometry(bodyR + 0.0005, bodyR + 0.0005, bodyH * 0.65, 32, 1, true, -0.9, 1.8),
		labelMat,
	);
	labelMesh.position.y = bodyH * 0.45;
	group.add(labelMesh);

	return group;
}

/** Open box of nitrile gloves, blue cardboard. */
function makeGloveBox() {
	const group = new THREE.Group();
	group.name = 'GloveBox';

	const w = 0.22, h = 0.13, d = 0.12;
	const cardboard = matteMaterial(0x15407a);
	const body = new THREE.Mesh(beveledBoxGeom(w, h, d, 0.004), cardboard);
	body.position.y = h / 2;
	group.add(body);

	// Label on the front
	const labelTex = createGloveBoxLabelTexture();
	const front = new THREE.Mesh(
		new THREE.PlaneGeometry(w - 0.01, h - 0.02),
		new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85 }),
	);
	front.position.set(0, h / 2, d / 2 + 0.001);
	group.add(front);

	// Oval cutout on top with a bit of glove fabric peeking out
	const cutout = new THREE.Mesh(
		new THREE.PlaneGeometry(w * 0.55, d * 0.4),
		matteMaterial(0x0d2a4d),
	);
	cutout.rotation.x = -Math.PI / 2;
	cutout.position.set(0, h + 0.001, 0);
	group.add(cutout);

	const peek = new THREE.Mesh(
		new THREE.SphereGeometry(0.025, 16, 8),
		matteMaterial(0x6f7fc4),
	);
	peek.scale.set(1, 0.4, 0.6);
	peek.position.set(0.02, h + 0.005, 0);
	group.add(peek);

	return group;
}

/** Wall-mounted paper towel holder with a partial roll. */
function makePaperTowelHolder() {
	const group = new THREE.Group();
	group.name = 'PaperTowelHolder';

	const bracket = paintedMetalMaterial(0xb8b8b8);
	for (const dx of [-0.13, 0.13]) {
		const arm = new THREE.Mesh(beveledBoxGeom(0.04, 0.04, 0.18, 0.003), bracket);
		arm.position.set(dx, 0, 0);
		group.add(arm);
	}

	const rod = new THREE.Mesh(
		new THREE.CylinderGeometry(0.012, 0.012, 0.32, 16),
		bracket,
	);
	rod.rotation.z = Math.PI / 2;
	group.add(rod);

	const roll = new THREE.Mesh(
		new THREE.CylinderGeometry(0.06, 0.06, 0.24, 24),
		new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 1, envMapIntensity: 0.7 }),
	);
	roll.rotation.z = Math.PI / 2;
	group.add(roll);

	// Hanging sheet
	const sheet = new THREE.Mesh(
		new THREE.PlaneGeometry(0.22, 0.16),
		new THREE.MeshStandardMaterial({
			color: 0xfaf3e2,
			roughness: 1,
			side: THREE.DoubleSide,
		}),
	);
	sheet.position.set(0, -0.13, 0.06);
	sheet.rotation.x = -0.1;
	group.add(sheet);

	return group;
}

/** Small pedal-less trash bin. */
function makeTrashBin() {
	const group = new THREE.Group();
	group.name = 'TrashBin';

	const mat = matteMaterial(0x808488);
	const body = new THREE.Mesh(
		new THREE.CylinderGeometry(0.16, 0.13, 0.42, 24, 1, true),
		mat,
	);
	body.position.y = 0.21;
	group.add(body);

	const bottom = new THREE.Mesh(
		new THREE.CylinderGeometry(0.13, 0.13, 0.005, 24),
		mat,
	);
	bottom.position.y = 0.005;
	group.add(bottom);

	const rim = new THREE.Mesh(
		new THREE.TorusGeometry(0.16, 0.012, 8, 24),
		paintedMetalMaterial(0x4d4d4f),
	);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = 0.42;
	group.add(rim);

	// Black bin liner peeking over the top
	const liner = new THREE.Mesh(
		new THREE.CylinderGeometry(0.158, 0.13, 0.05, 24, 1, true),
		matteMaterial(0x1a1a1a),
	);
	liner.position.y = 0.4;
	group.add(liner);

	return group;
}

/** Closed lab notebook with a pen on top. */
function makeLabNotebook() {
	const group = new THREE.Group();
	group.name = 'LabNotebook';

	const cover = createNotebookCoverTexture();
	const book = new THREE.Mesh(
		beveledBoxGeom(0.22, 0.025, 0.16, 0.003),
		new THREE.MeshStandardMaterial({ map: cover, roughness: 0.85 }),
	);
	book.position.y = 0.0125;
	group.add(book);

	// Page edges visible on three sides
	const pages = new THREE.Mesh(
		beveledBoxGeom(0.214, 0.018, 0.156, 0.001),
		matteMaterial(0xf5efd8),
	);
	pages.position.y = 0.012;
	group.add(pages);

	// Pen on top
	const pen = new THREE.Mesh(
		new THREE.CylinderGeometry(0.005, 0.005, 0.13, 12),
		paintedMetalMaterial(0x2d2d8a),
	);
	pen.rotation.z = Math.PI / 2;
	pen.rotation.y = 0.3;
	pen.position.set(0.01, 0.03, 0.02);
	group.add(pen);

	const penCap = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0055, 0.0055, 0.025, 12),
		metalMaterial(0xbfbfbf),
	);
	penCap.rotation.z = Math.PI / 2;
	penCap.rotation.y = 0.3;
	penCap.position.set(0.07, 0.03, 0.04);
	group.add(penCap);

	return group;
}

/** Small wooden box for microscope slides, lid slightly ajar. */
function makeSlideStorageBox() {
	const group = new THREE.Group();
	group.name = 'SlideStorageBox';

	const wood = new THREE.MeshStandardMaterial({
		color: 0x9a6b3f,
		roughness: 0.65,
		envMapIntensity: 1.0,
	});

	const body = new THREE.Mesh(beveledBoxGeom(0.14, 0.04, 0.10, 0.003), wood);
	body.position.y = 0.02;
	group.add(body);

	const lid = new THREE.Mesh(beveledBoxGeom(0.14, 0.012, 0.10, 0.002), wood);
	lid.position.set(-0.015, 0.052, 0);
	lid.rotation.z = -0.18;
	group.add(lid);

	// A few slides peeking out
	for (let i = 0; i < 3; i++) {
		const slide = new THREE.Mesh(
			beveledBoxGeom(0.075, 0.001, 0.025, 0.0005),
			glassMaterial(0xeaf2ff),
		);
		slide.position.set(0.005 + i * 0.002, 0.04, -0.02 + i * 0.006);
		slide.rotation.y = jitter(0.05);
		group.add(slide);
	}

	return group;
}

/**
 * Articulated gooseneck desk lamp with a working PointLight in the head.
 * Returns { group, light } so the caller can address the light separately.
 */
function makeDeskLamp() {
	const group = new THREE.Group();
	group.name = 'DeskLamp';

	const armMat = paintedMetalMaterial(0x282828);

	const base = new THREE.Mesh(
		new THREE.CylinderGeometry(0.07, 0.075, 0.018, 24),
		armMat,
	);
	base.position.y = 0.009;
	group.add(base);

	// Lower arm
	const arm1 = new THREE.Mesh(
		new THREE.CylinderGeometry(0.012, 0.012, 0.30, 16),
		armMat,
	);
	arm1.position.set(0, 0.18, 0);
	arm1.rotation.z = -0.15;
	group.add(arm1);

	// Joint
	const joint1 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), armMat);
	joint1.position.set(-0.05, 0.32, 0);
	group.add(joint1);

	// Upper arm (slanted)
	const arm2 = new THREE.Mesh(
		new THREE.CylinderGeometry(0.012, 0.012, 0.26, 16),
		armMat,
	);
	arm2.position.set(0.02, 0.42, 0);
	arm2.rotation.z = 0.45;
	group.add(arm2);

	// Lamp head (cone)
	const headOuter = new THREE.Mesh(
		new THREE.ConeGeometry(0.06, 0.10, 24, 1, true),
		armMat,
	);
	headOuter.position.set(0.13, 0.49, 0);
	headOuter.rotation.z = -1.0;
	group.add(headOuter);

	// Bulb (slightly emissive)
	const bulb = new THREE.Mesh(
		new THREE.SphereGeometry(0.025, 16, 12),
		new THREE.MeshStandardMaterial({
			color: 0xfff4d2,
			emissive: 0xffd385,
			emissiveIntensity: 1.5,
			roughness: 0.4,
		}),
	);
	bulb.position.set(0.16, 0.48, 0);
	bulb.name = 'DeskLamp_Bulb';
	group.add(bulb);

	const light = new THREE.PointLight(0xffcc88, 1.5, 1.5, 2);
	light.position.set(0.18, 0.46, 0);
	light.name = 'DeskLamp_Light';
	light.castShadow = false;
	group.add(light);

	return { group, light };
}

/** Wall-mounted safety poster (Mongolian text). */
function makeSafetyPoster() {
	const group = new THREE.Group();
	group.name = 'SafetyPoster';

	const tex = createSafetyPosterTexture();
	const w = 0.5, h = 0.75;

	const board = new THREE.Mesh(
		beveledBoxGeom(w + 0.02, h + 0.02, 0.012, 0.002),
		matteMaterial(0xd9d4c2),
	);
	board.position.z = -0.006;
	group.add(board);

	const paper = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
	);
	paper.position.z = 0.001;
	group.add(paper);

	return group;
}

/** Wall-mounted periodic table poster — holographic electric-blue glow. */
function makePeriodicTablePoster() {
	const group = new THREE.Group();
	group.name = 'PeriodicTablePoster';

	const tex = createPeriodicTableTexture();
	const w = 1.1, h = 0.7;

	// Dark navy frame so the glow reads cleanly against the wall
	const board = new THREE.Mesh(
		beveledBoxGeom(w + 0.03, h + 0.03, 0.01, 0.002),
		new THREE.MeshPhysicalMaterial({
			color: hexToInt(THEME.ceilingTBar),
			metalness: 0.6,
			roughness: 0.30,
			envMapIntensity: 1.0,
		}),
	);
	board.position.z = -0.005;
	group.add(board);

	// Outer glow halo — additive, fog-blooming layer behind the poster
	const halo = new THREE.Mesh(
		new THREE.PlaneGeometry(w + 0.18, h + 0.18),
		new THREE.MeshBasicMaterial({
			color: hexToInt(THEME.accentBlue),
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	halo.position.z = -0.003;
	group.add(halo);

	const paper = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshStandardMaterial({
			map: tex,
			emissiveMap: tex,
			emissive: new THREE.Color(hexToInt(THEME.accentBlue)),
			emissiveIntensity: 0.85,
			roughness: 0.55,
			envMapIntensity: 0.5,
		}),
	);
	paper.position.z = 0.001;
	group.add(paper);

	return group;
}

/** Wall poster — `assets/indra.jpg` mounted on the north wall behind
 *  the launch / mode-select menu. Self-illuminating so it stays bright
 *  regardless of room lighting; double-sided so the kid still sees it
 *  if they end up behind the wall plane. Fallback colour is bright
 *  cyan so a missing texture is OBVIOUS instead of failing silently. */
function makeIndraPoster() {
	const w = 1.2, h = 1.2;

	const mat = new THREE.MeshBasicMaterial({
		color: 0x00e5c7,        // visible cyan fallback if asset fails
		side: THREE.DoubleSide, // safe regardless of plane facing
		toneMapped: false,
	});

	const loader = new THREE.TextureLoader();
	loader.load(
		'assets/indra.jpg',
		(tex) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.minFilter = THREE.LinearFilter;
			tex.magFilter = THREE.LinearFilter;
			tex.anisotropy = 8;
			tex.generateMipmaps = false;
			mat.map = tex;
			mat.color.setHex(0xffffff); // un-tint once the real image arrives
			mat.needsUpdate = true;
		},
		undefined,
		(err) => {
			console.warn('[IndraPoster] failed to load assets/indra.jpg', err);
		},
	);

	const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	plane.name = 'IndraPoster';
	return plane;
}

/** Whiteboard with marker tray and faint ghosting. */
function makeWhiteboard() {
	const group = new THREE.Group();
	group.name = 'Whiteboard';

	const tex = createWhiteboardTexture();
	const w = 1.8, h = 1.0;

	const frame = new THREE.Mesh(
		beveledBoxGeom(w + 0.05, h + 0.05, 0.02, 0.003),
		paintedMetalMaterial(0xc8c8c8),
	);
	frame.position.z = -0.01;
	group.add(frame);

	const surface = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshPhysicalMaterial({
			map: tex,
			roughness: 0.18,
			clearcoat: 0.6,
			clearcoatRoughness: 0.2,
			envMapIntensity: 1.0,
		}),
	);
	surface.position.z = 0.001;
	group.add(surface);

	const tray = new THREE.Mesh(
		beveledBoxGeom(w, 0.04, 0.07, 0.003),
		paintedMetalMaterial(0xa8a8a8),
	);
	tray.position.set(0, -h / 2 - 0.04, 0.03);
	group.add(tray);

	// Two markers + an eraser on the tray
	for (let i = 0; i < 2; i++) {
		const m = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12),
			paintedMetalMaterial(i === 0 ? 0x222222 : 0xc52a2a),
		);
		m.rotation.z = Math.PI / 2;
		m.position.set(-0.5 + i * 0.18, -h / 2 - 0.025, 0.05);
		group.add(m);
	}
	const eraser = new THREE.Mesh(
		beveledBoxGeom(0.10, 0.025, 0.05, 0.002),
		matteMaterial(0x1f3a52),
	);
	eraser.position.set(0.4, -h / 2 - 0.018, 0.05);
	group.add(eraser);

	return group;
}

/** Lab stool — 4-leg metal frame with round padded seat. */
function makeLabStool() {
	const group = new THREE.Group();
	group.name = 'LabStool';

	const frame = paintedMetalMaterial(0x303236);

	// Seat
	const seat = new THREE.Mesh(
		new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24),
		matteMaterial(0x2a2a2a),
	);
	seat.position.y = 0.55;
	group.add(seat);

	// Cross support under seat
	const cross1 = new THREE.Mesh(beveledBoxGeom(0.36, 0.012, 0.025, 0.002), frame);
	cross1.position.y = 0.52;
	group.add(cross1);
	const cross2 = new THREE.Mesh(beveledBoxGeom(0.025, 0.012, 0.36, 0.002), frame);
	cross2.position.y = 0.52;
	group.add(cross2);

	// 4 legs splayed slightly
	const legR = 0.012;
	const legH = 0.55;
	const splay = 0.20;
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const dx = Math.cos(a) * splay;
		const dz = Math.sin(a) * splay;
		const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, legH, 12), frame);
		leg.position.set(dx / 2, legH / 2, dz / 2);
		// Tilt outward
		leg.rotation.z = -dx * 0.3;
		leg.rotation.x = dz * 0.3;
		group.add(leg);

		const foot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), matteMaterial(0x111111));
		foot.position.set(dx, 0, dz);
		foot.scale.y = 0.6;
		group.add(foot);
	}

	// Foot ring
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(0.16, 0.008, 8, 24),
		frame,
	);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.18;
	group.add(ring);

	return group;
}

/** Wall-mounted first-aid kit (white box with red cross). */
function makeFirstAidKit() {
	const group = new THREE.Group();
	group.name = 'FirstAidKit';

	const w = 0.28, h = 0.22, d = 0.10;
	const body = new THREE.Mesh(beveledBoxGeom(w, h, d, 0.005), matteMaterial(0xfafafa));
	group.add(body);

	// Red cross on the front
	const cross = new THREE.Group();
	const crossMat = matteMaterial(0xc81e1e);
	const armV = new THREE.Mesh(beveledBoxGeom(0.05, 0.14, 0.005, 0.002), crossMat);
	const armH = new THREE.Mesh(beveledBoxGeom(0.14, 0.05, 0.005, 0.002), crossMat);
	cross.add(armV, armH);
	cross.position.z = d / 2 + 0.001;
	group.add(cross);

	// Latches
	for (const dx of [-0.10, 0.10]) {
		const latch = new THREE.Mesh(beveledBoxGeom(0.025, 0.04, 0.015, 0.002), metalMaterial(0xc4c8cc));
		latch.position.set(dx, -h / 2 + 0.04, d / 2 + 0.005);
		group.add(latch);
	}

	// Hinge pins on top
	const hinge = new THREE.Mesh(
		new THREE.CylinderGeometry(0.005, 0.005, w * 0.8, 8),
		metalMaterial(0xb0b0b0),
	);
	hinge.rotation.z = Math.PI / 2;
	hinge.position.set(0, h / 2, d / 2 + 0.002);
	group.add(hinge);

	return group;
}

/** Wall clock — face texture on a disc with a glass cover. */
function makeWallClock() {
	const group = new THREE.Group();
	group.name = 'WallClock';

	const r = 0.16;

	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(r, 0.018, 12, 32),
		paintedMetalMaterial(0x1f1f1f),
	);
	ring.rotation.x = Math.PI / 2;
	group.add(ring);

	const face = new THREE.Mesh(
		new THREE.CircleGeometry(r - 0.005, 32),
		new THREE.MeshStandardMaterial({
			map: createClockFaceTexture(10, 25),
			roughness: 0.3,
			envMapIntensity: 1.0,
		}),
	);
	face.position.z = 0.001;
	group.add(face);

	// Glass cover — opacity-only (perf: no transmission)
	const glass = new THREE.Mesh(
		new THREE.CircleGeometry(r - 0.005, 32),
		new THREE.MeshStandardMaterial({
			color: 0xffffff,
			roughness: 0.08,
			transparent: true,
			opacity: 0.18,
			envMapIntensity: 1.4,
		}),
	);
	glass.position.z = 0.012;
	group.add(glass);

	return group;
}

/** A small bookshelf with several books leaning. */
function makeBookshelf() {
	const group = new THREE.Group();
	group.name = 'Bookshelf';

	const wood = new THREE.MeshStandardMaterial({
		color: 0x8a6a48,
		roughness: 0.7,
		envMapIntensity: 1.0,
	});

	const w = 0.6, h = 0.45, d = 0.22;
	const wall = new THREE.Mesh(beveledBoxGeom(w, 0.012, d, 0.002), wood);
	wall.position.set(0, 0, 0);
	group.add(wall);
	const top = wall.clone();
	top.position.y = h;
	group.add(top);
	for (const dx of [-w / 2, w / 2]) {
		const side = new THREE.Mesh(beveledBoxGeom(0.012, h, d, 0.002), wood);
		side.position.set(dx, h / 2, 0);
		group.add(side);
	}
	const back = new THREE.Mesh(beveledBoxGeom(w, h, 0.005, 0.001), wood);
	back.position.set(0, h / 2, -d / 2 + 0.003);
	group.add(back);
	const middle = wall.clone();
	middle.position.y = h / 2;
	group.add(middle);

	// Two rows of books
	const placeRow = (yMid) => {
		let x = -w / 2 + 0.02;
		let i = 0;
		while (x < w / 2 - 0.02) {
			const bw = 0.022 + Math.random() * 0.012;
			const bh = 0.16 + Math.random() * 0.04;
			const book = new THREE.Mesh(
				beveledBoxGeom(bw, bh, d - 0.04, 0.002),
				new THREE.MeshStandardMaterial({
					map: createBookCoverTexture(i),
					roughness: 0.85,
				}),
			);
			book.position.set(x + bw / 2, yMid + bh / 2 - 0.08, 0);
			book.rotation.z = jitter(0.04);
			group.add(book);
			x += bw + 0.003;
			i++;
		}
	};
	placeRow(h / 2 + 0.085);
	placeRow(h / 2 - 0.165);

	return group;
}

// =====================================================================
// FURTHER SURROUNDINGS
// =====================================================================

/** Tall supply cabinet with glass front; vague silhouettes inside. */
function buildSupplyCabinet() {
	const group = new THREE.Group();
	group.name = 'SupplyCabinet';

	const w = 1.0, h = 2.0, d = 0.4;
	const body = new THREE.Mesh(beveledBoxGeom(w, h, d, 0.005), matteMaterial(0xc7c2b1));
	body.position.y = h / 2;
	group.add(body);

	// Two glass doors — opacity-only (perf)
	const glassDoorMat = new THREE.MeshStandardMaterial({
		color: 0xeaf2ff,
		roughness: 0.10,
		transparent: true,
		opacity: 0.25,
		envMapIntensity: 1.5,
	});
	const frameMat = paintedMetalMaterial(0x6f6960);

	for (const dx of [-w / 4 - 0.005, w / 4 + 0.005]) {
		const doorFrame = new THREE.Mesh(beveledBoxGeom(w / 2 - 0.02, h - 0.06, 0.012, 0.003), frameMat);
		doorFrame.position.set(dx, h / 2, d / 2 + 0.002);
		group.add(doorFrame);

		const glass = new THREE.Mesh(new THREE.PlaneGeometry(w / 2 - 0.06, h - 0.1), glassDoorMat);
		glass.position.set(dx, h / 2, d / 2 + 0.009);
		group.add(glass);

		const handle = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12),
			metalMaterial(0xc4c8cc),
		);
		handle.position.set(dx + (dx > 0 ? -w / 4 + 0.04 : w / 4 - 0.04), h / 2, d / 2 + 0.018);
		group.add(handle);
	}

	// Internal shelves with vague silhouettes
	for (let s = 0; s < 3; s++) {
		const shelf = new THREE.Mesh(beveledBoxGeom(w - 0.05, 0.012, d - 0.06, 0.002), matteMaterial(0xa49d8b));
		shelf.position.set(0, 0.3 + s * 0.55, 0);
		group.add(shelf);

		// Silhouette items
		for (let k = 0; k < 5; k++) {
			const sx = -0.35 + k * 0.18 + jitter(0.02);
			const ih = 0.18 + Math.random() * 0.12;
			const iw = 0.06 + Math.random() * 0.04;
			const isp = new THREE.Mesh(
				new THREE.CylinderGeometry(iw / 2, iw / 2, ih, 12),
				matteMaterial(shiftedColor(0xa3aebd).getHex()),
			);
			isp.position.set(sx, 0.3 + s * 0.55 + ih / 2 + 0.006, 0);
			group.add(isp);
		}
	}

	return group;
}

/** Smaller secondary workbench against the south wall (lower detail). */
function buildSecondaryBench() {
	const group = new THREE.Group();
	group.name = 'SecondaryBench';

	const benchW = 1.6;
	const benchD = 0.55;
	const surfaceY = 0.95;

	// PERF: secondary bench is in the periphery — switched all three of
	// its materials from MeshPhysical (with clearcoat) to MeshStandard.
	const top = new THREE.Mesh(
		beveledBoxGeom(benchW, 0.04, benchD, 0.005),
		new THREE.MeshStandardMaterial({
			color: hexToInt(THEME.benchTop),
			roughness: 0.25,
			metalness: 0.05,
			envMapIntensity: 1.4,
		}),
	);
	top.position.y = surfaceY;
	group.add(top);

	const secCabBodyMat = new THREE.MeshStandardMaterial({
		color: hexToInt(THEME.cabinetBody),
		metalness: 0.30,
		roughness: 0.55,
		envMapIntensity: 1.0,
	});
	const cab = new THREE.Mesh(
		beveledBoxGeom(benchW - 0.04, surfaceY - 0.06, benchD - 0.04, 0.005),
		secCabBodyMat,
	);
	cab.position.y = (surfaceY - 0.06) / 2;
	group.add(cab);

	const secDoorMat = new THREE.MeshStandardMaterial({
		color: hexToInt(THEME.cabinetDoor),
		metalness: 0.35,
		roughness: 0.50,
		envMapIntensity: 1.0,
	});
	for (let i = 0; i < 2; i++) {
		const door = new THREE.Mesh(
			beveledBoxGeom((benchW - 0.06) / 2 - 0.02, surfaceY - 0.18, 0.018, 0.003),
			secDoorMat,
		);
		door.position.set(
			-benchW / 4 + i * benchW / 2,
			(surfaceY - 0.18) / 2 + 0.06,
			benchD / 2 - 0.02,
		);
		group.add(door);

		const handle = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.06, 12),
			metalMaterial(0xc4c8cc),
		);
		handle.rotation.z = Math.PI / 2;
		handle.position.set(
			-benchW / 4 + i * benchW / 2 + 0.16,
			(surfaceY - 0.18) / 2 + 0.18,
			benchD / 2 - 0.005,
		);
		group.add(handle);
	}

	return group;
}

/** Small wall-mounted power outlet (decorative, non-functional). */
function makePowerOutlet() {
	const group = new THREE.Group();
	group.name = 'PowerOutlet';

	const plate = new THREE.Mesh(
		beveledBoxGeom(0.08, 0.12, 0.008, 0.002),
		matteMaterial(0xf2f0eb),
	);
	group.add(plate);

	for (let i = 0; i < 2; i++) {
		const slotL = new THREE.Mesh(
			new THREE.BoxGeometry(0.005, 0.018, 0.004),
			matteMaterial(0x1d1d1d),
		);
		const slotR = slotL.clone();
		slotL.position.set(-0.012, 0.02 - i * 0.05, 0.005);
		slotR.position.set(0.012, 0.02 - i * 0.05, 0.005);
		group.add(slotL, slotR);
		const ground = new THREE.Mesh(
			new THREE.CircleGeometry(0.004, 8),
			matteMaterial(0x1d1d1d),
		);
		ground.position.set(0, -0.005 - i * 0.05, 0.005);
		group.add(ground);
	}

	return group;
}

// =====================================================================
// LIGHTING
// =====================================================================

/**
 * Build the lighting rig — Quest 3S minimal-cost configuration:
 *   - 1 RectAreaLight (centre fixture only — every additional RectAreaLight
 *     costs ~1.5 ms per eye, so 3 → 1 saved ~6 ms total in our tests)
 *   - 1 dim DirectionalLight (moon) with a small 512² shadow map
 *   - 1 HemisphereLight for cool ambient fill (very cheap)
 *
 * The off-centre ceiling fixtures still glow because their diffusers are
 * emissive geometry — they just don't actually cast shaded light any more.
 */
function buildLighting() {
	RectAreaLightUniformsLib.init();

	const group = new THREE.Group();
	group.name = 'Lighting';

	// Single centre RectAreaLight covers the bench area (the only place
	// that really needs soft overhead light). 3× brighter than the
	// previous tuning — kids reported the lab too dim.
	const rect = new THREE.RectAreaLight(0xeaf2ff, 10.5, 1.18, 0.36);
	rect.position.set(0, ROOM.h - 0.085, 0);
	rect.rotation.x = -Math.PI / 2;
	rect.name = 'CeilingLight_Centre';
	group.add(rect);

	// Moonlight + 512² shadow map — also 3× brighter for fill light.
	const moon = new THREE.DirectionalLight(0xb6c8e8, 1.35);
	moon.position.set(6, 4, 0);
	moon.target.position.set(0.2, 1, 0);
	moon.castShadow = true;
	moon.shadow.mapSize.set(512, 512);
	moon.shadow.camera.left = -2;
	moon.shadow.camera.right = 2;
	moon.shadow.camera.top = 2;
	moon.shadow.camera.bottom = -2;
	moon.shadow.camera.near = 0.5;
	moon.shadow.camera.far = 6;
	moon.shadow.bias = -0.0002;
	moon.shadow.normalBias = 0.02;
	moon.name = 'WindowMoon';
	group.add(moon);
	group.add(moon.target);

	// Cool ambient fill (cheap — just sky/ground hemisphere blend) — 3×.
	const hemi = new THREE.HemisphereLight(0x4a5f80, 0x1a2638, 1.35);
	hemi.name = 'HemisphereFill';
	group.add(hemi);

	return group;
}

/**
 * Cyan accent strip lighting. Adds emissive geometry along the perimeter
 * of the ceiling and floor (so the strips read as glowing trim) plus a
 * handful of low-intensity PointLights to wash nearby surfaces with cyan.
 * Use sparingly — too many PointLights tank Quest 3S frame time.
 */
function buildAccentStripLighting() {
	const group = new THREE.Group();
	group.name = 'AccentStripLighting';

	const cyan = hexToInt(THEME.accentCyan);
	const stripMat = new THREE.MeshBasicMaterial({
		color: cyan,
		transparent: true,
		opacity: 0.95,
		toneMapped: false, // bloom-friendly hot spec
	});

	// Build a flat strip plane parallel to the floor at height y, spanning
	// the room perimeter. Two strips total: one near floor, one near ceiling.
	const ringHeights = [0.025, ROOM.h - 0.05];
	const stripWidth = 0.04;

	for (const y of ringHeights) {
		// Front (south)
		const front = new THREE.Mesh(
			new THREE.PlaneGeometry(ROOM.w, stripWidth),
			stripMat,
		);
		front.rotation.x = -Math.PI / 2;
		front.position.set(0, y, ROOM.d / 2 - 0.03);
		group.add(front);

		const back = front.clone();
		back.position.z = -ROOM.d / 2 + 0.03;
		group.add(back);

		// Left / right (running along z-axis)
		const left = new THREE.Mesh(
			new THREE.PlaneGeometry(stripWidth, ROOM.d),
			stripMat,
		);
		left.rotation.x = -Math.PI / 2;
		left.position.set(-ROOM.w / 2 + 0.03, y, 0);
		group.add(left);

		const right = left.clone();
		right.position.x = ROOM.w / 2 - 0.03;
		group.add(right);
	}

	// PERF: floor PointLights removed entirely. Each PointLight adds a full
	// shader pass over every receiving fragment in range; cumulative cost
	// on Quest 3S was ~3 ms. The emissive strip geometry alone reads as
	// "glow" against the dark walls without any actual lit surface change.

	return group;
}

/**
 * Atmospheric haze.
 *
 * PERF: FogExp2 was disabled — every fragment paid a per-pixel exponential
 * fog blend (~3-4 ms). The dark navy scene background gives us 90% of the
 * "fade-into-the-room" effect for free. If the look needs softening, swap
 * back to a linear THREE.Fog (much cheaper) at long near/far ranges.
 */
function addAtmosphericHaze(scene) {
	scene.fog = null;
	scene.background = new THREE.Color(hexToInt(THEME.hazeColor));
}

// =====================================================================
// MAIN ENTRY POINT
// =====================================================================

/**
 * Build the entire biology lab and add it to the scene. Call once.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer  (currently unused but reserved
 *   for future shadow / tone-map tweaks)
 * @returns {{
 *   room: THREE.Group,
 *   mainBench: THREE.Group,
 *   decorGroup: THREE.Group,
 *   lights: THREE.Group
 * }}
 */
export function createLabEnvironment(scene, renderer) {
	void renderer;

	// ── Atmospheric haze + scene background tinted to wall paint ──
	addAtmosphericHaze(scene);

	// ── Room shell ──
	const roomGroup = new THREE.Group();
	roomGroup.name = 'roomGroup';
	roomGroup.add(buildFloor());
	roomGroup.add(buildWalls());
	roomGroup.add(buildCeiling());
	roomGroup.add(buildDoor());
	roomGroup.add(buildWindows());
	scene.add(roomGroup);

	// ── Main bench ──
	const benchGroup = buildMainBench();
	scene.add(benchGroup);
	buildFaucet(benchGroup);

	// ── Decor near the microscope ──
	const decorGroup = new THREE.Group();
	decorGroup.name = 'decorGroup';

	// Microscope reservation zone — declared so any new decor can be
	// validated against it. Centered at world (0.2, 0.98, 0), 0.40×0.40 m.
	const reservedMin = new THREE.Vector3(0.0, 0.96, -0.2);
	const reservedMax = new THREE.Vector3(0.4, 1.4, 0.2);
	const isInReserved = (pos) =>
		pos.x > reservedMin.x &&
		pos.x < reservedMax.x &&
		pos.z > reservedMin.z &&
		pos.z < reservedMax.z;

	const placeOnBench = (item, x, z) => {
		const pos = new THREE.Vector3(x, 0.98, z);
		if (isInReserved(pos)) {
			return false; // refuse to place inside the microscope zone
		}
		// restOnBench reads the object's bounding box and shifts Y so the
		// lowest vertex sits exactly on the bench — no items sinking into
		// or floating above the surface regardless of how their geometry
		// is anchored internally.
		restOnBench(item, x, z);
		imperfect(item);
		decorGroup.add(item);
		return true;
	};

	// Hero items on the bench (avoiding the reserved zone)
	placeOnBench(makeTestTubeRack(), -0.6, -0.05);
	placeOnBench(makeBeaker(500), -0.85, 0.18);
	placeOnBench(makeBeaker(250), -0.5, 0.22);
	placeOnBench(makeReagentBottle('Solutio Natrii Chloridi'), -0.25, 0.20);
	placeOnBench(makeReagentBottle('Iodum 0.5%'), 0.6, -0.15);
	// Glove box swapped INTO the previous slide-tray position so the
	// slide tray (more important to the kid) gets the prime spot to
	// the right of the microscope.
	placeOnBench(makeGloveBox(), 0.55, 0.05);
	placeOnBench(makeLabNotebook(), -0.35, -0.18);
	placeOnBench(makeSlideStorageBox(), -0.7, -0.22);

	// Desk lamp on the left end of the bench
	const { group: lamp, light: lampLight } = makeDeskLamp();
	lamp.rotation.y = -0.4;
	restOnBench(lamp, -1.0, -0.22);
	decorGroup.add(lamp);

	// Trash bin on the floor, beside the bench
	const trash = makeTrashBin();
	trash.position.set(-1.45, 0, 0.05);
	decorGroup.add(trash);

	// Lab stool in front of the bench
	const stool = makeLabStool();
	stool.position.set(-0.1, 0, 0.7);
	imperfect(stool, 0.03, 0.1);
	decorGroup.add(stool);

	// Wall items — west wall (x = -ROOM.w/2 + small offset, faces +X)
	const safety = makeSafetyPoster();
	safety.position.set(-ROOM.w / 2 + 0.015, 1.85, -0.6);
	safety.rotation.y = Math.PI / 2;
	decorGroup.add(safety);

	const aid = makeFirstAidKit();
	aid.position.set(-ROOM.w / 2 + 0.06, 1.6, 1.2);
	aid.rotation.y = Math.PI / 2;
	decorGroup.add(aid);

	const clock = makeWallClock();
	clock.position.set(-ROOM.w / 2 + 0.025, 2.4, 1.8);
	clock.rotation.y = Math.PI / 2;
	decorGroup.add(clock);

	// Wall items — north wall (faces +Z)
	const periodic = makePeriodicTablePoster();
	periodic.position.set(-1.4, 2.0, -ROOM.d / 2 + 0.015);
	decorGroup.add(periodic);

	// School-identity poster (assets/indra.jpg) mounted high-centre
	// on the north wall, well above the launch panel so both read
	// cleanly. 5 cm proud of the wall to dodge any z-fighting with
	// the dado tile + paint planes.
	const indra = makeIndraPoster();
	indra.position.set(0, 2.20, -ROOM.d / 2 + 0.05);
	decorGroup.add(indra);

	// Wall items — south wall (faces -Z)
	const board = makeWhiteboard();
	board.position.set(-1.6, 1.5, ROOM.d / 2 - 0.015);
	board.rotation.y = Math.PI;
	decorGroup.add(board);

	// Bookshelf on the north wall
	const shelf = makeBookshelf();
	shelf.position.set(2.5, 1.0, -ROOM.d / 2 + 0.13);
	decorGroup.add(shelf);

	// Paper towel holder mounted near the sink
	const towel = makePaperTowelHolder();
	towel.position.set(1.7, 1.45, -ROOM.d / 2 + 0.1);
	decorGroup.add(towel);

	// Power outlets on the wall behind the bench (north wall area)
	for (const outletZ of [-2.4, -2.4, -2.4]) {
		void outletZ;
	}
	for (let i = 0; i < 3; i++) {
		const o = makePowerOutlet();
		o.position.set(-1.5 + i * 1.0, 1.1, -ROOM.d / 2 + 0.011);
		decorGroup.add(o);
	}

	// Further surroundings
	const cab1 = buildSupplyCabinet();
	cab1.position.set(-3.0, 0, -ROOM.d / 2 + 0.21);
	decorGroup.add(cab1);
	const cab2 = buildSupplyCabinet();
	cab2.position.set(3.0, 0, -ROOM.d / 2 + 0.21);
	decorGroup.add(cab2);

	const sec = buildSecondaryBench();
	sec.position.set(2.0, 0, ROOM.d / 2 - 0.3);
	sec.rotation.y = Math.PI;
	decorGroup.add(sec);

	scene.add(decorGroup);

	// ── Lighting ──
	const lightingGroup = buildLighting();
	scene.add(lightingGroup);
	lightingGroup.add(lampLight); // attach desk-lamp light reference

	// ── Cyan accent strip lighting (cyber-night STEAM trim) ──
	const accentLighting = buildAccentStripLighting();
	scene.add(accentLighting);

	return {
		room: roomGroup,
		mainBench: benchGroup,
		decorGroup,
		lights: lightingGroup,
		accentLights: accentLighting,
	};
}
