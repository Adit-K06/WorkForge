"use client";

import {
  AlarmClock, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, Circle, CircleCheckBig, Clock3, Cloud, CloudOff,
  FolderKanban, GitBranch, GripVertical, LayoutDashboard, Leaf, ListChecks, LockKeyhole,
  Menu, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Target, Timer, Trash2, Trophy,
  Trees, X, Zap,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  createId, EMPTY_STATE, formatMinutes, localDateKey,
  type BoardLane, type Competition, type DayTask, type FocusSession, type Project,
  type ProjectCategory, type ProjectTask, type RoadmapFile, type Subtask, type TaskCategory, type TimetableBlock,
  type WorkspaceState, TASK_CATEGORIES,
} from "@/lib/types";

type Page = "today" | "competitions" | "roadmap" | "projects" | "forest";
type StorageMode = "cloud" | "local";

const NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "today", label: "My day", icon: LayoutDashboard },
  { id: "competitions", label: "Competitions", icon: Trophy },
  { id: "roadmap", label: "SWE roadmap", icon: GitBranch },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "forest", label: "Forest timer", icon: Trees },
];

const PAGE_TITLES: Record<Page, { title: string; eyebrow: string }> = {
  today: { title: "My day", eyebrow: "YOUR WORKSPACE" },
  competitions: { title: "Competitions", eyebrow: "OPPORTUNITIES TO GROW" },
  roadmap: { title: "SWE roadmap", eyebrow: "ONE STEP AT A TIME" },
  projects: { title: "Projects", eyebrow: "THINGS YOU'RE BUILDING" },
  forest: { title: "Forest timer", eyebrow: "MAKE SPACE TO FOCUS" },
};

function normalizeState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return EMPTY_STATE;
  const raw = value as Partial<WorkspaceState>;
  return {
    ...EMPTY_STATE,
    ...raw,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    competitions: Array.isArray(raw.competitions) ? raw.competitions : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    focusSessions: Array.isArray(raw.focusSessions) ? raw.focusSessions : [],
    timetable: Array.isArray(raw.timetable) ? raw.timetable : [],
    roadmap: {
      ...EMPTY_STATE.roadmap,
      ...(raw.roadmap ?? {}),
      files: Array.isArray(raw.roadmap?.files) ? raw.roadmap.files : [],
      completed: raw.roadmap?.completed ?? {},
    },
  };
}

function readLocalState(): WorkspaceState {
  try {
    return normalizeState(JSON.parse(window.localStorage.getItem("dayframe-state") || "null"));
  } catch {
    return EMPTY_STATE;
  }
}

function readSessionValue(key: string): string {
  try { return window.sessionStorage.getItem(key) || ""; } catch { return ""; }
}

function writeSessionValue(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* Browser storage may be disabled. */ }
}

function clearSessionValue(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* Browser storage may be disabled. */ }
}

function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  if (!date) return "No date";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
}

function stableDateHeading(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "YOUR DAY";
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1];
  return `${weekday}, ${monthName} ${day}`.toUpperCase();
}

