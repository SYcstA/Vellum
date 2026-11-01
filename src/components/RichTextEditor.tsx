import { Editor } from "@tinymce/tinymce-react";
import { linkEndingAtCaret } from "../utils/linkCaret";
import { openUrl } from "@tauri-apps/plugin-opener";

// Self-hosted TinyMCE (offline, no CDN / API key).
import "tinymce/tinymce";
import "tinymce/models/dom/model";
import "tinymce/themes/silver";
import "tinymce/icons/default";
import "tinymce/plugins/lists";
import "tinymce/plugins/advlist";
import "tinymce/plugins/link";
import "tinymce/plugins/autolink";
import "tinymce/plugins/searchreplace";
import "tinymce/plugins/wordcount";

import "tinymce/skins/ui/oxide/skin.min.css";
import contentUiCss from "tinymce/skins/ui/oxide/content.min.css?inline";
import contentCss from "tinymce/skins/content/default/content.min.css?inline";

type Provider = "youtube" | "ytmusic" | "spotify";

function providerOf(href: string): Provider | null {
  let host = "";
  try { host = new URL(href).hostname.toLowerCase(); } catch { return null; }
  if (host === "music.youtube.com") return "ytmusic";
  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "open.spotify.com" || host === "spotify.link") return "spotify";
  return null;
}

/** Stamp data-provider on recognised links so CSS can badge them. */
function tagLinks(editor: { dom: any; getBody: () => HTMLElement; undoManager: any }) {
  const anchors = editor.getBody().querySelectorAll("a[href]");
  editor.undoManager.ignore(() => {
    anchors.forEach((a) => {
      const p = providerOf(a.getAttribute("href") || "");
      if (p) { if (a.getAttribute("data-provider") !== p) a.setAttribute("data-provider", p); }
      else if (a.hasAttribute("data-provider")) a.removeAttribute("data-provider");
    });
  });
}

const LINK_CHIP_CSS = (dark: boolean) => `
  a { cursor: pointer; color: ${dark ? "#a5b4fc" : "#4338ca"}; text-decoration: underline; text-underline-offset: 2px; }
  a:hover { text-decoration-thickness: 2px; }
  a[data-provider] {
    display: inline-block; text-decoration: none; padding: 0 8px; border-radius: 999px;
    border: 1px solid currentColor; font-size: 13px; line-height: 1.6; font-weight: 500;
  }
  a[data-provider]::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: currentColor; }
  a[data-provider="youtube"] { color: ${dark ? "#fca5a5" : "#b91c1c"}; }
  a[data-provider="ytmusic"] { color: ${dark ? "#fdba74" : "#c2410c"}; }
  a[data-provider="spotify"] { color: ${dark ? "#86efac" : "#15803d"}; }
`;

type Props = {
  value: string;
  onChange: (html: string) => void;
  dark: boolean;
};

export default function RichTextEditor({ value, onChange, dark }: Props) {
  return (
    <Editor
      // init (and its baked-in content_style text colour) is only read on mount,
      // so remount when the theme flips or the text stays the old colour.
      key={dark ? "dark" : "light"}
      licenseKey="gpl"
      value={value}
      onEditorChange={(html) => onChange(html)}
      init={{
        height: "100%",
        menubar: false,
        statusbar: false,
        branding: false,
        skin: false,
        content_css: false,
        plugins: "lists advlist link autolink searchreplace wordcount",
        toolbar:
          "undo redo | bold italic underline | bullist numlist | link | removeformat",
        content_style: [
          contentCss,
          contentUiCss,
          `body { background: transparent; color: ${dark ? "#e5e7eb" : "#111827"}; font-size: 14px; line-height: 1.6; }`,
          LINK_CHIP_CSS(dark),
        ].join("\n"),

        // Link dialog: strip confusing fields, auto-prefix https://
        link_title: false,
        link_target_list: false,
        // 'https' prefixes silently; `true` pops a "add https:// prefix?" dialog.
        link_assume_external_targets: "https",
        // Right-click a link -> Link… / Open link / Remove link.
        contextmenu: "vellumlink",
        default_link_target: "_blank",
        // Show quick toolbar (URL + edit/remove) when cursor lands on a link
        link_context_toolbar: true,

        setup: (editor) => {
          // Right-click on a link: Edit link… / Open link / Remove link. (The
          // stock "link" menu only says "Link…", which reads as "insert".)
          editor.ui.registry.addMenuItem("vellumeditlink", {
            icon: "edit-block",
            text: "Edit link…",
            onAction: () => { editor.execCommand("mceLink"); },
          });
          editor.ui.registry.addContextMenu("vellumlink", {
            update: (element) => (editor.dom.getParent(element, "a[href]") ? "vellumeditlink openlink unlink" : ""),
          });

          // Override window.open inside the TinyMCE iframe so every "open link"
          // action (context toolbar button, keyboard shortcut, etc.) routes
          // through Tauri's shell opener instead of the sandboxed WebView.
          editor.on("init", () => {
            const win = editor.getWin() as Window & { open: typeof window.open };
            const open = (url?: string | URL) => {
              if (url) openUrl(String(url)).catch((err) => console.error("openUrl failed:", err));
              return null;
            };
            // The context-toolbar "Open link" button calls the OUTER window.open,
            // which does nothing in the Tauri webview — patch both windows.
            win.open = open;
            window.open = open;
            tagLinks(editor);
          });

          // A plain click on a link opens it in the default browser / app.
          // (Edit a link via right-click -> Link, the toolbar Link button, or Ctrl+K
          // with the cursor placed on it using the keyboard.)
          editor.on("click", (e) => {
            const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
            if (!a) return;
            e.preventDefault();
            const href = a.getAttribute("href");
            if (href && /^(https?:|mailto:)/i.test(href)) openUrl(href).catch((err) => console.error("openUrl failed:", err));
          });

          // Typing at the very end of a link must NOT grow the link (it would swallow
          // the rest of the sentence). Put the typed character in a plain text node
          // right after it. Edit a link via right-click -> Link, or Ctrl+K.
          editor.on("keydown", (e) => {
            if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
            const a = linkEndingAtCaret(editor.selection.getRng());
            if (!a) return;
            e.preventDefault();
            const doc = a.ownerDocument;
            const text = doc.createTextNode(e.key);
            editor.undoManager.transact(() => {
              a.after(text);
              const r = doc.createRange();
              r.setStart(text, text.length);
              r.collapse(true);
              editor.selection.setRng(r);
            });
            editor.nodeChanged();
            editor.dispatch("input"); // lets the React wrapper report the new content
          });

          // Recognise YouTube / YouTube Music / Spotify links and badge them.
          editor.on("SetContent input change NodeChange", () => tagLinks(editor));
        },
      }}
    />
  );
}
