"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useShell, type Role } from "./shell-provider";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  buyer: "Media buyer",
  viewer: "Viewer",
};

export function UserMenu({ isRail }: { isRail: boolean }) {
  const { user, setShortcutsOpen } = useShell();
  const { theme, setTheme } = useTheme();
  const initial = user.name.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-control px-1.5 text-left hover:bg-slate-3 data-[state=open]:bg-slate-4",
          "rail:justify-center rail:px-0",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-iris-4 text-label font-semibold text-iris-11">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col rail:hidden">
          <span className="truncate text-ui font-medium text-slate-12">{user.name}</span>
          <span className="truncate text-label text-slate-11">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-slate-11 rail:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isRail ? "right" : "top"} align={isRail ? "end" : "start"} className="w-56">
        <DropdownMenuLabel>
          {user.name} · {ROLE_LABEL[user.role]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="system">
                <Monitor /> System
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon /> Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
          <Keyboard />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