function relativeDay(date: string) {
  const current = new Date(`${localDateKey()}T12:00:00`).getTime();
  const target = new Date(`${date}T12:00:00`).getTime();
  const days = Math.round((target - current) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return dateLabel(date, { month: "short", day: "numeric", year: "numeric" });
}

function calculateLane(startDate: string, endDate: string): BoardLane {
  const today = localDateKey();
  if (startDate > today) return "upcoming";
  if (endDate < today) return "ended";
  return "ongoing";
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function AppMark() {
  return <div className="app-mark"><Leaf size={19} strokeWidth={2.6} /></div>;
}

export default function Workspace() {
  const [data, setData] = useState<WorkspaceState>(EMPTY_STATE);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [page, setPage] = useState<Page>("today");
  const [selectedDate, setSelectedDate] = useState("");
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [password, setPassword] = useState("");
  const [passwordGate, setPasswordGate] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [notice, setNotice] = useState("");
  const [banner, setBanner] = useState("");
  const [modal, setModal] = useState<"task" | "competition" | "project" | "timetable" | null>(null);
  const [search, setSearch] = useState("");
  const [saveTimer, setSaveTimer] = useState<number | null>(null);
  const [refreshingRoadmap, setRefreshingRoadmap] = useState(false);

  useEffect(() => {
    setSelectedDate(localDateKey());
  }, []);

  const loadCloud = useCallback(async (token: string) => {
    const result = await apiRequest<{ state: unknown }>("state", {}, token);
    const next = normalizeState(result.state);
    dataRef.current = next;
    setData(next);
    setStorageMode("cloud");
    setPasswordGate(false);
    setBanner("");
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      const savedPassword = readSessionValue("dayframe-password");
      setPassword(savedPassword);
      try {
        const result = await apiRequest<{ state: unknown }>("state", {}, savedPassword);
        if (!active) return;
        const next = normalizeState(result.state);
        dataRef.current = next;
        setData(next);
        setStorageMode("cloud");
        setPasswordGate(false);
        clearSessionValue("dayframe-local-only");
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          if (savedPassword) clearSessionValue("dayframe-password");
          setPassword("");
          setPasswordGate(true);
          setStorageMode("local");
          setData(readLocalState());
          setBanner("Enter your workspace password to sync across devices.");
        } else {
          const local = readLocalState();
          setData(local);
          setStorageMode("local");
          setBanner(error instanceof ApiError ? `${error.message} Your saved work on this device is still available.` : "Cloud sync is unavailable. Your work is saved in this browser.");
        }
      } finally {
        if (active) setReady(true);
      }
    };
    void boot();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready && storageMode === "local") {
      window.localStorage.setItem("dayframe-state", JSON.stringify(data));
    }
  }, [data, ready, storageMode]);

  useEffect(() => () => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
  }, [saveTimer]);

  const updateData = useCallback((change: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) => {
    const next = typeof change === "function" ? change(dataRef.current) : change;
    dataRef.current = next;
    setData(next);
    if (storageMode === "cloud") {
      setSaveTimer((previous) => {
        if (previous !== null) window.clearTimeout(previous);
        return window.setTimeout(async () => {
          try {
            await apiRequest("state", { method: "PUT", body: JSON.stringify(next) }, password);
            setNotice("All changes saved");
            window.setTimeout(() => setNotice(""), 1800);
          } catch {
            window.localStorage.setItem("dayframe-state", JSON.stringify(next));
            setStorageMode("local");
            setBanner("Cloud save failed. Your latest changes are stored in this browser.");
          }
        }, 450);
      });
    }
  }, [password, storageMode]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = passwordInput.trim();
    if (!candidate) return;
    setNotice("");
    try {
      await loadCloud(candidate);
      setPassword(candidate);
      writeSessionValue("dayframe-password", candidate);
      setPasswordInput("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setNotice("That password didn’t match. Try again.");
      else {
        setPassword(candidate);
        writeSessionValue("dayframe-password", candidate);
        setPasswordGate(false);
        setData(readLocalState());
        setStorageMode("local");
        setBanner(error instanceof Error ? `${error.message} Your work is saved in this browser until cloud storage is connected.` : "Cloud storage is not connected yet.");
      }
    }
  };

  const pageInfo = PAGE_TITLES[page];
  const completedToday = data.tasks.filter((task) => task.date === selectedDate && task.complete).length;
  const plannedToday = data.tasks.filter((task) => task.date === selectedDate).length;
  const focusedToday = data.focusSessions.filter((session) => session.date === selectedDate).reduce((sum, session) => sum + session.durationMinutes, 0);
  const treesToday = data.focusSessions.filter((session) => session.date === selectedDate).reduce((sum, session) => sum + session.trees, 0);


  if (passwordGate) {
    return (
      <main className="gate-screen">
        <section className="gate-card">
          <AppMark />
          <span className="eyebrow">YOUR PERSONAL WORKSPACE</span>
          <h1>Welcome back.</h1>
          <p>Enter your workspace password to open Dayframe and sync your plans.</p>
          <form onSubmit={unlock} className="stack-form">
            <label>Workspace password<input autoFocus type="password" autoComplete="current-password" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="Your private password" /></label>
            <button className="primary-button full-button" type="submit"><LockKeyhole size={16} /> Open workspace</button>
          </form>
          {notice && <p className="form-error">{notice}</p>}
          <small>Set APP_PASSWORD in your Vercel project settings if this is your first deployment.</small>
        </section>
      </main>
    );
  }

  const currentTasks = data.tasks.filter((task) => task.date === selectedDate);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><AppMark /><span>dayframe</span><span className="brand-dot" /></div>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {NAV.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-link ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "today" && plannedToday > 0 && <span className="nav-count">{plannedToday}</span>}</button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-forest">
          <div className="forest-mini-icon"><Trees size={17} /></div>
          <div><strong>{treesToday} {treesToday === 1 ? "tree" : "trees"} today</strong><span>{formatMinutes(focusedToday)} in focus</span></div>
          <button aria-label="Open forest timer" onClick={() => setPage("forest")}><ArrowRight size={15} /></button>
        </div>
        <div className="profile-row"><div className="profile-avatar">A</div><div className="profile-copy"><strong>Adit</strong><span>Just you, making progress</span></div><span className={`connection-dot ${storageMode}`} title={storageMode === "cloud" ? "Cloud synced" : "Stored in this browser"} /></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><AppMark /><span>dayframe</span></div>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{pageInfo.title}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={15} /><input aria-label="Search tasks" placeholder="Search your tasks" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>/</kbd></label>
            <div className={`sync-pill ${storageMode}`}><span className="sync-dot" />{storageMode === "cloud" ? "Synced" : "On this device"}</div>
          </div>
        </header>

        {(banner || notice) && <div className={`notice-banner ${storageMode === "cloud" ? "notice-success" : ""}`}><CloudOff size={16} /><span>{notice || banner}</span>{banner && <button onClick={() => setBanner("")} aria-label="Dismiss message"><X size={15} /></button>}</div>}

        <div className="page-content">
          {!ready && <div className="boot-inline"><span className="boot-pulse" />Connecting your workspace…</div>}
          <div className="page-heading">
            <div><span className="eyebrow">{pageInfo.eyebrow}</span><h1>{pageInfo.title}<span className="heading-spark">✳</span></h1><p>{page === "today" ? "A little progress, repeated, adds up." : page === "forest" ? "Give one thing your full attention." : page === "roadmap" ? "Keep your learning path moving." : page === "projects" ? "Small milestones make big ideas real." : "Find a challenge worth showing up for."}</p></div>
            {page === "today" && <button className="primary-button heading-button" onClick={() => setModal("task")}><Plus size={17} /> Add a task</button>}
            {page === "competitions" && <button className="primary-button heading-button" onClick={() => setModal("competition")}><Plus size={17} /> Add competition</button>}
            {page === "projects" && <button className="primary-button heading-button" onClick={() => setModal("project")}><Plus size={17} /> New project</button>}
          </div>

          {page === "today" && <TodayPage data={data} updateData={updateData} selectedDate={selectedDate} setSelectedDate={setSelectedDate} setModal={setModal} search={search} completed={completedToday} planned={plannedToday} focusMinutes={focusedToday} trees={treesToday} />}
          {page === "competitions" && <CompetitionsPage items={data.competitions} updateData={updateData} openForm={() => setModal("competition")} search={search} />}
          {page === "roadmap" && <RoadmapPage roadmap={data.roadmap} updateData={updateData} password={password} storageMode={storageMode} onRefresh={async () => {
            setRefreshingRoadmap(true);
            try {
              const result = await apiRequest<{ roadmap: WorkspaceState["roadmap"] }>("roadmap/refresh", { method: "POST" }, password);
              updateData((current) => ({ ...current, roadmap: result.roadmap }));
              setBanner("");
            } catch (error) { setNotice(error instanceof Error ? error.message : "Couldn’t refresh the roadmap right now."); window.setTimeout(() => setNotice(""), 5000); }
            finally { setRefreshingRoadmap(false); }
          }} refreshing={refreshingRoadmap} />}
          {page === "projects" && <ProjectsPage items={data.projects} updateData={updateData} openForm={() => setModal("project")} search={search} />}
          {page === "forest" && <ForestPage data={data} updateData={updateData} selectedDate={selectedDate} setSelectedDate={setSelectedDate} />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV.map((item) => { const Icon = item.icon; return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><Icon size={19} /><span>{item.label}</span></button>; })}
      </nav>

      {modal === "task" && <TaskForm date={selectedDate} onClose={() => setModal(null)} onSave={(task) => { updateData((current) => ({ ...current, tasks: [...current.tasks, task] })); setModal(null); }} />}
      {modal === "competition" && <CompetitionForm onClose={() => setModal(null)} onSave={(item) => { updateData((current) => ({ ...current, competitions: [...current.competitions, item] })); setModal(null); }} />}
      {modal === "project" && <ProjectForm onClose={() => setModal(null)} onSave={(project) => { updateData((current) => ({ ...current, projects: [...current.projects, project] })); setModal(null); }} />}
      {modal === "timetable" && <TimetableForm date={selectedDate} tasks={data.tasks} onClose={() => setModal(null)} onSave={(block) => { updateData((current) => ({ ...current, timetable: [...current.timetable, block] })); setModal(null); }} />}
    </div>
  );
}

