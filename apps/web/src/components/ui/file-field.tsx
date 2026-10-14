import { useRef } from "react";
import { RiUpload2Line as UploadIcon } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A file to pick, in place of the browser's file control: an outline button
 * that opens the picker, then the chosen file's name. The input itself is
 * visually hidden but keeps the `id`, so a `<label htmlFor>` still works.
 */
export function FileField({
  id,
  accept,
  file,
  onChange,
  disabled,
  buttonLabel = "Choose file…",
  className,
}: {
  id?: string;
  accept?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  buttonLabel?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon data-icon="inline-start" />
        {buttonLabel}
      </Button>
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          file ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {file ? file.name : "No file chosen"}
      </span>
    </div>
  );
}
