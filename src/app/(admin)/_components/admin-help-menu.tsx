"use client";

/**
 * Admin header "Help" dropdown. Lists every guide in helpNav so admins can
 * reach the docs from anywhere in the admin shell.
 */
import Link from "next/link";
import { HelpCircle, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { helpNav } from "../_nav";

export function AdminHelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none">
        <HelpCircle className="h-4 w-4" />
        Help
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Guides</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {helpNav.map((item) => (
          <DropdownMenuItem key={item.href} asChild className="flex-col items-start gap-0.5">
            <Link href={item.href}>
              <span className="text-sm font-medium">{item.label}</span>
              {item.description && (
                <span className="text-xs text-muted-foreground">{item.description}</span>
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
