"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import {
  BookOpen,
  Brain,
  GraduationCap,
  FileText,
  MessageSquare,
  BarChart3,
  ChevronRight,
  Sparkles,
  Globe,
  Users,
  Shield,
} from "lucide-react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { BreakingBanner } from "@/components/notifications/BreakingBanner";
import { BoardUpdatesFeed } from "@/components/notifications/BoardUpdatesFeed";
import { ContentCard, type ContentCardProps } from "@/components/content/content-card";
import { CreatorCard, type CreatorCardProps } from "@/components/creators/creator-card";

const FEATURES = [
  {
    icon: Brain,
    title: "AI-Powered Learning",
    description: "Claude, Gemini, GPT-4o and more — intelligent tutoring that adapts to your curriculum.",
    color: "text-violet-500",
  },
  {
    icon: Globe,
    title: "Multi-Board Support",
    description: "CBSE, ICSE, Kerala SCERT and all major Indian state boards. Classes 1-12.",
    color: "text-blue-500",
  },
  {
    icon: BookOpen,
    title: "Complete Syllabus",
    description: "Auto-scraped and AI-parsed syllabi with chapters, topics, and learning objectives.",
    color: "text-green-500",
  },
  {
    icon: FileText,
    title: "Smart Exam Engine",
    description: "AI-generated question papers, previous year analysis, and adaptive practice tests.",
    color: "text-orange-500",
  },
  {
    icon: MessageSquare,
    title: "AI Doubt Resolver",
    description: "Ask any question — get instant, curriculum-aligned explanations from AI.",
    color: "text-pink-500",
  },
  {
    icon: BarChart3,
    title: "Progress Tracking",
    description: "Track learning progress, identify weak areas, and get personalized study plans.",
    color: "text-cyan-500",
  },
];

const BOARDS = [
  { code: "CBSE", name: "CBSE", fullName: "Central Board of Secondary Education" },
  { code: "ICSE", name: "ICSE", fullName: "Indian Certificate of Secondary Education" },
  { code: "KL", name: "Kerala SCERT", fullName: "State Council of Educational Research and Training" },
];

const STATS = [
  { label: "Education Boards", value: "8+" },
  { label: "Subjects Scraped", value: "200+" },
  { label: "Chapters Parsed", value: "1,000+" },
  { label: "Topics Indexed", value: "5,000+" },
];

