"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
  ClipboardList,
  Activity,
  Cpu,
  AlertTriangle,
  Eye,
  CheckSquare,
  BookMarked,
  Layers,
  Play,
  Sparkles,
  HelpCircle,
  FolderOpen,
  Inbox,
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
  /** Override href when user is a creator */
  creatorHref?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[];
  /** Section header — shown before this item's group */
  section?: string;
  /** Only show this item if user is a creator */
  requiresCreator?: boolean;
}

const navItems: NavItem[] = [
  // --- Common ---
  { href: "/dashboard", creatorHref: "/dashboard/creator", label: "Dashboard", icon: Home },
  { href: "/dashboard/syllabus", label: "Curriculum", icon: BookOpen, roles: ["student", "teacher", "admin"] },
  { href: "/dashboard/learn", label: "My Learning", icon: GraduationCap, roles: ["student", "admin"] },
  { href: "__playground__", label: "Playground", icon: Play, roles: ["student"] },
  { href: "/dashboard/learn/journal", label: "Study Journal", icon: BookMarked, roles: ["student", "admin"] },
  { href: "/dashboard/question-bank", label: "Question Bank", icon: ClipboardList, roles: ["teacher", "admin"] },
  { href: "/dashboard/exams", label: "Exams", icon: FileText, roles: ["teacher", "admin"] },
  { href: "/dashboard/chat", label: "AI Chat", icon: MessageSquare, roles: ["teacher", "admin"] },
  { href: "/dashboard/classroom", label: "Classrooms", icon: Users, roles: ["teacher"] },
  { href: "/dashboard/doubts", label: "Doubts", icon: HelpCircle, roles: ["student"] },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, roles: ["teacher", "parent", "admin"] },

  // --- Creator ---
  { href: "/dashboard/creator/content", label: "My Content", icon: FolderOpen, section: "Creator", requiresCreator: true },
  { href: "/dashboard/creator/doubts", label: "Doubt Inbox", icon: Inbox, requiresCreator: true },

  // --- Admin: Content Pipeline ---
  { href: "/scrape-jobs", label: "Scrape Jobs", icon: Upload, roles: ["admin"], section: "Content Pipeline" },
  { href: "/admin/pipeline", label: "Pipeline Overview", icon: Activity, roles: ["admin"] },
  { href: "/admin/content-review", label: "Content Review", icon: CheckSquare, roles: ["admin"] },
  { href: "/admin/ai-providers", label: "AI Providers", icon: Cpu, roles: ["admin"] },

  // --- Admin: Syllabus ---
  { href: "/curriculum", label: "Curriculum Explorer", icon: BookOpen, roles: ["admin"], section: "Syllabus" },
  { href: "/syllabus-viewer", label: "Syllabus Viewer", icon: Eye, roles: ["admin"] },

  // --- Admin: Questions ---
  { href: "/question-papers", label: "Question Papers", icon: FileText, roles: ["admin"], section: "Questions" },
  { href: "/question-viewer", label: "Question Viewer", icon: BookMarked, roles: ["admin"] },
  { href: "/question-paper-verifier", label: "Paper Verifier", icon: CheckSquare, roles: ["admin"] },

  // --- Common ---
  { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["teacher", "admin", "parent"] },
];

function getNavForRole(role: string, isCreator?: boolean) {
  return navItems.filter((item) => {
    if (item.requiresCreator && !isCreator) return false;
    return !item.roles || item.roles.includes(role);
  });
}

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
    isCreator?: boolean;
  };
  signOutAction: () => Promise<void>;
}

function getPlaygroundHref(): string {
  if (typeof window === "undefined") return "/dashboard/learn";
  try {
    const stored = localStorage.getItem("padvik-last-topic");
    if (stored) return `/dashboard/learn/${stored}`;
  } catch { /* ignore */ }
  return "/dashboard/learn";
}

function NavLink({
  item,
  collapsed,
  pathname,
  isCreator,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
  isCreator?: boolean;
}) {
  // Resolve dynamic hrefs — creator override, then playground
  const baseHref = (isCreator && item.creatorHref) ? item.creatorHref : item.href;
  const resolvedHref = baseHref === "__playground__" ? getPlaygroundHref() : baseHref;

  const isActive =
    item.href === "__playground__"
      ? pathname.match(/^\/dashboard\/learn\/\d+/) !== null
      : (isCreator && item.creatorHref)
        ? pathname.startsWith(item.creatorHref)
        : item.href === "/dashboard"
          ? pathname === "/dashboard" || pathname === "/dashboard/creator"
          : pathname.startsWith(item.href);

  const link = (
    <Link
      href={resolvedHref}
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
  const filteredNav = getNavForRole(role, user.isCreator);

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
          <Image src="/logo-icon.png" alt="Padvik" width={32} height={32} className="shrink-0" priority />
          {!collapsed && (
            <span className="text-lg font-bold text-foreground">Padvik</span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-0.5">
          {filteredNav.map((item, i) => {
            // Show section header if this item starts a new section
            const showSection = item.section && (i === 0 || filteredNav[i - 1]?.section !== item.section);
            return (
              <div key={item.href}>
                {showSection && (
                  <div
                    className={cn(
                      "px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60",
                      collapsed && "px-0 text-center",
                      i > 0 && "border-t mt-2",
                    )}
                  >
                    {collapsed ? item.section!.charAt(0) : item.section}
                  </div>
                )}
                <NavLink item={item} collapsed={collapsed} pathname={pathname} isCreator={user.isCreator} />
              </div>
            );
          })}
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
                    {user.isCreator ? "Creator" : role}
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
