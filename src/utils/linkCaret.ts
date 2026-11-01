/**
 * If the collapsed caret sits at the very end of a link's content, return that
 * link; otherwise null. Used so typing right after a link starts plain text
 * instead of extending the link (links are edited via right-click instead).
 */
export function linkEndingAtCaret(range: Range): HTMLAnchorElement | null {
  if (!range.collapsed) return null;
  let node: Node = range.startContainer;
  const length = node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length;
  if (range.startOffset !== length) return null;
  // Climb while we are the last thing in each parent, until we reach the <a>.
  while (node) {
    if (node.nodeName === "A") return node as HTMLAnchorElement;
    const parent: Node | null = node.parentNode;
    if (!parent || parent.lastChild !== node) return null;
    node = parent;
  }
  return null;
}
