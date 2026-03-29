"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  href: string;
  label: string;
  badge?: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  { items: [{ href: "/", label: "Dashboard" }] },
  { items: [{ href: "/plants", label: "Browse Plants" }] },
  {
    label: "Data Pipeline",
    items: [
      { href: "/sources", label: "Data Set Sources" },
      { href: "/sources/documents", label: "Documents" },
      { href: "/sources/reliability", label: "Reliability" },
      { href: "/fusion", label: "Fusion" },
    ],
  },
  {
    label: "Curation",
    items: [
      { href: "/conflicts", label: "Conflicts" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/sync", label: "Sync" },
      { href: "/history", label: "History" },
    ],
  },
];

export function SidebarNav({ onLinkClick }: { onLinkClick?: () => void } = {}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold tracking-tight">LWF Admin</h1>
        <p className="text-xs text-muted-foreground">Plant Data Portal</p>
      </div>
      <Separator />
      <nav className="flex flex-col gap-1 p-2">
        {navGroups.map((group, gi) => (
          <div key={gi} className={group.label ? "mt-4" : ""}>
            {group.label && (
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
            )}
            {group.items.map(({ href, label, badge }) => {
              const isActive =
                href === "/"
                  ? pathname === "/"
                  : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onLinkClick}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    group.label ? "pl-5" : ""
                  } ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {label}
                  {badge && (
                    <Badge
                      variant="outline"
                      className="ml-auto px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      {badge}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
