const ZWNBSP = /^﻿*$/;

/** Text length without a trailing invisible U+FEFF (TinyMCE's inline-boundary caret marker). */
function visibleLength(text: string): number {
  return text.replace(/﻿+$/, "").length;
}

/** True when everything after `node` among its siblings is only invisible U+FEFF text. */
function onlyMarkersAfter(node: Node): boolean {
  for (let n = node.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== Node.TEXT_NODE || !ZWNBSP.test((n as Text).data)) return false;
  }
  return true;
}

/**
 * If the collapsed caret sits at the very end of a link's content, return that
 * link; otherwise null. Used so typing right after a link starts plain text
 * instead of extending the link (links are edited via right-click instead).
 * TinyMCE keeps an invisible U+FEFF at the end of a link while the caret is
 * there, so that marker does not count as content.
 */
export function linkEndingAtCaret(range: Range): HTMLAnchorElement | null {
  if (!range.collapsed) return null;
  let node: Node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    if (range.startOffset < visibleLength((node as Text).data)) return null;
  } else if (range.startOffset !== node.childNodes.length) {
    return null;
  }
  // Climb while nothing but markers follow us in each parent, until we reach the <a>.
  while (node) {
    if (node.nodeName === "A") return node as HTMLAnchorElement;
    const parent: Node | null = node.parentNode;
    if (!parent || !onlyMarkersAfter(node)) return null;
    node = parent;
  }
  return null;
}
