'use client';

import { featureFlags } from '@workspace/backend/config/featureFlags';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Monitor,
  RefreshCw,
  Terminal,
  Layers,
  Shield,
  Compass,
  FileCode2,
  Wifi,
  Users,
  Zap,
  GitBranch,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAppVersion } from '@/modules/app/useAppInfo';
import { useAuthState } from '@/modules/auth/AuthProvider';

function TypewriterText({
  text,
  delay = 50,
  className = '',
}: {
  text: string;
  delay?: number;
  className?: string;
}) {
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(timer);
      }
    }, delay);

    return () => clearInterval(timer);
  }, [text, delay]);

  useEffect(() => {
    const cursorTimer = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(cursorTimer);
  }, []);

  return (
    <span className={className}>
      {displayText}
      <span
        className={`inline-block w-[2px] h-[1em] bg-current ml-[2px] align-middle transition-opacity duration-100 ${showCursor ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  );
}

function FloatingOrb({
  size,
  color,
  delay,
  duration,
  initialX,
  initialY,
}: {
  size: number;
  color: string;
  delay: number;
  duration: number;
  initialX: number;
  initialY: number;
}) {
  return (
    <div
      className="absolute rounded-full blur-3xl opacity-20 pointer-events-none animate-float"
      style={{
        width: size,
        height: size,
        background: color,
        left: `${initialX}%`,
        top: `${initialY}%`,
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
      }}
    />
  );
}

function AgentStatusLine({
  agent,
  status,
  delay,
}: {
  agent: string;
  status: string;
  delay: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-3 text-xs font-mono opacity-0 animate-fadeIn">
      <span className="w-1.5 h-1.5 bg-emerald-400" />
      <span className="text-zinc-500 uppercase tracking-wider font-bold">{agent}</span>
      <ArrowRight className="w-3 h-3 text-zinc-600" strokeWidth={2} />
      <span className="text-zinc-400">{status}</span>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <div
      className="group relative p-4 border-2 border-zinc-800 bg-zinc-900/50 backdrop-blur-sm hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-100 opacity-0 animate-slideUp"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-100" />
      <div className="relative">
        <div className="text-emerald-400 mb-3">{icon}</div>
        <h3 className="text-sm font-bold text-zinc-100 mb-2 uppercase tracking-wider">{title}</h3>
        <p className="text-zinc-500 text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  delay,
}: {
  step: number;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <div
      className="relative p-5 border-2 border-zinc-800 bg-zinc-900/30 opacity-0 animate-slideUp"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center border-2 border-emerald-500/40 text-emerald-400 text-sm font-bold font-mono">
          {step}
        </span>
        <div>
          <h3 className="text-sm font-bold text-zinc-100 mb-1.5 uppercase tracking-wider">
            {title}
          </h3>
          <p className="text-zinc-500 text-xs leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  description,
  color,
  delay,
}: {
  role: string;
  description: string;
  color: string;
  delay: number;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 border-2 border-zinc-800 bg-zinc-900/30 opacity-0 animate-slideUp"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      <span className={`w-2 h-2 flex-shrink-0 ${color}`} />
      <div className="min-w-0">
        <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">{role}</span>
        <p className="text-zinc-500 text-[11px] leading-relaxed mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const appVersion = useAppVersion();
  const authState = useAuthState();
  const isAuthenticated = authState?.state === 'authenticated';

  return (
    <>
      <style jsx global>{`
        @keyframes float {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -30px) scale(1.05);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.95);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-float {
          animation: float 20s ease-in-out infinite;
        }
        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out forwards;
        }
        .animate-slideUp {
          animation: slideUp 0.6s ease-out forwards;
        }
      `}</style>

      <div className="flex-1 bg-zinc-950 text-zinc-100 overflow-auto relative">
        {/* Ambient background */}
        <div className="absolute inset-0 overflow-hidden">
          <FloatingOrb
            size={400}
            color="radial-gradient(circle, rgba(16,185,129,0.3) 0%, transparent 70%)"
            delay={0}
            duration={25}
            initialX={10}
            initialY={20}
          />
          <FloatingOrb
            size={300}
            color="radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 70%)"
            delay={5}
            duration={30}
            initialX={70}
            initialY={60}
          />
          <FloatingOrb
            size={250}
            color="radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)"
            delay={10}
            duration={22}
            initialX={50}
            initialY={10}
          />
        </div>

        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
            backgroundSize: '50px 50px',
          }}
        />

        <div className="relative z-10 flex flex-col min-h-full">
          {/* ─── Hero ─────────────────────────────────────────────────── */}
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-20">
            <div className="max-w-4xl w-full space-y-12">
              <div className="opacity-0 animate-fadeIn" style={{ animationDelay: '200ms' }}>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/80 border-2 border-zinc-800 backdrop-blur-sm">
                  <span className="w-2.5 h-2.5 bg-red-400/80" />
                  <span className="w-2.5 h-2.5 bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 bg-emerald-400/80" />
                  <span className="ml-4 text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-bold">
                    ~/chatroom
                  </span>
                </div>
              </div>

              <div className="space-y-6">
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
                  <span className="text-zinc-400 font-mono text-xl sm:text-2xl block mb-2">$</span>
                  <TypewriterText text="chatroom" delay={60} className="text-zinc-100" />
                </h1>

                <p
                  className="text-lg sm:text-xl text-zinc-400 max-w-2xl leading-relaxed opacity-0 animate-fadeIn"
                  style={{ animationDelay: '1200ms' }}
                >
                  Orchestrate AI agent teams that plan, build, and review code together. Define
                  roles, queue tasks, and let agents collaborate with structured handoffs and
                  quality gates.
                </p>
              </div>

              {/* Agent activity simulation */}
              <div
                className="space-y-2 py-4 border-l-2 border-zinc-800 pl-4 opacity-0 animate-fadeIn"
                style={{ animationDelay: '1800ms' }}
              >
                <AgentStatusLine
                  agent="planner"
                  status="decomposing task into phases"
                  delay={2000}
                />
                <AgentStatusLine agent="builder" status="implementing phase 2 of 3" delay={2400} />
                <AgentStatusLine
                  agent="reviewer"
                  status="approved — merging to main"
                  delay={2800}
                />
              </div>

              {/* CTA */}
              <div
                className="flex flex-wrap gap-3 opacity-0 animate-fadeIn"
                style={{ animationDelay: '2200ms' }}
              >
                {isAuthenticated ? (
                  <Link href="/app">
                    <Button
                      size="lg"
                      className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-90"
                    >
                      <span>Open Dashboard</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-2" strokeWidth={2} />
                    </Button>
                  </Link>
                ) : (
                  <>
                    {!featureFlags.disableLogin && (
                      <Link href="/login">
                        <Button
                          size="lg"
                          className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-90"
                        >
                          <span>Get Started</span>
                          <ArrowRight className="w-3.5 h-3.5 ml-2" strokeWidth={2} />
                        </Button>
                      </Link>
                    )}
                    <Link href="/app">
                      <Button
                        size="lg"
                        variant="outline"
                        className="border-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-80"
                      >
                        Explore Demo
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </main>

          {/* ─── How It Works ─────────────────────────────────────────── */}
          <section className="px-6 py-20 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto">
              <h2
                className="text-sm font-bold text-zinc-300 mb-8 uppercase tracking-wider opacity-0 animate-fadeIn flex items-center gap-2"
                style={{ animationDelay: '2800ms' }}
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>How it works</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StepCard
                  step={1}
                  title="Define Your Team"
                  description="Choose a template (Solo, Duo, Squad) or create custom roles. Each role gets its own system prompt, capabilities, and handoff targets."
                  delay={3000}
                />
                <StepCard
                  step={2}
                  title="Assign & Queue Tasks"
                  description="Send tasks to your team and queue follow-ups while agents work. The backlog keeps everything organized with priorities and scoring."
                  delay={3200}
                />
                <StepCard
                  step={3}
                  title="Agents Collaborate"
                  description="Agents hand off work, report progress, and create artifacts. Built-in review gates and context management ensure quality before shipping."
                  delay={3400}
                />
              </div>
            </div>
          </section>

          {/* ─── Capabilities ─────────────────────────────────────────── */}
          <section className="px-6 py-20 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto">
              <h2
                className="text-sm font-bold text-zinc-300 mb-8 uppercase tracking-wider opacity-0 animate-fadeIn flex items-center gap-2"
                style={{ animationDelay: '3400ms' }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>Capabilities</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <FeatureCard
                  icon={<Monitor className="w-4 h-4" strokeWidth={2} />}
                  title="Multi-Harness"
                  description="Run agents in Cursor, OpenCode, or Pi — each in its own IDE. Parallel development without conflicts."
                  delay={3600}
                />
                <FeatureCard
                  icon={<RefreshCw className="w-4 h-4" strokeWidth={2} />}
                  title="Structured Handoffs"
                  description="Typed handoffs between roles with message classification and review gates. Builders implement, reviewers verify."
                  delay={3700}
                />
                <FeatureCard
                  icon={<ClipboardList className="w-4 h-4" strokeWidth={2} />}
                  title="Task & Backlog"
                  description="Queue tasks, attach backlog items, prioritize with scoring. Nothing gets lost — pick up where you left off."
                  delay={3800}
                />
                <FeatureCard
                  icon={<Compass className="w-4 h-4" strokeWidth={2} />}
                  title="Context Management"
                  description="Pin contexts to keep agents focused. Stale context detection prompts agents to refresh their understanding."
                  delay={3900}
                />
                <FeatureCard
                  icon={<FileCode2 className="w-4 h-4" strokeWidth={2} />}
                  title="Artifacts & Versioning"
                  description="Attach versioned artifacts to handoffs. Track file changes across iterations with full version history."
                  delay={4000}
                />
                <FeatureCard
                  icon={<Wifi className="w-4 h-4" strokeWidth={2} />}
                  title="Remote Agent Control"
                  description="Start, stop, and configure agents from the web UI. Machine daemon with circuit breaker and auto-restart."
                  delay={4100}
                />
                <FeatureCard
                  icon={<Terminal className="w-4 h-4" strokeWidth={2} />}
                  title="CLI Integration"
                  description="Full CLI for agent integration: get-next-task, handoff, report-progress, backlog management, and more."
                  delay={4200}
                />
                <FeatureCard
                  icon={<Layers className="w-4 h-4" strokeWidth={2} />}
                  title="Real-Time Dashboard"
                  description="Live message feed, progress tracking, agent status, workspace grouping, favorites, and unread indicators."
                  delay={4300}
                />
              </div>
            </div>
          </section>

          {/* ─── Roles ────────────────────────────────────────────────── */}
          <section className="px-6 py-20 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto">
              <h2
                className="text-sm font-bold text-zinc-300 mb-2 uppercase tracking-wider opacity-0 animate-fadeIn flex items-center gap-2"
                style={{ animationDelay: '4400ms' }}
              >
                <Users className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>Built-in Roles</span>
              </h2>
              <p
                className="text-xs text-zinc-500 mb-8 opacity-0 animate-fadeIn"
                style={{ animationDelay: '4500ms' }}
              >
                Pre-configured roles with customizable prompts — or define your own.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <RoleCard
                  role="Planner"
                  description="Decomposes tasks, coordinates the team, communicates with the user."
                  color="bg-amber-400"
                  delay={4600}
                />
                <RoleCard
                  role="Builder"
                  description="Implements solutions, writes code, creates PRs, produces artifacts."
                  color="bg-emerald-400"
                  delay={4700}
                />
                <RoleCard
                  role="Reviewer"
                  description="Reviews code quality, provides feedback, approves merges."
                  color="bg-blue-400"
                  delay={4800}
                />
              </div>
            </div>
          </section>

          {/* ─── Get Started ──────────────────────────────────────────── */}
          <section className="px-6 py-20 border-t-2 border-zinc-900">
            <div className="max-w-4xl mx-auto">
              <h2
                className="text-sm font-bold text-zinc-300 mb-8 uppercase tracking-wider opacity-0 animate-fadeIn flex items-center gap-2"
                style={{ animationDelay: '4900ms' }}
              >
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>Get Started</span>
              </h2>

              <div
                className="p-5 border-2 border-zinc-800 bg-zinc-900/30 space-y-4 opacity-0 animate-slideUp"
                style={{ animationDelay: '5000ms', animationFillMode: 'forwards' }}
              >
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Install the CLI
                  </span>
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-950 border border-zinc-800 font-mono text-sm text-zinc-300">
                    <span className="text-zinc-600 select-none">$</span>
                    <span>npm install -g chatroom-cli</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <a
                    href="https://github.com/conradkoh/chatroom"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 border-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-bold text-xs uppercase tracking-wider transition-colors"
                  >
                    <Shield className="w-3.5 h-3.5" strokeWidth={2} />
                    View on GitHub
                  </a>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Footer ───────────────────────────────────────────────── */}
          <footer className="px-6 py-8 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
              <div className="font-mono tabular-nums">
                <span className="text-zinc-600 uppercase tracking-wider font-bold">v</span>
                {appVersion ?? '...'}
              </div>
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-emerald-400" />
                  <span className="uppercase tracking-wider font-bold text-[10px]">
                    Operational
                  </span>
                </span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