type UpdateData = (change: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) => void;
type ModalState = "task" | "competition" | "project" | "timetable" | null;

function StatCard({ label, value, note, icon: Icon, accent }: { label: string; value: string; note: string; icon: typeof CheckCircle2; accent: string }) {
  return <div className={`stat-card ${accent}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><strong>{value}</strong><small>{note}</small></div>;
}

function TodayPage({ data, updateData, selectedDate, setSelectedDate, setModal, search, completed, planned, focusMinutes, trees }: {
  data: WorkspaceState; updateData: UpdateData; selectedDate: string; setSelectedDate: (date: string) => void;
  setModal: (modal: ModalState) => void; search: string;
  completed: number; planned: number; focusMinutes: number; trees: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const tasks = data.tasks.filter((task) => task.date === selectedDate && task.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const progress = planned ? Math.round((completed / planned) * 100) : 0;
  const moveDate = (offset: number) => {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + offset);
    setSelectedDate(localDateKey(date));
  };
  const toggleTask = (id: string) => updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, complete: !task.complete } : task) }));
  const toggleSubtask = (taskId: string, subtaskId: string) => updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id !== taskId ? task : { ...task, subtasks: task.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, complete: !subtask.complete } : subtask) }) }));
  const deleteTask = (id: string) => {
    const task = data.tasks.find((item) => item.id === id);
    if (!task || !window.confirm(`Delete “${task.title}”?`)) return;
    updateData((current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== id) }));
  };
  const todayBlocks = data.timetable.filter((block) => block.date === selectedDate).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const deleteBlock = (id: string) => updateData((current) => ({ ...current, timetable: current.timetable.filter((block) => block.id !== id) }));

  return (
    <>
      <section className="today-hero">
        <div className="today-hero-copy">
          <span className="eyebrow">{stableDateHeading(selectedDate)}</span>
          <h2>Make room for<br /><em>what matters.</em></h2>
          <p>One thoughtful step at a time. Your day doesn’t need to be perfect to be meaningful.</p>
        </div>
        <div className="today-hero-art" aria-hidden="true">
          <div className="today-orbit orbit-one" /><div className="today-orbit orbit-two" />
          <div className="today-sun"><Leaf size={24} /></div>
          <span className="today-spark spark-one" /><span className="today-spark spark-two" /><span className="today-spark spark-three" />
          <div className="today-hero-caption"><strong>{progress}%</strong><span>of today’s plan</span></div>
        </div>
      </section>
      <section className="stats-grid">
        <StatCard label="Tasks on your plan" value={`${completed} / ${planned}`} note={planned ? `${progress}% of today's plan complete` : "Your day is yours to shape"} icon={ListChecks} accent="stat-lime" />
        <StatCard label="Focused today" value={formatMinutes(focusMinutes)} note="Steady work counts" icon={Clock3} accent="stat-blue" />
        <StatCard label="Trees grown" value={String(trees)} note="Every focus session leaves a trace" icon={Trees} accent="stat-amber" />
      </section>

      <section className="daily-progress-panel panel">
        <div className="daily-progress-heading"><div><span className="eyebrow">DAILY COMPLETION</span><h2>Your task progress</h2><p>{completed} of {planned} tasks complete</p></div><strong>{progress}%</strong></div>
        <div className="daily-progress-track" role="progressbar" aria-label="Today's task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="daily-board">
        <div className="section-heading daily-heading">
          <div><span className="eyebrow">YOUR SCHEDULE</span><h2>Tasks for the day</h2></div>
          <div className="day-controls"><button className="icon-button" aria-label="Previous day" disabled={!selectedDate} onClick={() => moveDate(-1)}><ChevronLeft size={17} /></button><label className="date-chip date-picker"><span>{!selectedDate || selectedDate === localDateKey() ? "Today" : dateLabel(selectedDate, { weekday: "short", month: "short", day: "numeric" })}</span><CalendarDays size={14} /><input type="date" aria-label="Choose a date" value={selectedDate} disabled={!selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} /></label><button className="icon-button" aria-label="Next day" disabled={!selectedDate} onClick={() => moveDate(1)}><ChevronRight size={17} /></button></div>
        </div>
        {tasks.length ? <div className="task-list">
          {tasks.map((task) => <TaskRow key={task.id} task={task} expanded={expanded === task.id} onExpand={() => setExpanded(expanded === task.id ? null : task.id)} onToggle={() => toggleTask(task.id)} onSubtask={(subtaskId) => toggleSubtask(task.id, subtaskId)} onDelete={() => deleteTask(task.id)} />)}
        </div> : <div className="empty-state task-empty"><div className="empty-icon"><Target size={20} /></div><h3>{search ? "No matching tasks" : "A little room to plan"}</h3><p>{search ? "Try a different search." : "Add the important things for this day. They’ll be waiting here when you are."}</p>{!search && <button className="secondary-button" onClick={() => setModal("task")}><Plus size={16} /> Add your first task</button>}</div>}
        {tasks.length > 0 && <button className="add-task-inline" onClick={() => setModal("task")}><Plus size={16} /> Add another task</button>}
      </section>

      <section className="timetable-panel panel">
        <div className="timetable-heading"><div><span className="eyebrow">MAKE A PLAN THAT FITS</span><h2>Your timetable</h2><p>Shape the day around your own rhythm. Linking a task is optional.</p></div><button className="primary-button" onClick={() => setModal("timetable")}><Plus size={16} /> Add time block</button></div>
        {todayBlocks.length ? <div className="timetable-list">{todayBlocks.map((block) => {
          const linkedTask = data.tasks.find((task) => task.id === block.taskId);
          return <article className="timetable-row" key={block.id}><div className="timetable-time"><strong>{block.startTime}</strong><span>{block.endTime}</span></div><div className="timetable-main"><strong>{block.name}</strong><span className={`category-tag category-${block.category.toLowerCase().replaceAll(" ", "-")}`}>{block.category}</span>{linkedTask && <small>Linked task: {linkedTask.title}</small>}</div><span className="timetable-duration">{formatMinutes(block.durationMinutes)}</span><button className="delete-button" onClick={() => deleteBlock(block.id)} aria-label={`Delete ${block.name}`} title="Delete time block"><Trash2 size={14} /></button></article>;
        })}</div> : <div className="timetable-empty"><CalendarDays size={18} /><span>No time blocks for this day yet.</span><button onClick={() => setModal("timetable")}>Build your timetable</button></div>}
      </section>
    </>
  );
}

