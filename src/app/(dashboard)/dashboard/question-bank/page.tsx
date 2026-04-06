"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Share2, Upload, PenLine, Sparkles } from "lucide-react";
import { QuestionBankExplorer } from "./_components/question-bank-explorer";
import { QuestionEntryForm } from "./_components/question-entry-form";
import { FileUploadPanel } from "./_components/file-upload-panel";
import { SharedQuestionsPanel } from "./_components/shared-questions-panel";
import { AIGeneratePanel } from "./_components/ai-generate-panel";

export default function QuestionBankPage() {
  const [activeTab, setActiveTab] = useState("my-questions");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Question Bank</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse, create, generate, and share questions for exam preparation
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="my-questions" className="gap-2">
            <BookOpen className="h-4 w-4" />
            My Questions
          </TabsTrigger>
          <TabsTrigger value="ai-generate" className="gap-2">
            <Sparkles className="h-4 w-4" />
            AI Generate
          </TabsTrigger>
          <TabsTrigger value="add-question" className="gap-2">
            <PenLine className="h-4 w-4" />
            Add Question
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="shared" className="gap-2">
            <Share2 className="h-4 w-4" />
            Shared with Me
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-questions" className="mt-6">
          <QuestionBankExplorer />
        </TabsContent>

        <TabsContent value="ai-generate" className="mt-6">
          <AIGeneratePanel />
        </TabsContent>

        <TabsContent value="add-question" className="mt-6">
          <QuestionEntryForm
            onSuccess={() => setActiveTab("my-questions")}
          />
        </TabsContent>

        <TabsContent value="upload" className="mt-6">
          <FileUploadPanel />
        </TabsContent>

        <TabsContent value="shared" className="mt-6">
          <SharedQuestionsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
