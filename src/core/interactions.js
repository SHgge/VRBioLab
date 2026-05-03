/**
 * @file Minimal pointer-interaction system for VR + desktop.
 *
 * Registers panels (anything with `panel.mesh` + `panel.hitTest(u, v)`
 * + `setHover(id)`) and routes hover and click events to them.
 *
 *   • VR: per-frame raycast from each XRController; 'select' event
 *     (trigger) fires the click. A thin red line is added to each
 *     controller as a visible aiming ray.
 *   • Desktop: mousemove drives hover, click fires the click.
 *
 * Usage:
 *   const interactions = new InteractionSystem({
 *     renderer, camera, scene, container: renderer.domElement,
 *   });
 *   interactions.registerPanel(uiHandle);
 *   // in animation loop:
 *   interactions.update();
 */
import * as THREE from 'three';

export class InteractionSystem {
	/**
	 * @param {{
	 *   renderer: THREE.WebGLRenderer,
	 *   camera:   THREE.Camera,
	 *   scene:    THREE.Scene,
	 *   container: HTMLElement,   // typically renderer.domElement
	 * }} options
	 */
	constructor({ renderer, camera, scene, container }) {
		this.renderer = renderer;
		this.camera = camera;
		this.scene = scene;
		this.container = container;

		/** Registered UI handles. Each has { panel, setHover }. */
		this.panels = [];
		/** Per-panel current hover state, keyed by handle. */
		this._lastHovers = new Map();

		this.raycaster = new THREE.Raycaster();
		this._tempMatrix = new THREE.Matrix4();
		this._tempOrigin = new THREE.Vector3();
		this._tempDir = new THREE.Vector3();
		this._mouse = new THREE.Vector2();

		// ── VR controllers ───────────────────────────────────────────
		// init.js already pulls these out of renderer.xr.getController(i)
		// and adds them to the player Group; we just attach a ray visual
		// and a 'select' listener to each.
		this.vrControllers = [
			renderer.xr.getController(0),
			renderer.xr.getController(1),
		];
		this.rayLines = [];
		const rayGeom = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(0, 0, -2.0),
		]);
		const rayMat = new THREE.LineBasicMaterial({
			color: 0xff4040,
			transparent: true,
			opacity: 0.7,
			depthTest: false,
		});
		this.vrControllers.forEach((controller) => {
			const ray = new THREE.Line(rayGeom.clone(), rayMat.clone());
			// Render the laser pointer ABOVE the eyepiece overlay (which
			// uses renderOrder 9999) — kids need to see where their hands
			// are pointing even while looking through the lens, otherwise
			// they're flying blind during knob-adjust steps.
			ray.renderOrder = 10001;
			controller.add(ray);
			this.rayLines.push(ray);
			controller.addEventListener('select', () =>
				this._handleVRClick(controller),
			);
		});

		// ── Desktop mouse ────────────────────────────────────────────
		this._onMouseMove = (e) => {
			if (renderer.xr.isPresenting) return;
			this._setMouseFromEvent(e);
			this._raycastFromCamera();
			this._dispatchHover();
		};
		this._onMouseClick = (e) => {
			if (renderer.xr.isPresenting) return;
			this._setMouseFromEvent(e);
			this._raycastFromCamera();
			this._dispatchClick();
		};
		container.addEventListener('mousemove', this._onMouseMove);
		container.addEventListener('click', this._onMouseClick);
	}

	/** Adds a UI handle to be hover/click-tested. Idempotent. */
	registerPanel(handle) {
		if (!handle || !handle.panel) return;
		if (this.panels.includes(handle)) return;
		this.panels.push(handle);
	}

	/** Removes a UI handle. Hover is cleared first so the panel
	 *  doesn't keep its last highlight stuck on. */
	unregisterPanel(handle) {
		const i = this.panels.indexOf(handle);
		if (i < 0) return;
		if (handle.setHover) handle.setHover(null);
		this.panels.splice(i, 1);
		this._lastHovers.delete(handle);
	}

	// ────────────────────────────────────────────────────────────────
	// Internal: convert a DOM mouse event into NDC.
	// ────────────────────────────────────────────────────────────────
	_setMouseFromEvent(e) {
		const rect = this.container.getBoundingClientRect();
		this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
	}

	_raycastFromCamera() {
		this.raycaster.setFromCamera(this._mouse, this.camera);
	}

	_raycastFromController(controller) {
		this._tempMatrix.identity().extractRotation(controller.matrixWorld);
		this._tempOrigin.setFromMatrixPosition(controller.matrixWorld);
		this._tempDir.set(0, 0, -1).applyMatrix4(this._tempMatrix);
		this.raycaster.set(this._tempOrigin, this._tempDir);
	}

	_dispatchHover() {
		for (const handle of this.panels) {
			const mesh = handle.panel.mesh;
			const hits = this.raycaster.intersectObject(mesh, false);
			let hoverId = null;
			if (hits.length > 0 && hits[0].uv) {
				const btn = handle.panel.hitTest(hits[0].uv.x, hits[0].uv.y);
				hoverId = btn ? btn.id : null;
			}
			const prev = this._lastHovers.get(handle);
			if (prev !== hoverId) {
				this._lastHovers.set(handle, hoverId);
				if (handle.setHover) handle.setHover(hoverId);
			}
		}
	}

	_dispatchClick() {
		for (const handle of this.panels) {
			const mesh = handle.panel.mesh;
			const hits = this.raycaster.intersectObject(mesh, false);
			if (hits.length > 0 && hits[0].uv) {
				const btn = handle.panel.hitTest(hits[0].uv.x, hits[0].uv.y);
				if (btn && btn.onClick) {
					btn.onClick();
					return; // first hit wins
				}
			}
		}
	}

	_handleVRClick(controller) {
		this._raycastFromController(controller);
		this._dispatchClick();
	}

	/** Per-frame VR hover update. Call from your animation loop. */
	update() {
		if (!this.renderer.xr.isPresenting) return;
		for (const controller of this.vrControllers) {
			this._raycastFromController(controller);
			this._dispatchHover();
		}
	}

	dispose() {
		this.container.removeEventListener('mousemove', this._onMouseMove);
		this.container.removeEventListener('click', this._onMouseClick);
		for (const ray of this.rayLines) {
			if (ray.parent) ray.parent.remove(ray);
			ray.geometry.dispose();
			ray.material.dispose();
		}
		this.panels = [];
		this._lastHovers.clear();
	}
}
