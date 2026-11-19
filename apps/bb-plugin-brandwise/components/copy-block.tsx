import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A command block with a Copy button. */
export function CopyBlock({ label, text, note }: { label: string; text: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
    else {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      done();
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{text}</pre>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