export default function HomePage() {
  const [signInOpen, setSignInOpen] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);

  // Featured creators + trending content for discovery sections
  const [featuredCreators, setFeaturedCreators] = useState<CreatorCardProps[]>([]);
  const [trendingContent, setTrendingContent] = useState<ContentCardProps[]>([]);

  useEffect(() => {
    fetch("/api/creators/featured?limit=6")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setFeaturedCreators(
            (json.data.creators ?? []).map((c: Record<string, unknown>) => ({
              userId: c.userId,
              displayName: c.displayName,
              institution: c.institution,
              institutionType: c.institutionType,
              avatarUrl: c.avatarUrl,
              isVerified: c.creatorVerified,
              isFeatured: c.isFeatured,
              followerCount: Number(c.followerCount ?? 0),
              contentCount: Number(c.contentCount ?? 0),
              publishedCount: Number(c.publishedCount ?? 0),
              rating: c.rating,
            }))
          );
        }
      })
      .catch(() => {});

    fetch("/api/content/featured?limit=8")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setTrendingContent(
            (json.data.items ?? []).map((c: Record<string, unknown>) => ({
              id: c.id as number,
              title: c.title as string,
              contentType: c.contentType as string,
              thumbnailUrl: c.thumbnailUrl as string | null,
              durationSeconds: c.durationSeconds as number | null,
              isPremium: c.isPremium as boolean,
              viewCount: Number(c.viewCount ?? 0),
              likeCount: Number(c.likeCount ?? 0),
              publishedAt: c.publishedAt as string,
              creatorName: c.creatorName as string,
              creatorAvatar: c.creatorAvatar as string | null,
              creatorVerified: c.creatorVerified as boolean,
              creatorId: c.creatorId as number,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Breaking News Banner */}
      <BreakingBanner />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <PadvikLogo size="lg" />
          <div className="flex items-center gap-3">
            <Link href="/explore">
              <Button variant="ghost" size="sm">
                Explore
              </Button>
            </Link>
            <Link href="/creators">
              <Button variant="ghost" size="sm">
                Teach on Padvik
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setSignInOpen(true)}>
              Sign In
            </Button>
            <Button size="sm" onClick={() => setSignUpOpen(true)}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Banner */}
      <section className="relative overflow-hidden">
        {/* Background image — responsive with art direction */}
        <picture>
          <source media="(max-width: 480px)" srcSet="/hero/hero-ai-390x500.png" />
          <source media="(max-width: 768px)" srcSet="/hero/hero-ai-768x400.png" />
          <source media="(max-width: 1440px)" srcSet="/hero/hero-ai-1440x720.webp" type="image/webp" />
          <source media="(max-width: 1440px)" srcSet="/hero/hero-ai-1440x720.png" />
          <source media="(max-width: 1920px)" srcSet="/hero/hero-ai-1920x960.webp" type="image/webp" />
          <source media="(max-width: 1920px)" srcSet="/hero/hero-ai-1920x960.png" />
          <img
            src="/hero/hero-ai-1920x960.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            fetchPriority="high"
          />
        </picture>
        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/50" />

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:py-32 lg:py-36">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-4 py-1.5 text-sm text-white">
              <Sparkles className="size-4 text-violet-300" />
              AI-powered curriculum learning platform
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl drop-shadow-lg">
              Learn smarter with{" "}
              <span className="bg-gradient-to-r from-violet-300 to-blue-300 bg-clip-text text-transparent">
                AI-powered
              </span>{" "}
              curriculum
            </h1>
            <p className="mt-6 text-lg text-white/80 sm:text-xl drop-shadow">
              The complete learning platform for Indian K-12 students.
              CBSE, ICSE, Kerala SCERT and all major state boards — Classes 1 to 12.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button size="lg" onClick={() => setSignUpOpen(true)} className="shadow-lg">
                Start Learning Free
                <ChevronRight className="ml-1 size-4" />
              </Button>
              <Link href="/login">
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 hover:text-white shadow-lg">
                  Try Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-10 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-violet-600">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Educators — live data or launch placeholder */}
      {featuredCreators.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center mb-10">
            <h2 className="text-3xl font-bold tracking-tight">Featured Educators</h2>
            <p className="mt-2 text-muted-foreground">
              Learn from verified teachers, tuition centers, and content creators
            </p>
          </div>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {featuredCreators.map((creator) => (
              <CreatorCard key={creator.userId} {...creator} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/explore?tab=creators">
              <Button variant="outline" className="gap-2">
                View All Creators <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      ) : (
        /* Launch placeholder — shown when no creators/content exist yet */
        <section className="border-t bg-gradient-to-b from-violet-50/50 to-transparent dark:from-violet-950/10">
          <div className="mx-auto max-w-7xl px-4 py-16">
            <div className="mx-auto max-w-3xl text-center">
              <div className="flex justify-center gap-3 mb-6">
                {[Users, BookOpen, Sparkles].map((Icon, i) => (
                  <div key={i} className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
                    <Icon className="h-6 w-6 text-violet-600" />
                  </div>
                ))}
              </div>
              <h2 className="text-3xl font-bold tracking-tight">A growing community of educators</h2>
              <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                Teachers, tuition centers, and independent educators are creating lessons, notes, question sets, and video tutorials — all mapped to the Indian curriculum.
              </p>
              <div className="mt-8 flex items-center justify-center gap-4">
                <Link href="/creators">
                  <Button className="gap-2">
                    <Users className="h-4 w-4" /> Start Teaching on Padvik
                  </Button>
                </Link>
                <Button variant="outline" onClick={() => setSignUpOpen(true)} className="gap-2">
                  Join as Student <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Popular Content — only shown when content exists */}
      {trendingContent.length > 0 && (
        <section className="border-t bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-16">
            <div className="mx-auto max-w-2xl text-center mb-10">
              <h2 className="text-3xl font-bold tracking-tight">Popular on Padvik</h2>
              <p className="mt-2 text-muted-foreground">
                Trending educational content from our creator community
              </p>
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {trendingContent.map((content) => (
                <ContentCard key={content.id} {...content} />
              ))}
            </div>
            <div className="mt-8 text-center">
              <Link href="/explore">
                <Button variant="outline" className="gap-2">
                  Browse All Content <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Board Updates */}
      <BoardUpdatesFeed />

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Everything you need to excel</h2>
          <p className="mt-3 text-muted-foreground">
            Powered by the latest AI models — Claude, Gemini, GPT-4o — to give you the best learning experience.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border bg-card p-6 transition-shadow hover:shadow-lg"
            >
              <feature.icon className={`size-10 ${feature.color}`} />
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Boards */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">All major Indian boards</h2>
            <p className="mt-3 text-muted-foreground">
              Syllabus content scraped and parsed directly from official board websites.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {BOARDS.map((board) => (
              <div
                key={board.code}
                className="flex flex-col items-center rounded-xl border bg-card p-8 text-center transition-shadow hover:shadow-lg"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30">
                  <GraduationCap className="size-8 text-violet-600" />
                </div>
                <h3 className="mt-4 text-xl font-bold">{board.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{board.fullName}</p>
                <p className="mt-3 text-xs text-muted-foreground">Classes 1-12 supported</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For Everyone */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Built for everyone</h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: GraduationCap, role: "Students", desc: "Interactive learning, AI tutoring, exam practice" },
            { icon: Users, role: "Teachers", desc: "Classroom management, exam creation, analytics" },
            { icon: Shield, role: "Parents", desc: "Track progress, view results, stay informed" },
            { icon: Brain, role: "Admins", desc: "Content pipeline, curriculum management, AI usage" },
          ].map((item) => (
            <div key={item.role} className="rounded-xl border bg-card p-6 text-center">
              <item.icon className="mx-auto size-8 text-violet-500" />
              <h3 className="mt-3 font-semibold">{item.role}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For Creators */}
      <section className="border-t bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-16">
            <div className="flex-1 text-center lg:text-left">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-violet-100 px-4 py-1.5 text-sm font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                <Sparkles className="size-4" />
                For Educators
              </div>
              <h2 className="text-3xl font-bold tracking-tight">Teach on Padvik</h2>
              <p className="mt-3 text-muted-foreground max-w-lg">
                Share your knowledge with millions of Indian students. Upload video lessons,
                notes, and question sets — all mapped to the curriculum. Clear doubts, build
                your audience, and earn from your expertise.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 justify-center lg:justify-start">
                <Link href="/creators">
                  <Button size="lg" className="gap-2">
                    <Sparkles className="size-4" />
                    Become a Creator
                  </Button>
                </Link>
                <Link href="/creators">
                  <Button size="lg" variant="outline">
                    Learn More
                  </Button>
                </Link>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4 max-w-sm">
              {[
                { icon: Brain, label: "AI-Mapped Content", desc: "Auto-tag to syllabus" },
                { icon: Users, label: "Grow Followers", desc: "Build your audience" },
                { icon: MessageSquare, label: "Clear Doubts", desc: "Help students learn" },
                { icon: BarChart3, label: "Track Performance", desc: "Detailed analytics" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border bg-card p-4 text-center">
                  <item.icon className="mx-auto size-6 text-violet-500" />
                  <h3 className="mt-2 text-sm font-semibold">{item.label}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to start learning?</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Join thousands of students across India learning with AI-powered curriculum tools.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button size="lg" onClick={() => setSignUpOpen(true)}>
              Create Free Account
              <ChevronRight className="ml-1 size-4" />
            </Button>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Try Demo Login
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <PadvikLogo size="sm" />
              <span className="text-xs text-muted-foreground">by Ensate Technologies, Adoor, Kerala</span>
            </div>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Ensate Technologies. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Auth Dialogs */}
      <AuthDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onSwitchToSignUp={() => { setSignInOpen(false); setSignUpOpen(true); }}
      />
      <SignupDialog
        open={signUpOpen}
        onOpenChange={setSignUpOpen}
        onSwitchToSignIn={() => { setSignUpOpen(false); setSignInOpen(true); }}
      />
    </div>
  );
}
