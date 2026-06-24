import { Editor } from "@tinymce/tinymce-react";
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

type Props = {
  value: string;
  onChange: (html: string) => void;
  dark: boolean;
};

export default function RichTextEditor({ value, onChange, dark }: Props) {
  return (
    <Editor
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
          "a { cursor: pointer; }",
        ].join("\n"),

        // Link dialog: strip confusing fields, auto-prefix https://
        link_title: false,
        link_target_list: false,
        link_assume_external_targets: true,
        default_link_target: "_blank",
        // Show quick toolbar (URL + edit/remove) when cursor lands on a link
        link_context_toolbar: true,

        setup: (editor) => {
          // Override window.open inside the TinyMCE iframe so every "open link"
          // action (context toolbar button, keyboard shortcut, etc.) routes
          // through Tauri's shell opener instead of the sandboxed WebView.
          editor.on("init", () => {
            const win = editor.getWin() as Window & { open: typeof window.open };
            win.open = (url?: string | URL) => {
              if (url) openUrl(String(url)).catch(() => {});
              return null;
            };
          });
        },
      }}
    />
  );
}
