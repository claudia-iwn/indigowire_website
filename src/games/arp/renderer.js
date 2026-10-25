/**
 * SVG + GSAP view for the ARP engine (spec section 6).
 * STUB (M5): today the topology is drawn statically by src/pages/learn/arp.astro.
 * This module will subscribe to engine events and animate frames.
 */

/**
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof import('./engine.js').createEngine>} engine
 * @returns {{ destroy: () => void }}
 */
export function mountRenderer(svg, engine) {
  void svg;
  void engine;
  return { destroy() {} };
}
