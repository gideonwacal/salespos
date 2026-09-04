import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Trash2 } from "lucide-react";
import { readLogoFile } from "@/lib/image";
import { Button } from "@/components/ui/button";

/**
 * Upload / preview / remove the business logo.
 *
 * Shared by the setup wizard and the settings page so both store the logo the
 * same downscaled way.
 */
export function LogoPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled?: boolean;
  onChange: (dataUri: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      onChange(await readLogoFile(file));
      toast.success("Logo updated — remember to save");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that image");
    } finally {
      setBusy(false);
      // Let the same file be re-picked after a failure.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40">
        {value ? (
          <img src={value} alt="Business logo" className="size-full object-contain" />
        ) : (
          <ImageUp className="size-5 text-muted-foreground" />
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="size-4" /> {value ? "Replace logo" : "Upload logo"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => onChange(null)}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          PNG, JPG or SVG. Shown on receipts, quotations, printed reports and the sidebar.
        </p>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
      />
    </div>
  );
}