function TaskRow({ task, expanded, onExpand, onToggle, onSubtask, onDelete }: { task: DayTask; expanded: boolean; onExpand: () => void; onToggle: () => void; onSubtask: (id: string) => void; onDelete: () => void }) {
  const subtaskCount = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((item) => item.complete).length;
  return (
    <div className={`task-card ${task.complete ? "task-complete" : ""}`}>
      <div className="task-main-row">
        <button className={`task-check ${task.complete ? "checked" : ""}`} aria-label={task.complete ? "Mark task incomplete" : "Mark task complete"} onClick={onToggle}>{task.complete && <Check size={13} strokeWidth={3} />}</button>
        <div className="task-time"><strong>{task.startTime || "—"}</strong><span>{task.endTime || formatMinutes(task.durationMinutes)}</span></div>
        <div className="task-summary"><button className={`task-title ${task.complete ? "struck" : ""}`} onClick={onExpand}>{task.title}</button><div className="task-subline">{task.description && <span>{task.description}</span>}{subtaskCount > 0 && <button className="subtask-count" onClick={onExpand}><ListChecks size={13} />{subtaskDone}/{subtaskCount}</button>}</div></div>
        <span className={`category-tag category-${task.category.toLowerCase().replaceAll(" ", "-")}`}>{task.category}</span>
        <button className="delete-button task-delete" onClick={onDelete} aria-label={`Delete ${task.title}`} title="Delete task"><Trash2 size={14} /></button>
        <button className={`expand-task ${expanded ? "opened" : ""}`} onClick={onExpand} aria-label="Show subtasks"><ChevronDown size={16} /></button>
      </div>
      {expanded && <div className="subtask-area">
        {subtaskCount > 0 ? task.subtasks.map((subtask) => <label className={`subtask-row ${subtask.complete ? "done" : ""}`} key={subtask.id}><input type="checkbox" checked={subtask.complete} onChange={() => onSubtask(subtask.id)} /><span>{subtask.title}</span></label>) : <p className="subtasks-empty">No subtasks for this one.</p>}
      </div>}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

function TaskForm({ date, onClose, onSave }: { date: string; onClose: () => void; onSave: (task: DayTask) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TaskCategory>("Study");
  const [duration, setDuration] = useState(60);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [description, setDescription] = useState("");
  const [subtasks, setSubtasks] = useState("");
  const [taskDate, setTaskDate] = useState(date);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ id: createId(), title: title.trim(), category, durationMinutes: Number(duration), startTime, endTime, description: description.trim(), date: taskDate, complete: false, subtasks: subtasks.split(/\n|,/).map((item) => item.trim()).filter(Boolean).map((item) => ({ id: createId(), title: item, complete: false })) });
  };
  return <Modal title="Add a task" subtitle="Give your day a little more shape." onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <Field label="Task name"><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs your attention?" /></Field>
    <div className="form-grid"><Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as TaskCategory)}>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Day"><input type="date" required value={taskDate} onChange={(event) => setTaskDate(event.target.value)} /></Field></div>
    <div className="form-grid"><Field label="Duration (minutes)"><input type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></Field><Field label="Time"><div className="inline-time"><input aria-label="Start time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /><span>to</span><input aria-label="End time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div></Field></div>
    <Field label="Description"><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A note to future you (optional)" /></Field>
    <Field label="Subtasks"><textarea rows={3} value={subtasks} onChange={(event) => setSubtasks(event.target.value)} placeholder="One per line, or separated with commas" /><small>Break it into steps if that makes it feel easier.</small></Field>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Add task</button></div>
  </form></Modal>;
}

function TimetableForm({ date, tasks, onClose, onSave }: { date: string; tasks: DayTask[]; onClose: () => void; onSave: (block: TimetableBlock) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TaskCategory>("Study");
  const [blockDate, setBlockDate] = useState(date);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [taskId, setTaskId] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ id: createId(), date: blockDate, name: name.trim(), category, startTime, endTime, durationMinutes: Number(duration), taskId });
  };
  return <Modal title="Add a timetable block" subtitle="Plan a class, study session, workout, or anything else." onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <Field label="Work name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="What will you work on?" /></Field>
    <div className="form-grid"><Field label="Date"><input required type="date" value={blockDate} onChange={(event) => setBlockDate(event.target.value)} /></Field><Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as TaskCategory)}>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field></div>
    <div className="form-grid"><Field label="Start time"><input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field><Field label="End time"><input required type="time" min={startTime} value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field></div>
    <div className="form-grid"><Field label="Duration (minutes)"><input required type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></Field><Field label="Link a task (optional)"><select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">No linked task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {dateLabel(task.date)}</option>)}</select></Field></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Add to timetable</button></div>
  </form></Modal>;
}

const COMPETITION_LANES: { id: BoardLane; label: string; tint: string }[] = [
  { id: "upcoming", label: "Up next", tint: "lane-sky" },
  { id: "ongoing", label: "In progress", tint: "lane-lime" },
  { id: "ended", label: "Wrapped up", tint: "lane-muted" },
];

