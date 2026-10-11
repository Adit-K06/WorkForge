export const TASK_CATEGORIES = ["Project", "SWE Guide", "Competition", "Study", "Gym", "College classes"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type ProjectCategory = "AI/ML" | "Agentic AI" | "IoT" | "Robotics";
export type BoardLane = "upcoming" | "ongoing" | "ended";

export type Subtask = { id: string; title: string; complete: boolean };
export type DayTask = {
  id: string;
  title: string;
  category: TaskCategory;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  description: string;
  date: string;
  complete: boolean;
  subtasks: Subtask[];
};
export type Competition = {
  id: string;
  name: string;
  duration: string;
  organizer: string;
  track: "Hardware" | "Software" | "Both";
  startDate: string;
  endDate: string;
  lane: BoardLane;
};
export type ProjectTask = {
  id: string;
  title: string;
  dueDate: string;
  complete: boolean;
  subtasks: Subtask[];
};
export type Project = {
  id: string;
  name: string;
  category: ProjectCategory;
  dueDate: string;
  lane: BoardLane;
  description: string;
  tasks: ProjectTask[];
};
export type RoadmapFile = { id: string; path: string; phase: string; folder: string; name: string };
export type FocusSession = { id: string; date: string; durationMinutes: number; kind: "timer" | "stopwatch"; trees: number };
export type TimetableBlock = {
  id: string;
  date: string;
  name: string;
  category: TaskCategory;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  taskId: string;
};
export type WorkspaceState = {
  tasks: DayTask[];
  competitions: Competition[];
  projects: Project[];
  roadmap: { files: RoadmapFile[]; completed: Record<string, boolean>; syncedAt: string | null };
  focusSessions: FocusSession[];
  timetable: TimetableBlock[];
};

export const EMPTY_STATE: WorkspaceState = {
  tasks: [],
  competitions: [],
  projects: [],
  roadmap: { files: [], completed: {}, syncedAt: null },
  focusSessions: [],
  timetable: [],
};

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatMinutes(value: number): string {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}
