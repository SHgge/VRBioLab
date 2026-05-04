/**
 * @file Microscope part highlight system.
 *
 * Cyan emissive glow with a 1 Hz pulsing intensity. Used by Guide /
 * Learn / Test / Explore modes to draw the student's attention to a
 * specific named part of the microscope.
 *
 * Architecture: each interactive mesh keeps TWO materials in memory —
 * its original, and a pre-built emissive-cyan clone. We swap between
 * them when highlighting / unhighlighting (no `dispose()`, no
 * re-`clone()` per hover change).
 *
 *   Why caching matters: cloning a MeshStandardMaterial triggers a
 *   shader compile the first time the new material is used, which on
 *   Quest 3S is a ~10-50 ms hitch. With the previous "clone on
 *   highlight, dispose on clear" pattern, every hover change in
 *   free-mode caused a stutter. Caching turns subsequent hovers into a
 *   pointer swap with zero GPU work.
 *
 *   `prewarmHighlights(microscope, [...names])` walks the parts at
 *   startup, builds + uses the clones once, then swaps back. This
 *   forces shader compilation up front so the first VR-time hover is
 *   already cache-warm.
 *
 * Usage:
 *   import {
 *     prewarmHighlights, highlightPart, clearHighlight, updateHighlights,
 *   } from './microscope/highlight.js';
 *
 *   prewarmHighlights(microscope, ['Microscope_CoarseKnob', ...]);
 *   highlightPart(microscope, 'Microscope_CoarseKnob');
 *   updateHighlights(elapsedSeconds);  // each frame
 *   clearHighlight(microscope);
 */
import * as THREE from 'three';

/** Cyan glow that matches the lab's accent palette. */
const HIGHLIGHT_COLOR = new THREE.Color(0x00e5c7);

/** Pulse cycles per second. */
const PULSE_HZ = 1;

/** Maximum emissiveIntensity at the peak of the pulse. */
const PULSE_AMPLITUDE = 0.4;

/** mesh → { original: Material, clone: Material }. Persistent — clone
 *  is built once per mesh and re-used across every highlight cycle. */
const _cloneCache = new Map();

/** mesh → bool. Currently active (clone material swapped in). */
const _active = new Set();

function ensureClone(child) {
	let entry = _cloneCache.get(child);
	if (entry) return entry;
	const original = child.material;
	const clone = original.clone();
	clone.emissive = HIGHLIGHT_COLOR.clone();
	clone.emissiveIntensity = 0;
	clone.needsUpdate = true;
	entry = { original, clone };
	_cloneCache.set(child, entry);
	return entry;
}

/**
 * Highlight every mesh inside the named microscope sub-tree. Idempotent
 * — calling twice on the same part is harmless. After the first call
 * for a given mesh, this becomes a pure pointer swap (no allocation,
 * no shader compile).
 *
 * @param {THREE.Object3D} microscope  the root group from createMicroscope()
 * @param {string} partName            value of one of the Microscope_* names
 */
export function highlightPart(microscope, partName) {
	const part = microscope.getObjectByName(partName);
	if (!part) return;

	part.traverse((child) => {
		if (!child.isMesh || !child.material) return;
		if (_active.has(child)) return;
		const entry = ensureClone(child);
		child.material = entry.clone;
		_active.add(child);
	});
}

/**
 * Restore every highlighted mesh to its original material. We DO NOT
 * dispose the clones — they live in the cache so the next highlight
 * is instant. (Materials are tiny in memory; the GPU shader cache
 * is the expensive thing we're protecting.)
 *
 * @param {THREE.Object3D} _microscope  unused — tracking is global
 */
export function clearHighlight(_microscope) {
	for (const mesh of _active) {
		const entry = _cloneCache.get(mesh);
		if (entry) mesh.material = entry.original;
	}
	_active.clear();
}

/**
 * Pre-build the emissive clone for every mesh inside the listed parts
 * AND force their WebGL shaders to compile NOW (via
 * `renderer.compile`), so the first VR-time highlight is hitch-free.
 *
 *   1. Swap each child mesh's material to its emissive clone.
 *   2. Call renderer.compile(scene, camera) — three.js walks the
 *      scene, compiles every material's shader program against the
 *      camera, and uploads it to the GPU.
 *   3. Swap back to originals so the scene looks unchanged at the
 *      next render.
 *
 * Call from startExplore (or any mode) BEFORE the kid starts
 * interacting with the microscope.
 *
 * @param {THREE.Object3D}   microscope
 * @param {string[]}         partNames
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}      scene
 * @param {THREE.Camera}     camera
 */
export function prewarmHighlights(microscope, partNames, renderer, scene, camera) {
	const swapped = [];
	for (const name of partNames) {
		const part = microscope.getObjectByName(name);
		if (!part) continue;
		part.traverse((child) => {
			if (!child.isMesh || !child.material) return;
			const entry = ensureClone(child);
			swapped.push({ child, original: entry.original });
			child.material = entry.clone;
		});
	}
	// Force three.js to compile every material in the scene (including
	// our clones, since they're now active on the meshes).
	if (renderer && scene && camera && typeof renderer.compile === 'function') {
		try { renderer.compile(scene, camera); } catch { /* no-op */ }
	}
	// Restore originals — the scene LOOKS the same at the next frame,
	// but the cyan-clone shaders are now compiled and cached on the GPU.
	for (const { child, original } of swapped) {
		child.material = original;
	}
}

/**
 * Per-frame pulse update. Call from the main animation loop with the
 * elapsed-time in seconds (e.g. the value returned by Clock.getElapsedTime()).
 * No-op when no parts are highlighted, so it's safe to always call.
 */
export function updateHighlights(timeSeconds) {
	if (_active.size === 0) return;
	const pulse =
		((Math.sin(timeSeconds * Math.PI * 2 * PULSE_HZ) + 1) * 0.5) *
		PULSE_AMPLITUDE;
	for (const mesh of _active) {
		const entry = _cloneCache.get(mesh);
		if (entry) entry.clone.emissiveIntensity = pulse;
	}
}

/**
 * Return how many meshes are currently highlighted (mostly useful in
 * tests / debug). Optional public API.
 */
export function highlightedCount() {
	return _active.size;
}
