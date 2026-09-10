import { QRCodeSVG } from "qrcode.react";

import { cn } from "@/lib/utils";

/** Real, scannable QR code encoding the audience URL. Rendered on a solid
 * white background at high error-correction so it stays scannable under
 * projector glare and low-contrast rooms; never encodes host secrets — the
 * audience URL contains only the public slug per requirements §15. */
export function QrBlock({
  audienceUrl,
  size = "default",
}: {
  audienceUrl: string;
  size?: "default" | "large";
}) {
  const pixels = size === "large" ? 240 : 128;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-white p-3",
          size === "large" ? "h-64 w-64" : "h-36 w-36",
        )}
      >
        <QRCodeSVG
          value={audienceUrl}
          size={pixels}
          level="H"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          title={`QR code for ${audienceUrl}`}
        />
      </div>
      <span
        className={cn(
          "font-mono text-sm text-muted-foreground",
          size === "large" && "text-2xl text-white/90",
        )}
      >
        {audienceUrl}
      </span>
    </div>
  );
}
