"use client";

import { useState, useCallback } from "react";
import { Search, Copy, Check, Link2, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";

interface User {
  id: number;
  fullName: string;
  email: string;
  role: string;
}

export function ShareDialog({
  questionIds,
  open,
  onClose,
}: {
  questionIds: number[];
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [permission, setPermission] = useState("read");
  const [_searching, setSearching] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await apiFetch<User[]>(`/api/users/search?q=${encodeURIComponent(query)}`);
      setSearchResults(results.filter((u) => !selectedUsers.some((s) => s.id === u.id)));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [selectedUsers]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    searchUsers(value);
  };

  const addUser = (user: User) => {
    setSelectedUsers((prev) => [...prev, user]);
    setSearchResults((prev) => prev.filter((u) => u.id !== user.id));
    setSearchQuery("");
  };

  const removeUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleShare = async () => {
    if (selectedUsers.length === 0) {
      setError("Select at least one user");
      return;
    }
    setError(null);
    setSharing(true);
    try {
      await apiFetch("/api/questions/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIds,
          sharedWithUserIds: selectedUsers.map((u) => u.id),
          permission,
        }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  };

  const handleCreateInvite = async () => {
    setError(null);
    try {
      const result = await apiFetch<{ inviteCode: string }>(
        "/api/questions/share/invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionIds,
            permission,
            expiresInHours: 168, // 7 days
          }),
        }
      );
      setInviteCode(result.inviteCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    }
  };

  const copyInviteLink = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/dashboard/question-bank/invite/${inviteCode}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Share {questionIds.length} Question{questionIds.length > 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="users" className="flex-1 gap-1">
              <Users className="h-3 w-3" /> Users
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 gap-1">
              <Link2 className="h-3 w-3" /> Invite Link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4 mt-4">
            {/* User search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2"
                    onClick={() => addUser(user)}
                  >
                    <span className="font-medium">{user.fullName}</span>
                    <span className="text-muted-foreground text-xs">{user.email}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Selected users */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedUsers.map((user) => (
                  <Badge
                    key={user.id}
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => removeUser(user.id)}
                  >
                    {user.fullName} x
                  </Badge>
                ))}
              </div>
            )}

            {/* Permission */}
            <div className="space-y-1.5">
              <Label className="text-xs">Permission</Label>
              <Select value={permission} onValueChange={setPermission}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">View only</SelectItem>
                  <SelectItem value="copy">View & Copy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button onClick={handleShare} disabled={sharing} className="w-full">
              {sharing ? "Sharing..." : "Share"}
            </Button>
          </TabsContent>

          <TabsContent value="link" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Permission</Label>
              <Select value={permission} onValueChange={setPermission}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">View only</SelectItem>
                  <SelectItem value="copy">View & Copy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!inviteCode ? (
              <Button onClick={handleCreateInvite} className="w-full">
                <Link2 className="h-4 w-4 mr-2" /> Create Invite Link
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/question-bank/invite/${inviteCode}`}
                    className="text-xs"
                  />
                  <Button size="icon" variant="outline" onClick={copyInviteLink}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This link expires in 7 days. Anyone with the link can access the shared questions.
                </p>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
