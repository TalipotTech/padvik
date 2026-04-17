"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { CreatorSignupDialog } from "@/components/auth/creator-signup-dialog";
import {
  Sparkles,
  Upload,
  Users,
  IndianRupee,
  BookOpen,
  HelpCircle,
  BarChart3,
  ChevronRight,
  CheckCircle,
  Video,
  FileText,
  Mic,
} from "lucide-react";

const CREATOR_FEATURES = [
  {
    icon: Upload,
    title: "Upload Any Content",
    description:
      "Video lessons, audio lectures, PDFs, notes, question sets — all mapped to the Indian curriculum.",
    color: "text-violet-500",
  },
  {
    icon: BookOpen,
    title: "Curriculum-Mapped",
    description:
      "Tag content to CBSE, ICSE, Kerala SCERT or any state board — students find you via their syllabus.",
    color: "text-blue-500",
  },
  {
    icon: HelpCircle,
    title: "Doubt Clearance",
    description:
      "Students ask doubts on your content. Respond with text, audio, or video — build your reputation.",
    color: "text-green-500",
  },
  {
    icon: Users,
    title: "Build Your Audience",
    description:
      "Students follow you. Grow your follower base and become a trusted educator on the platform.",
    color: "text-orange-500",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description:
      "Track views, engagement, follower growth, and content performance in real-time.",
    color: "text-pink-500",
  },
  {
    icon: IndianRupee,
    title: "Earn from Content",
    description:
      "Premium content, subscriptions, and 70/30 revenue share. Get paid monthly via UPI/bank transfer.",
    color: "text-emerald-500",
  },
];

const CONTENT_TYPES = [
  { icon: Video, label: "Video Lessons", desc: "MP4, WebM — up to 500MB" },
  { icon: Mic, label: "Audio Lectures", desc: "MP3, WAV — up to 200MB" },
  { icon: FileText, label: "Notes & PDFs", desc: "PDF, DOCX — up to 50MB" },
  { icon: BookOpen, label: "Question Sets", desc: "Create directly on platform" },
];

const PLANS = [
  {
    name: "Free",
    price: "₹0",
    features: [
      "Upload up to 10 pieces of content",
      "Basic analytics",
      "Doubt inbox",
      "Public creator profile",
    ],
  },
  {
    name: "Plus",
    price: "₹499/mo",
    highlight: true,
    features: [
      "Unlimited content uploads",
      "Premium content (paid access)",
      "Advanced analytics",
      "Priority doubt routing",
      "Featured in browse",
    ],
  },
  {
    name: "Pro",
    price: "₹1,999/mo",
    features: [
      "Everything in Plus",
      "Live sessions (coming soon)",
      "Custom branding",
      "Dedicated support",
      "Revenue share boost to 80/20",
    ],
  },
];

export default function CreatorsLandingPage() {
  const [signInOpen, setSignInOpen] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link href="/">
            <PadvikLogo size="lg" />
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm">
                For Students
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setSignInOpen(true)}>
              Sign In
            </Button>
            <Button size="sm" onClick={() => setSignUpOpen(true)}>
              Start Teaching
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-4 py-1.5 text-sm text-white">
              <Sparkles className="size-4 text-yellow-300" />
              Padvik for Creators
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Teach millions of{" "}
              <span className="bg-gradient-to-r from-yellow-200 to-amber-200 bg-clip-text text-transparent">
                Indian students
              </span>
            </h1>
            <p className="mt-6 text-lg text-white/80 sm:text-xl">
              Upload video lessons, notes, and question sets mapped to CBSE, ICSE, and all
              Indian state boards. Build your audience, clear doubts, and earn from your
              expertise.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button
                size="lg"
                className="bg-white text-violet-700 hover:bg-white/90 shadow-lg"
                onClick={() => setSignUpOpen(true)}
              >
                Become a Creator
                <ChevronRight className="ml-1 size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setSignInOpen(true)}
              >
                Already have an account?
              </Button>
            </div>
            <p className="mt-4 text-sm text-white/60">
              Free to start. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* Content Types */}
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-12">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Upload any type of content
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {CONTENT_TYPES.map((ct) => (
              <div
                key={ct.label}
                className="flex flex-col items-center rounded-xl border bg-card p-6 text-center"
              >
                <ct.icon className="size-8 text-violet-500" />
                <h3 className="mt-3 text-sm font-semibold">{ct.label}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{ct.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Everything you need to teach online
          </h2>
          <p className="mt-3 text-muted-foreground">
            From content upload to monetization — all in one platform.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CREATOR_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border bg-card p-6 transition-shadow hover:shadow-lg"
            >
              <feature.icon className={`size-10 ${feature.color}`} />
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Simple, transparent pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              Start free and upgrade as you grow.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border bg-card p-8 ${
                  plan.highlight
                    ? "border-violet-500 ring-2 ring-violet-500/20 shadow-lg"
                    : ""
                }`}
              >
                {plan.highlight && (
                  <span className="mb-4 inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <p className="mt-2 text-3xl font-bold text-violet-600">
                  {plan.price}
                </p>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="mt-0.5 size-4 shrink-0 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-8 w-full"
                  variant={plan.highlight ? "default" : "outline"}
                  onClick={() => setSignUpOpen(true)}
                >
                  Get Started
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-violet-600 to-indigo-700">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Ready to share your knowledge?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-white/80">
            Join hundreds of educators already creating content for millions of
            Indian students.
          </p>
          <div className="mt-8">
            <Button
              size="lg"
              className="bg-white text-violet-700 hover:bg-white/90 shadow-lg"
              onClick={() => setSignUpOpen(true)}
            >
              <Sparkles className="mr-2 size-4" />
              Become a Creator — It&apos;s Free
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <PadvikLogo size="sm" />
              <span className="text-xs text-muted-foreground">
                by Ensate Technologies, Adoor, Kerala
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Ensate Technologies. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Auth Dialogs */}
      <AuthDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onSwitchToSignUp={() => {
          setSignInOpen(false);
          setSignUpOpen(true);
        }}
      />
      <CreatorSignupDialog
        open={signUpOpen}
        onOpenChange={setSignUpOpen}
        onSwitchToSignIn={() => {
          setSignUpOpen(false);
          setSignInOpen(true);
        }}
      />
    </div>
  );
}
