/**
 * @file Microscope part highlight system.
 *
 * Cyan emissive glow with a 1 Hz pulsing intensity. Used by Guide /
 * Learn / Test modes to draw the student's attention to a specific
 * named part of the microscope without modifying the underlying
 * cached materials (which are shared across many meshes).
 *
 * The trick: when a part is highlighted, we CLONE the mesh's material
 * and swap the clone in. The original material is preserved and
 * restored on clearHighlight(). Cloning is per-mesh, but each clone
 * is held only for the duration of the highlight.
 *
 * Usage:
 *   import { highlightPart, clearHighlight, updateHighlights }
 *     from './microscope/highlight.js';
 *
 *   highlightPart(microscope, 'Microscope_CoarseKnob');
 *   // ... later, in animation loop:
 *   updateHighlights(elapsedSeconds);
 *   // ... when done:
 *   clearHighlight(microscope);
 */
import * as THREE from 'three';

/** Cyan glow that matches the lab's accent palette. */
const HIGHLIGHT_COLOR = new THREE.Color(0x00e5c7);

/** Pulse cycles per second. */
const PULSE_HZ = 1;

/** Maximum emissiveIntensity at the peak of the pulse. */
const PULSE_AMPLITUDE = 0.4;

/** mesh → { original: Material, clone: Material }. Module-scoped so
 *  multiple highlightPart() calls (e.g. in the same chapter)
 *  accumulate, and clearHighlight() resets everything. */
const _highlights = new Map();

/**
 * Highlight every mesh inside the named microscope sub-tree. Idempotent
 * for a given mesh — calling twice on the same part is harmless.
 *
 * @param {THREE.Object3D} microscope  the root group from createMicroscope()
 * @param {string} partName            value of one of the Microscope_* names
 */
export function highlightPart(microscope, partName) {
	const part = microscope.getObjectByName(partName);
	if (!part) return;

	part.traverse((child) => {
		if (!child.isMesh || !child.material) return;
		if (_highlights.has(child)) return;

		const original = child.material;
		const clone = original.clone();
		// emissive may not exist on every material type, but on
		// MeshStandardMaterial / MeshPhysicalMaterial it does.
		clone.emissive = HIGHLIGHT_COLOR.clone();
		clone.emissiveIntensity = 0; // updateHighlights() drives this
		clone.needsUpdate = true;

		child.material = clone;
		_highlights.set(child, { original, clone });
	});
}

/**
 * Restore every highlighted mesh to its original material and dispose
 * the cloned ones to free GPU memory.
 *
 * @param {THREE.Object3D} _microscope  unused — tracking is global
 */
export function clearHighlight(_microscope) {
	for (const [mesh, { original, clone }] of _highlights) {
		mesh.material = original;
		clone.dispose();
	}
	_highlights.clear();
}

/**
 * Per-frame pulse update. Call from the main animation loop with the
 * elapsed-time in seconds (e.g. the value returned by Clock.getElapsedTime()).
 * No-op when no parts are highlighted, so it's safe to always call.
 */
export function updateHighlights(timeSeconds) {
	if (_highlights.size === 0) return;
	// sin oscillates [-1, 1]; remap to [0, 1] then scale to amplitude.
	const pulse =
		((Math.sin(timeSeconds * Math.PI * 2 * PULSE_HZ) + 1) * 0.5) *
		PULSE_AMPLITUDE;
	for (const { clone } of _highlights.values()) {
		clone.emissiveIntensity = pulse;
	}
}

/**
 * Return how many meshes are currently highlighted (mostly useful in
 * tests / debug). Optional public API.
 */
export function highlightedCount() {
	return _highlights.size;
}
