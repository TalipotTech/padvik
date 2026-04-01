"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { BoardPicker } from "@/components/layout/board-picker";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { boardName, grade, clearSelection } = useBoardSelection();
  const [pickerOpen, setPickerOpen] = useState(false);

  const themes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your preferences
        </p>
      </div>

      {/* Board selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Board & Class</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {boardName ? (
            <div className="flex items-center gap-3">
              <Badge variant="secondary">
                {boardName} {grade ? `· Class ${grade}` : ""}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                Change
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setPickerOpen(true)}>
              Select Board & Class
            </Button>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {themes.map((t) => (
              <Button
                key={t.value}
                variant={theme === t.value ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme(t.value)}
                className={cn("flex items-center gap-2 min-h-10")}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <BoardPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
