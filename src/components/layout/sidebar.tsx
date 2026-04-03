"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  BookOpen,
  GraduationCap,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Users,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[]; // if undefined, shown to all roles
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/dashboard/syllabus", label: "Syllabus", icon: BookOpen, roles: ["student", "teacher"] },
  { href: "/dashboard/learn", label: "Learn", icon: GraduationCap, roles: ["student"] },
  { href: "/dashboard/exams", label: "Exams", icon: FileText, roles: ["student", "teacher"] },
  { href: "/dashboard/chat", label: "AI Chat", icon: MessageSquare, roles: ["student", "teacher"] },
  { href: "/dashboard/classroom", label: "Classrooms", icon: Users, roles: ["teacher"] },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, roles: ["student", "teacher", "parent"] },
  { href: "/scrape-jobs", label: "Scrape Pipeline", icon: Upload, roles: ["admin"] },
  { href: "/curriculum", label: "Curriculum", icon: BookOpen, roles: ["admin"] },
  { href: "/syllabus-viewer", label: "Syllabus Viewer", icon: FileText, roles: ["admin"] },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function getNavForRole(role: string) {
  return navItems.filter((item) => !item.roles || item.roles.includes(role));
}

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  };
  signOutAction: () => Promise<void>;
}

function NavLink({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  const isActive =
    item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href);

  const link = (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-10",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        collapsed && "justify-center px-2",
      )}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarContent({
  collapsed,
  user,
  signOutAction,
  pathname,
  showCollapseButton,
  onToggleCollapse,
}: SidebarProps & {
  collapsed: boolean;
  pathname: string;
  showCollapseButton?: boolean;
  onToggleCollapse?: () => void;
}) {
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const role = user.role || "student";
  const filteredNav = getNavForRole(role);

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-14 items-center border-b px-4 shrink-0",
          collapsed && "justify-center px-2",
        )}
      >
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
            <span className="text-sm font-bold text-primary-foreground">P</span>
          </div>
          {!collapsed && (
            <span className="text-lg font-bold text-foreground">Padvik</span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-1">
          {filteredNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* User + collapse button */}
      <div className="border-t p-3 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 px-2 min-h-10",
                collapsed && "justify-center",
              )}
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user.image || undefined} alt={user.name || ""} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex flex-col items-start text-left min-w-0">
                  <span className="text-sm font-medium truncate max-w-[130px]">
                    {user.name || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize truncate max-w-[130px]">
                    {role}
                  </span>
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={signOutAction}>
                <button type="submit" className="flex w-full items-center">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Collapse toggle — inside the flex column so it doesn't overflow */}
      {showCollapseButton && onToggleCollapse && (
        <div className="border-t px-2 py-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className={cn("w-full h-8", collapsed ? "justify-center px-0" : "justify-start")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span className="text-xs text-muted-foreground">Collapse</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ user, signOutAction }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r bg-card transition-all duration-300",
          collapsed ? "w-[68px]" : "w-[240px]",
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          user={user}
          signOutAction={signOutAction}
          pathname={pathname}
          showCollapseButton
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </aside>
    </TooltipProvider>
  );
}

export function MobileSidebar({ user, signOutAction }: SidebarProps) {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[240px] p-0">
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <SidebarContent
          collapsed={false}
          user={user}
          signOutAction={signOutAction}
          pathname={pathname}
        />
      </SheetContent>
    </Sheet>
  );
}