function CompetitionsPage({ items, updateData, openForm, search }: { items: Competition[]; updateData: UpdateData; openForm: () => void; search: string }) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const filtered = items.filter((item) => `${item.name} ${item.organizer} ${item.track}`.toLowerCase().includes(search.toLowerCase()));
  const moveItem = (id: string, lane: BoardLane) => updateData((current) => ({ ...current, competitions: current.competitions.map((item) => item.id === id ? { ...item, lane } : item) }));
  const deleteItem = (item: Competition) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    updateData((current) => ({ ...current, competitions: current.competitions.filter((entry) => entry.id !== item.id) }));
  };
  return <>
    <div className="board-intro"><div className="board-count"><span className="count-dot" />{items.length} {items.length === 1 ? "competition" : "competitions"} on your radar</div><p>Drag a card to move it, or use the menu on smaller screens.</p></div>
    <div className="kanban-board">
      {COMPETITION_LANES.map((lane) => {
        const laneItems = filtered.filter((item) => item.lane === lane.id);
        return <section key={lane.id} className={`board-column ${lane.tint}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/dayframe-competition"); if (id) moveItem(id, lane.id); setDraggedId(null); }}>
          <div className="column-heading"><div className="column-name"><span className="column-indicator" /><h2>{lane.label}</h2><span className="column-count">{laneItems.length}</span></div><button className="column-add" onClick={openForm} aria-label="Add a competition"><Plus size={16} /></button></div>
          {laneItems.length ? <div className="board-cards">{laneItems.map((item) => <article key={item.id} className={`competition-card ${draggedId === item.id ? "dragging" : ""}`} draggable onDragStart={(event) => { event.dataTransfer.setData("text/dayframe-competition", item.id); setDraggedId(item.id); }} onDragEnd={() => setDraggedId(null)}>
            <div className="card-topline"><span className={`track-chip track-${item.track.toLowerCase()}`}>{item.track === "Both" ? "Hardware + software" : item.track}</span><div className="card-actions"><button className="delete-button" aria-label={`Delete ${item.name}`} title="Delete competition" onClick={(event) => { event.stopPropagation(); deleteItem(item); }}><Trash2 size={14} /></button><GripVertical className="drag-handle" size={16} /></div></div>
            <h3>{item.name}</h3><p className="card-organizer">{item.organizer || "Organizer not set"}</p>
            <div className="card-rule" />
            <div className="competition-dates"><div><CalendarDays size={14} /><span>{dateLabel(item.startDate)} <i>→</i> {dateLabel(item.endDate)}</span></div><div><Clock3 size={14} /><span>{item.duration || "Duration not set"}</span></div></div>
            <div className="card-footer"><span className="card-footnote">{item.lane === "ended" ? "Finished" : item.lane === "ongoing" ? "Happening now" : relativeDay(item.startDate)}</span><select className="lane-select" value={item.lane} onChange={(event) => moveItem(item.id, event.target.value as BoardLane)} aria-label="Move competition">{COMPETITION_LANES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
          </article>)}</div> : <div className="column-empty"><div><Plus size={16} /></div><span>Nothing here yet</span>{lane.id === "upcoming" && <button onClick={openForm}>Add one</button>}</div>}
        </section>;
      })}
    </div>
  </>;
}

function CompetitionForm({ onClose, onSave }: { onClose: () => void; onSave: (item: Competition) => void }) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [track, setTrack] = useState<Competition["track"]>("Software");
  const [startDate, setStartDate] = useState(localDateKey());
  const [endDate, setEndDate] = useState(localDateKey());
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ id: createId(), name: name.trim(), duration: duration.trim(), organizer: organizer.trim(), track, startDate, endDate, lane: calculateLane(startDate, endDate) });
  };
  return <Modal title="Add a competition" subtitle="Keep the dates, details, and next step together." onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <Field label="Competition name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Smart India Hackathon" /></Field>
    <div className="form-grid"><Field label="Duration"><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="e.g. 36 hours" /></Field><Field label="Organized by"><input value={organizer} onChange={(event) => setOrganizer(event.target.value)} placeholder="Who is hosting it?" /></Field></div>
    <Field label="Track"><select value={track} onChange={(event) => setTrack(event.target.value as Competition["track"])}><option>Software</option><option>Hardware</option><option>Both</option></select></Field>
    <div className="form-grid"><Field label="Start date"><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><Field label="End date"><input required type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Add to board</button></div>
  </form></Modal>;
}

function RoadmapPage({ roadmap, updateData, password, storageMode, onRefresh, refreshing }: {
  roadmap: WorkspaceState["roadmap"]; updateData: UpdateData; password: string; storageMode: StorageMode;
  onRefresh: () => void; refreshing: boolean;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const result: Record<string, Record<string, RoadmapFile[]>> = {};
    for (const file of roadmap.files) {
      result[file.phase] ??= {};
      result[file.phase][file.folder] ??= [];
      result[file.phase][file.folder].push(file);
    }
    return result;
  }, [roadmap.files]);
  const completedCount = roadmap.files.filter((file) => roadmap.completed[file.id]).length;
  const overallProgress = roadmap.files.length ? Math.round(completedCount / roadmap.files.length * 100) : 0;
  const toggleFile = (id: string) => updateData((current) => ({ ...current, roadmap: { ...current.roadmap, completed: { ...current.roadmap.completed, [id]: !current.roadmap.completed[id] } } }));
  return <>
    <section className="roadmap-summary panel"><div className="roadmap-icon"><GitBranch size={20} /></div><div className="roadmap-summary-copy"><span className="eyebrow">A LIVING CHECKLIST</span><h2>Learn the foundations, one file at a time.</h2><p>Dayframe reads the public roadmap and keeps your checklist in sync.</p></div><div className="roadmap-summary-count"><strong>{completedCount}<span> / {roadmap.files.length}</span></strong><small>guides complete</small></div></section>
    <section className="roadmap-overall-progress panel"><div className="roadmap-progress-heading"><div><span className="eyebrow">OVERALL ROADMAP</span><h2>Your progress through the guide</h2><p>{completedCount} of {roadmap.files.length} markdown guides completed</p></div><strong>{overallProgress}%</strong></div><div className="roadmap-overall-track" role="progressbar" aria-label="Overall SWE roadmap progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallProgress}><span style={{ width: `${overallProgress}%` }} /></div></section>
    <div className="roadmap-toolbar"><div className="repo-link"><span className="repo-mark">⌘</span><div><strong>adi-training / swe-roadmap</strong><a href="https://github.com/adi-training/swe-roadmap" target="_blank" rel="noreferrer">View repository <ArrowUpRight size={12} /></a></div></div><div className="roadmap-sync"><span>{roadmap.syncedAt ? `Last checked ${new Date(roadmap.syncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not synced yet"}</span><button className="secondary-button small-button" disabled={refreshing} onClick={onRefresh}>{refreshing ? <span className="button-spinner" /> : <RefreshCw size={14} />}{refreshing ? "Checking…" : "Sync repository"}</button></div></div>
    {roadmap.files.length ? <div className="phase-list">
      {Object.entries(grouped).map(([phase, folders]) => {
        const phaseFiles = Object.values(folders).flat();
        const phaseDone = phaseFiles.filter((file) => roadmap.completed[file.id]).length;
        const phaseProgress = phaseFiles.length ? Math.round(phaseDone / phaseFiles.length * 100) : 0;
        return <section className="phase-card" key={phase}><header className="phase-header"><div><span className="phase-badge">{phase}</span><strong>{phaseDone} <span>/ {phaseFiles.length} files</span></strong></div><div className="phase-progress-wrap"><span>{phaseProgress}%</span><span className="phase-progress"><span style={{ width: `${phaseProgress}%` }} /></span></div></header>
          <div className="folder-list">{Object.entries(folders).map(([folder, files]) => {
            const isOpen = expandedFolders[folder] ?? true;
            const folderName = folder.split("/").filter((part) => !/^phase\s*[-_ ]?\s*\d+$/i.test(part)).join(" / ") || "General";
            return <div className="folder-group" key={folder}><button className="folder-heading" onClick={() => setExpandedFolders((current) => ({ ...current, [folder]: !isOpen }))}><ChevronDown className={!isOpen ? "folded" : ""} size={15} /><span className="folder-emoji">▱</span><strong>{folderName}</strong><span className="folder-count">{files.filter((file) => roadmap.completed[file.id]).length}/{files.length}</span></button>
              {isOpen && <div className="roadmap-files">{files.map((file) => <label className={`roadmap-file ${roadmap.completed[file.id] ? "file-complete" : ""}`} key={file.id}><input type="checkbox" checked={Boolean(roadmap.completed[file.id])} onChange={() => toggleFile(file.id)} /><span className="md-badge">MD</span><span>{file.name}</span><span className="file-path">{file.path}</span></label>)}</div>}
            </div>;
          })}</div>
        </section>;
      })}
    </div> : <div className="empty-state roadmap-empty"><div className="empty-icon"><GitBranch size={20} /></div><h3>Your roadmap starts with a sync</h3><p>Pull the Markdown files from the repository and Dayframe will arrange them by phase and folder.</p><button className="primary-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? <span className="button-spinner" /> : <RefreshCw size={15} />}{refreshing ? "Checking…" : "Sync roadmap"}</button>{storageMode === "local" && <small>The local Python API must be running to connect to GitHub.</small>}</div>}
    <div className="nightly-note"><Clock3 size={14} /><span>Automatic refresh is scheduled for midnight India time after deployment.</span></div>
  </>;
}

const PROJECT_LANES: { id: BoardLane; label: string; tint: string }[] = [
  { id: "upcoming", label: "Up next", tint: "lane-sky" },
  { id: "ongoing", label: "In progress", tint: "lane-lime" },
  { id: "ended", label: "Wrapped up", tint: "lane-muted" },
];

function projectProgress(project: Project): number {
  if (!project.tasks.length) return 0;
  return Math.round(project.tasks.filter((task) => task.complete).length / project.tasks.length * 100);
}

function ProjectsPage({ items, updateData, openForm, search }: { items: Project[]; updateData: UpdateData; openForm: () => void; search: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const filtered = items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const selected = items.find((project) => project.id === selectedId) ?? null;
  const moveItem = (id: string, lane: BoardLane) => updateData((current) => ({ ...current, projects: current.projects.map((project) => project.id === id ? { ...project, lane } : project) }));
  const deleteProject = (project: Project) => {
    if (!window.confirm(`Delete "${project.name}" and its tasks?`)) return;
    updateData((current) => ({ ...current, projects: current.projects.filter((item) => item.id !== project.id) }));
    setSelectedId((current) => current === project.id ? null : current);
  };
  return <>
    <div className="board-intro"><div className="board-count"><span className="count-dot project-dot" />{items.length} {items.length === 1 ? "project" : "projects"} in your space</div><p>Open a project for its tasks, due dates, and progress.</p></div>
    <div className="kanban-board project-board">
      {PROJECT_LANES.map((lane) => {
        const laneItems = filtered.filter((item) => item.lane === lane.id);
        return <section key={lane.id} className={`board-column ${lane.tint}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/dayframe-project"); if (id) moveItem(id, lane.id); setDraggedId(null); }}>
          <div className="column-heading"><div className="column-name"><span className="column-indicator" /><h2>{lane.label}</h2><span className="column-count">{laneItems.length}</span></div><button className="column-add" onClick={openForm} aria-label="Add a project"><Plus size={16} /></button></div>
          {laneItems.length ? <div className="board-cards">{laneItems.map((project) => <article key={project.id} className={`project-card ${draggedId === project.id ? "dragging" : ""}`} draggable onDragStart={(event) => { event.dataTransfer.setData("text/dayframe-project", project.id); setDraggedId(project.id); }} onDragEnd={() => setDraggedId(null)} onClick={() => setSelectedId(project.id)}>
            <div className="card-topline"><span className={`project-category project-${project.category.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-")}`}>{project.category}</span><div className="card-actions"><button className="delete-button" aria-label={`Delete ${project.name}`} title="Delete project" onClick={(event) => { event.stopPropagation(); deleteProject(project); }}><Trash2 size={14} /></button><GripVertical className="drag-handle" size={16} /></div></div><h3>{project.name}</h3>{project.description && <p className="project-description">{project.description}</p>}
            <div className="project-card-progress"><div className="progress-track"><span style={{ width: `${projectProgress(project)}%` }} /></div><strong>{projectProgress(project)}%</strong></div>
            <div className="project-card-bottom"><span><ListChecks size={13} />{project.tasks.filter((task) => task.complete).length}/{project.tasks.length} tasks</span><span><CalendarDays size={13} />{project.dueDate ? relativeDay(project.dueDate) : "No due date"}</span></div>
            <div className="card-footer"><span className="card-footnote">{project.dueDate ? `Due ${dateLabel(project.dueDate)}` : "Add a due date"}</span><select className="lane-select" value={project.lane} onChange={(event) => { event.stopPropagation(); moveItem(project.id, event.target.value as BoardLane); }} onClick={(event) => event.stopPropagation()} aria-label="Move project">{PROJECT_LANES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
          </article>)}</div> : <div className="column-empty"><div><Plus size={16} /></div><span>Nothing here yet</span>{lane.id === "upcoming" && <button onClick={openForm}>Start a project</button>}</div>}
        </section>;
      })}
    </div>
    {selected && <ProjectDetails key={selected.id} project={selected} onClose={() => setSelectedId(null)} onDelete={() => deleteProject(selected)} updateData={updateData} />}
  </>;
}

function ProjectForm({ onClose, onSave }: { onClose: () => void; onSave: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProjectCategory>("AI/ML");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ id: createId(), name: name.trim(), category, dueDate, lane: "upcoming", description: description.trim(), tasks: [] });
  };
  return <Modal title="Start a project" subtitle="Give the idea a name, a home, and a next step." onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <Field label="Project name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="What are you building?" /></Field>
    <div className="form-grid"><Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as ProjectCategory)}><option>AI/ML</option><option>Agentic AI</option><option>IoT</option><option>Robotics</option></select></Field><Field label="Due date"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field></div>
    <Field label="A little context"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is it, and why does it matter to you?" /></Field>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Create project</button></div>
  </form></Modal>;
}

function ProjectDetails({ project, onClose, onDelete, updateData }: { project: Project; onClose: () => void; onDelete: () => void; updateData: UpdateData }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [subtaskText, setSubtaskText] = useState("");
  const progress = projectProgress(project);
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    const task: ProjectTask = { id: createId(), title: title.trim(), dueDate, complete: false, subtasks: subtaskText.split(/\n|,/).map((item) => item.trim()).filter(Boolean).map((item) => ({ id: createId(), title: item, complete: false })) };
    updateData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, tasks: [...item.tasks, task] } : item) }));
    setTitle(""); setDueDate(""); setSubtaskText("");
  };
  const toggleProjectTask = (taskId: string) => updateData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, tasks: item.tasks.map((task) => task.id === taskId ? { ...task, complete: !task.complete } : task) }) }));
  const deleteProjectTask = (taskId: string) => {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task || !window.confirm(`Delete task "${task.title}"?`)) return;
    updateData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, tasks: item.tasks.filter((entry) => entry.id !== taskId) } : item) }));
  };
  const toggleNested = (taskId: string, subtaskId: string) => updateData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, tasks: item.tasks.map((task) => task.id !== taskId ? task : { ...task, subtasks: task.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, complete: !subtask.complete } : subtask) }) }) }));
  return <Modal title={project.name} subtitle={project.description || "Project workspace"} onClose={onClose}>
    <div className="project-detail-summary"><span className={`project-category project-${project.category.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-")}`}>{project.category}</span><span className="detail-due"><CalendarDays size={14} />{project.dueDate ? `Due ${dateLabel(project.dueDate, { month: "long", day: "numeric", year: "numeric" })}` : "No due date"}</span><div className="detail-progress"><span className="progress-track"><span style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div><button className="delete-button detail-delete" onClick={onDelete}><Trash2 size={14} /> Delete project</button></div>
    <div className="project-task-list"><div className="project-task-list-heading"><h3>Project tasks</h3><span>{project.tasks.filter((task) => task.complete).length} of {project.tasks.length} complete</span></div>
      {project.tasks.length ? project.tasks.map((task) => <div className="project-task-item" key={task.id}><div className="project-task-topline"><label className={`project-task-check ${task.complete ? "done" : ""}`}><input type="checkbox" checked={task.complete} onChange={() => toggleProjectTask(task.id)} /><span>{task.title}</span></label><button className="delete-button" onClick={() => deleteProjectTask(task.id)} aria-label={`Delete ${task.title}`} title="Delete task"><Trash2 size={13} /></button></div>{task.dueDate && <small className="project-task-date">Due {dateLabel(task.dueDate)}</small>}{task.subtasks.length > 0 && <div className="project-nested">{task.subtasks.map((subtask) => <label className={subtask.complete ? "done" : ""} key={subtask.id}><input type="checkbox" checked={subtask.complete} onChange={() => toggleNested(task.id, subtask.id)} /><span>{subtask.title}</span></label>)}</div>}</div>) : <p className="project-no-tasks">No tasks yet. Add a first step below.</p>}
    </div>
    <form className="project-add-task" onSubmit={addTask}><h3>Add a project task</h3><Field label="Task"><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A concrete next step" /></Field><div className="form-grid"><Field label="Due date"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field><Field label="Subtasks"><input value={subtaskText} onChange={(event) => setSubtaskText(event.target.value)} placeholder="Optional, comma separated" /></Field></div><button className="secondary-button small-button" type="submit"><Plus size={15} /> Add task</button></form>
  </Modal>;
}

