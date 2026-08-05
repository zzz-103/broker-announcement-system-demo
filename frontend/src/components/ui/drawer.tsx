"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function Drawer({ ...props }: React.ComponentProps<typeof Dialog>) {
  return <Dialog {...props} />;
}

function DrawerContent({
  className,
  children,
  title,
}: React.ComponentProps<typeof DialogContent> & { title: string }) {
  return (
    <DialogContent
      className={cn(
        "!inset-y-0 !right-0 !left-auto !top-0 !h-dvh !w-full !max-w-[720px] !translate-x-0 !translate-y-0 gap-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 shadow-xl sm:!w-[42%]",
        className,
      )}
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{title}内容</DialogDescription>
      {children}
    </DialogContent>
  );
}

export { Drawer, DrawerContent };
