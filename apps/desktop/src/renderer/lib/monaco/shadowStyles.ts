import widgets from "./widgets.css?inline";

/**
 * Getting the app's own styling into the editor's shadow root.
 *
 * The editor draws its context menus through VSCode's context view service,
 * which renders them into a shadow root attached to a `.shadow-root-host` it
 * adds as a direct child of the editor's own element. That is a deliberate
 * isolation boundary: it keeps a host page's CSS from reaching in and breaking
 * the editor's own widgets, and it works exactly as well in the other
 * direction. Nothing in `theme.css` can cross it, at any specificity,
 * `!important` or not — which is why the menu went on looking like VSCode's
 * while the hover, an ordinary content widget in the light DOM, did not.
 *
 * So the stylesheet is handed to the root rather than aimed at it. Adopting is
 * the whole mechanism: one `CSSStyleSheet`, constructed once and shared by
 * every root, added alongside the sheet the editor puts there itself. Custom
 * properties inherit across the boundary, so the rules inside still resolve
 * against the window's palette — this carries no colour of its own.
 *
 * This is styling and only styling. It adds a stylesheet and observes for the
 * host being created; it does not touch the menu, its actions, or when it
 * appears.
 */

let sheet: CSSStyleSheet | null = null;

function stylesheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(widgets);
  }
  return sheet;
}

/**
 * Dresses the context views of one editor, and keeps dressing them.
 *
 * Pass the element the editor was created on, not `editor.getDomNode()`. That
 * method returns `null` until the editor has a model — and an editor created
 * before its first file has none, so reading it at creation time yields nothing
 * to watch and the styling silently never arrives. What the editor appends its
 * `.monaco-editor` to is the container, and that exists from the start.
 *
 * Which makes the watch two levels rather than one. The context view host is a
 * child of whichever element the menu named as its container — the editor's own
 * view node in practice, which is itself a child of the container and is built
 * and rebuilt with the model. So the container is watched for that node
 * appearing, the node is watched for the host appearing, and both watches are
 * `childList` on direct children only.
 *
 * That restraint is the point. The editor's inner DOM churns on every keystroke,
 * so a subtree observer anywhere in here would be a callback on every render for
 * the whole life of the editor. Direct children of these two elements are a
 * handful of long-lived containers, and the host is added among them.
 *
 * Returns the way to stop, for the editor's own teardown.
 */
export function dressEditorWidgets(container: HTMLElement): () => void {
  const observers: MutationObserver[] = [];
  /* Which elements already have a watch. The container's children are re-read
     on every mutation, and the view node survives most of them. */
  const watched = new WeakSet<Element>();

  const adopt = (parent: Element) => {
    for (const child of parent.children) {
      const root = (child as HTMLElement).shadowRoot;
      /* `attachShadow` runs in the same task as the append, so by the time this
         observer's microtask lands there is a root to adopt into. */
      if (!root || root.adoptedStyleSheets.includes(stylesheet())) continue;
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, stylesheet()];
    }
  };

  const watch = (parent: Element) => {
    if (watched.has(parent)) return;
    watched.add(parent);
    adopt(parent);
    const observer = new MutationObserver(() => adopt(parent));
    observer.observe(parent, { childList: true });
    observers.push(observer);
  };

  /* The container is watched as well as the view node, because which of the two
     the menu names as its container is the editor's decision and not one worth
     depending on. Adopting into a root that already has the sheet is free. */
  const dress = () => {
    adopt(container);
    for (const child of container.children) {
      if (child.classList.contains("monaco-editor")) watch(child);
    }
  };

  dress();
  const outer = new MutationObserver(dress);
  outer.observe(container, { childList: true });
  observers.push(outer);

  return () => {
    for (const observer of observers) observer.disconnect();
  };
}