function clockText(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function ForestPage({ data, updateData, selectedDate, setSelectedDate }: { data: WorkspaceState; updateData: UpdateData; selectedDate: string; setSelectedDate: (date: string) => void }) {
  const [mode, setMode] = useState<"timer" | "stopwatch">("timer");
  const [minutes, setMinutes] = useState(25);
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const totalSeconds = mode === "timer" ? minutes * 60 : seconds;
  const elapsedSeconds = mode === "timer" ? Math.max(0, minutes * 60 - seconds) : seconds;
  const progress = mode === "timer" ? Math.max(0, Math.min(100, elapsedSeconds / Math.max(1, minutes * 60) * 100)) : Math.min(100, seconds / 3600 * 100);
  const sessionsToday = data.focusSessions.filter((session) => session.date === localDateKey());
  const todayMinutes = sessionsToday.reduce((sum, session) => sum + session.durationMinutes, 0);
  const todayTrees = sessionsToday.reduce((sum, session) => sum + session.trees, 0);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekKey = localDateKey(weekStart);
  const monthKey = localDateKey().slice(0, 7);
  const thisWeek = data.focusSessions.filter((session) => session.date >= weekKey && session.date <= localDateKey());
  const thisMonth = data.focusSessions.filter((session) => session.date.startsWith(monthKey));
  const addSession = useCallback((elapsed: number, kind: "timer" | "stopwatch") => {
    const durationMinutes = Math.floor(elapsed / 60);
    if (durationMinutes < 1) return;
    const trees = Math.floor(durationMinutes / 25);
    const session: FocusSession = { id: createId(), date: localDateKey(), durationMinutes, kind, trees };
    updateData((current) => ({ ...current, focusSessions: [session, ...current.focusSessions] }));
  }, [updateData]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setSeconds((current) => mode === "timer" ? Math.max(0, current - 1) : current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [running, mode]);

  useEffect(() => {
    if (mode === "timer" && running && seconds === 0) {
      setRunning(false);
      addSession(minutes * 60, "timer");
    }
  }, [seconds, mode, running, minutes, addSession]);

  const selectDuration = (next: number) => {
    if (running) return;
    setMinutes(next);
    setSeconds(next * 60);
  };
  const switchMode = (next: "timer" | "stopwatch") => {
    setRunning(false);
    setMode(next);
    setSeconds(next === "timer" ? minutes * 60 : 0);
  };
  const finish = () => {
    if (elapsedSeconds >= 60) addSession(elapsedSeconds, mode);
    setRunning(false);
    setSeconds(mode === "timer" ? minutes * 60 : 0);
  };
  const reset = () => {
    setRunning(false);
    setSeconds(mode === "timer" ? minutes * 60 : 0);
  };
  const weeklyMinutes = thisWeek.reduce((sum, session) => sum + session.durationMinutes, 0);
  const monthlyMinutes = thisMonth.reduce((sum, session) => sum + session.durationMinutes, 0);
  const weeklyTrees = thisWeek.reduce((sum, session) => sum + session.trees, 0);
  const monthlyTrees = thisMonth.reduce((sum, session) => sum + session.trees, 0);
  const recent = [...data.focusSessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return <>
    <section className="forest-hero panel">
      <div className="forest-hero-copy"><span className="eyebrow">A QUIETER KIND OF PRODUCTIVITY</span><h2>Plant a seed.<br /><em>Stay for a while.</em></h2><p>Choose one thing, settle in, and let your forest grow alongside your focus.</p><div className="forest-hero-tags"><span><Leaf size={13} />No rush</span><span><Zap size={13} />One thing at a time</span></div></div>
      <div className="forest-landscape" aria-hidden="true"><div className="moon-glow" /><div className="hill hill-back" /><div className="hill hill-front" /><div className="forest-tree tree-one"><i /><b /><span /></div><div className="forest-tree tree-two"><i /><b /><span /></div><div className="forest-tree tree-three"><i /><b /><span /></div><div className="forest-firefly firefly-one" /><div className="forest-firefly firefly-two" /><div className="forest-firefly firefly-three" /></div>
    </section>
    <div className="forest-content-grid">
      <section className="timer-panel panel">
        <div className="timer-mode-switch"><button className={mode === "timer" ? "selected" : ""} onClick={() => switchMode("timer")}><Timer size={15} />Timer</button><button className={mode === "stopwatch" ? "selected" : ""} onClick={() => switchMode("stopwatch")}><AlarmClock size={15} />Stopwatch</button></div>
        <div className="timer-face" style={{ background: `conic-gradient(var(--lime) ${progress}%, #2b3743 ${progress}% 100%)` }}><div className="timer-inner"><span className="timer-mode-label">{running ? "IN THE GROOVE" : mode === "timer" ? "FOCUS SESSION" : "STOPWATCH"}</span><strong>{clockText(totalSeconds)}</strong><span className="timer-message">{running ? "You're doing just fine." : mode === "timer" ? "Time for one good session" : "Start when you're ready"}</span></div></div>
        {mode === "timer" && <div className="duration-choices"><span>SESSION LENGTH</span>{[25, 45, 60].map((value) => <button key={value} className={minutes === value ? "selected" : ""} disabled={running} onClick={() => selectDuration(value)}>{value} min</button>)}</div>}
        <div className="timer-actions">{running ? <button className="primary-button timer-primary" onClick={finish}><Pause size={17} />Finish session</button> : <button className="primary-button timer-primary" onClick={() => { if (mode === "timer" && seconds === 0) setSeconds(minutes * 60); setRunning(true); }}><Play size={17} fill="currentColor" />Start focusing</button>}<button className="icon-button timer-reset" aria-label="Reset timer" onClick={reset}><RotateCcw size={16} /></button></div>
        <p className="timer-hint">Sessions of 25 minutes or more grow a tree.</p>
      </section>
      <section className="forest-stats-panel panel">
        <div className="section-heading"><div><span className="eyebrow">LITTLE BY LITTLE</span><h2>Your forest</h2></div><div className="forest-emblem"><Trees size={17} /></div></div>
        <div className="forest-stats-grid"><div><span>TODAY</span><strong>{formatMinutes(todayMinutes)}</strong><small>{todayTrees} {todayTrees === 1 ? "tree" : "trees"} planted</small><div className="tiny-tree-row">{Array.from({ length: Math.min(todayTrees, 7) }).map((_, index) => <i key={index} />)}{todayTrees === 0 && <em>Your first one is waiting.</em>}</div></div><div><span>THIS WEEK</span><strong>{formatMinutes(weeklyMinutes)}</strong><small>{weeklyTrees} {weeklyTrees === 1 ? "tree" : "trees"} planted</small><div className="tiny-tree-row">{Array.from({ length: Math.min(weeklyTrees, 7) }).map((_, index) => <i key={index} />)}{weeklyTrees === 0 && <em>A fresh week to begin.</em>}</div></div><div><span>THIS MONTH</span><strong>{formatMinutes(monthlyMinutes)}</strong><small>{monthlyTrees} {monthlyTrees === 1 ? "tree" : "trees"} planted</small><div className="tiny-tree-row">{Array.from({ length: Math.min(monthlyTrees, 7) }).map((_, index) => <i key={index} />)}{monthlyTrees === 0 && <em>Growing in your own time.</em>}</div></div></div>
        <div className="forest-kind-note"><div className="forest-kind-icon"><Leaf size={15} /></div><p>Your forest reflects focused minutes, not perfect days. Take breaks whenever you need them.</p></div>
      </section>
    </div>
    <section className="recent-sessions panel"><div className="section-heading"><div><span className="eyebrow">A RECORD OF SHOWING UP</span><h2>Recent sessions</h2></div><button className="date-chip" onClick={() => setSelectedDate(localDateKey())}>Today <CalendarDays size={14} /></button></div>{recent.length ? <div className="session-list">{recent.map((session) => <div className="session-row" key={session.id}><div className="session-kind-icon">{session.kind === "timer" ? <Timer size={16} /> : <AlarmClock size={16} />}</div><div className="session-row-title"><strong>{session.kind === "timer" ? "Focus session" : "Stopwatch session"}</strong><span>{session.date === localDateKey() ? "Today" : dateLabel(session.date, { weekday: "short", month: "short", day: "numeric" })}</span></div><strong className="session-duration">{formatMinutes(session.durationMinutes)}</strong><span className="session-trees"><Trees size={14} />{session.trees}</span></div>)}</div> : <div className="sessions-empty"><span className="empty-icon"><Clock3 size={18} /></span><p>Your first focused session will show up here.</p></div>}</section>
  </>;
}

