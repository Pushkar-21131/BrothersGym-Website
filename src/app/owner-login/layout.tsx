import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Owner Access | Brothers Gym",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function OwnerAccessLayout({ children }: { children: ReactNode }) {
  return children;
}
