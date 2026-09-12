import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
  narrow,
}: {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <main
      className={cn(
        "mx-auto w-full px-4 py-10 sm:px-6",
        narrow ? "max-w-md" : "max-w-5xl",
        className,
      )}
    >
      {children}
    </main>
  );
}
