"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/claims", label: "Claims" },
  { href: "/warrants", label: "Warrants" },
  { href: "/history", label: "History" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold tracking-tight">LWF Admin</h1>
        <p className="text-xs text-muted-foreground">Plant Data Portal</p>
      </div>
      <Separator />
      <nav className="flex flex-col gap-1 p-2">
        {navItems.map(({ href, label }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
