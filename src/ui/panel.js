/**
 * @file Reusable canvas-textured 3D panel for VR floating UI.
 *
 * A Panel wraps a CanvasTexture mapped onto a PlaneGeometry. Buttons
 * are drawn into the canvas and stored as rectangular hit-test regions.
 * The interaction system raycasts against the panel's mesh, reads the
 * UV of the hit, and calls panel.hitTest(u, v) to find which button
 * was struck.
 *
 * Usage:
 *   const panel = new Panel({ width: 0.8, height: 0.4 });
 *   panel.onHoverChange = render;
 *   function render() {
 *     panel.clear();
 *     panel.drawBackground();
 *     panel.drawText('Title', 512, 60, { font: 'bold 38px Georgia' });
 *     panel.drawButton({ id: 'a', label: 'Action', x: 100, y: 200, w: 800, h: 80, onClick: ... });
 *     panel.update();
 *   }
 *   render();
 *   scene.add(panel.mesh);
 *
 * Mongolian text renders correctly via the system sans-serif fallback
 * chain on every modern browser including Quest 3S Meta Browser.
 */
import * as THREE from 'three';

/** Default panel canvas resolution — 1024×512 reads sharply at typical
 *  VR viewing distance (0.5–1.5 m) without ballooning texture memory. */
const DEFAULT_CANVAS_W = 1024;
const DEFAULT_CANVAS_H = 512;

export class Panel {
	/**
	 * @param {{
	 *   width: number,           // world-space width in metres
	 *   height: number,          // world-space height in metres
	 *   canvasW?: number,        // canvas LOGICAL pixel width (default 1024)
	 *   canvasH?: number,        // canvas LOGICAL pixel height (default 512)
	 *   pixelScale?: number,     // physical/logical pixel ratio (default 1).
	 *                            // Set to 2 for retina-style sharpness on
	 *                            // text-heavy panels — physical canvas grows
	 *                            // 2× while draw coords stay logical.
	 * }} options
	 */
	constructor({
		width,
		height,
		canvasW = DEFAULT_CANVAS_W,
		canvasH = DEFAULT_CANVAS_H,
		pixelScale = 1,
	}) {
		this.canvasW = canvasW;
		this.canvasH = canvasH;
		this.canvas = document.createElement('canvas');
		this.canvas.width = canvasW * pixelScale;
		this.canvas.height = canvasH * pixelScale;
		this.ctx = this.canvas.getContext('2d');
		if (pixelScale !== 1) {
			// All drawing uses logical coordinates; ctx.scale upscales them
			// to the physical canvas. drawButton/drawText callers don't need
			// to know the scale.
			this.ctx.scale(pixelScale, pixelScale);
		}

		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.anisotropy = 8;
		// Disable mipmaps — text and crisp UI suffer from the blurry
		// pre-filtered mip levels when the panel is far from the camera.
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.generateMipmaps = false;

		this.material = new THREE.MeshBasicMaterial({
			map: this.texture,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});

		this._mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(width, height),
			this.material,
		);
		this._mesh.renderOrder = 10; // draw on top of opaque scene

		/** Buttons registered for hit-test. Reset by clear(). */
		this.buttons = [];
		/** Currently hovered button id (null = none). */
		this.hoveredButton = null;
		/** Suppresses hit-test during fade-out etc. */
		this.disabled = false;
		/** Optional callback invoked on hover-change so the menu factory
		 *  can rerender. The Panel itself does not auto-render. */
		this.onHoverChange = null;
	}

	/** The underlying THREE.Mesh — add this to the scene. */
	get mesh() {
		return this._mesh;
	}

	/** Wipe canvas + button list. Call before redrawing. */
	clear() {
		this.buttons = [];
		this.ctx.clearRect(0, 0, this.canvasW, this.canvasH);
	}

	/** Filled rectangle background with a 2 px inset border. */
	drawBackground(
		color = 'rgba(20, 28, 40, 0.92)',
		borderColor = '#5fa5d6',
	) {
		const ctx = this.ctx;
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, this.canvasW, this.canvasH);
		if (borderColor) {
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = 2;
			ctx.strokeRect(1, 1, this.canvasW - 2, this.canvasH - 2);
		}
	}

	/** Single line of text. */
	drawText(text, x, y, options = {}) {
		const {
			font = '28px sans-serif',
			color = '#ffffff',
			align = 'center',
			baseline = 'middle',
		} = options;
		const ctx = this.ctx;
		ctx.font = font;
		ctx.fillStyle = color;
		ctx.textAlign = align;
		ctx.textBaseline = baseline;
		ctx.fillText(text, x, y);
	}

	/**
	 * Rounded button with hover state. Adds the rectangle to the hit-test
	 * list. Call drawButton in your render() before update().
	 *
	 * @param {{ id: string, label: string, sublabel?: string,
	 *   x: number, y: number, w: number, h: number,
	 *   onClick: () => void }} def
	 */
	drawButton({ id, label, sublabel, x, y, w, h, onClick }) {
		const ctx = this.ctx;
		const isHover = this.hoveredButton === id;

		// Rounded-rect background
		const r = 10;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r);
		ctx.lineTo(x + w, y + h - r);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		ctx.lineTo(x + r, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.closePath();

		ctx.fillStyle = isHover ? '#5fa5d6' : '#2a4258';
		ctx.fill();
		ctx.strokeStyle = isHover ? '#cfeaff' : '#4a87b3';
		ctx.lineWidth = 2;
		ctx.stroke();

		// Labels
		const textColor = isHover ? '#0a1a28' : '#ffffff';
		const subColor = isHover ? '#1a3a52' : '#a0bdd0';
		ctx.fillStyle = textColor;
		ctx.font = '28px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (sublabel) {
			ctx.fillText(label, x + w / 2, y + h / 2 - 12);
			ctx.font = '18px sans-serif';
			ctx.fillStyle = subColor;
			ctx.fillText(sublabel, x + w / 2, y + h / 2 + 16);
		} else {
			ctx.fillText(label, x + w / 2, y + h / 2);
		}

		this.buttons.push({ id, x, y, w, h, onClick });
	}

	/**
	 * Find the button under a UV coordinate (0..1). Three.js raycaster
	 * returns UV with V increasing upward; the canvas Y-axis goes the
	 * other way, so we flip V here.
	 *
	 * @returns {{ id, x, y, w, h, onClick } | null}
	 */
	hitTest(u, v) {
		if (this.disabled) return null;
		const cx = u * this.canvasW;
		const cy = (1 - v) * this.canvasH;
		return (
			this.buttons.find(
				(b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h,
			) || null
		);
	}

	/** Update the hovered button id; fires onHoverChange when it changes. */
	setHover(id) {
		if (this.hoveredButton !== id) {
			this.hoveredButton = id;
			if (this.onHoverChange) this.onHoverChange(id);
		}
	}

	/** 0..1 — drives the material's alpha (used for fade transitions). */
	setOpacity(opacity) {
		this.material.opacity = Math.max(0, Math.min(1, opacity));
	}

	/** Push the canvas pixels onto the GPU texture. Call once per render. */
	update() {
		this.texture.needsUpdate = true;
	}

	dispose() {
		this.disabled = true;
		this.buttons = [];
		this.onHoverChange = null;
		if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
		this._mesh.geometry.dispose();
		this.material.dispose();
		this.texture.dispose();
	}
}
