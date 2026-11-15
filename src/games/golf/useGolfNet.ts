import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Course } from "../../../convex/golf/engine";
import { TPS, cmdOrder, type Cmd, type Packed, type Pending, type WorldState } from "../../../convex/golf/world";
import { useServerClock } from "@/lib/serverClock";

type Vec = { x: number; y: number };
const SEQ_SPAN = 1_000_000_000;
export type CmdKind = "shot" | "use" | "fire" | "hop" | "brake" | "reset";
export type CmdArgs = { a?: number; p?: number; i?: number; x?: number; y?: number };

export type Net = {
  state: WorldState | null;
  dirty: boolean;
  base: Packed | null;
  server: Cmd[];
  pending: Pending[];
  cmds: Cmd[];
  startAt: number;
  collide: boolean;
  prev: Map<string, Vec>;
  off: Map<string, Vec & { tau: number }>;
  seen: Map<string, number>;
  seq: number;
};

export function useGolfNet(COURSE: Course, minTick?: { current: number }) {
  const key = COURSE.id;
  const me = useQuery(api.users.me);
  const meId = me?._id;
  const view = useQuery(api.golf.world, { key });
  const join = useMutation(api.golf.join);
  const leave = useMutation(api.golf.leave);
  const [worldId, setWorldId] = useState<Id<"golfWorlds"> | null>(null);
  const worldIdRef = useRef<Id<"golfWorlds"> | null>(null);
  const joinRef = useRef(() => {});
  joinRef.current = () => {
    join({ key })
      .then((id) => {
        worldIdRef.current = id;
        setWorldId(id);
      })
      .catch(() => toast.error("Couldn't get onto the course."));
  };
  const leavesWithMe = !COURSE.open;
  useEffect(() => {
    joinRef.current();
    return () => {
      if (leavesWithMe && worldIdRef.current) void leave({ worldId: worldIdRef.current }).catch(() => {});
    };
  }, [key, leavesWithMe, leave]);
  const from = view?.snapshot?.tick ?? 0;
  const fromRef = useRef(from);
  fromRef.current = from;
  const cmds = useQuery(api.golf.commands, worldId ? { worldId, from } : "skip");
  const clock = useServerClock();
  const act = useMutation(api.golf.act);

  const net = useRef<Net>({
    state: null,
    dirty: false,
    base: null,
    server: [],
    pending: [],
    cmds: [],
    startAt: 0,
    collide: true,
    prev: new Map(),
    off: new Map(),
    seen: new Map(),
    seq: 0,
  });
  useEffect(() => {
    if (!view || !cmds) return;
    const n = net.current;
    n.base = view.snapshot;
    n.startAt = view.startAt;
    n.collide = view.collide;
    n.server = (cmds as Cmd[]).slice().sort(cmdOrder);
    n.dirty = true;
  }, [view, cmds]);
  const names = useMemo(() => new Map((view?.players ?? []).map((p) => [p.id as string, p.name.split(" ")[0]])), [view?.players]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const meRef = useRef(meId);
  meRef.current = meId;

  const tickNow = () => Math.max(0, Math.floor(((clock.now() - net.current.startAt) * TPS) / 1000));
  const send = (kind: CmdKind, extra: CmdArgs = {}) => {
    const n = net.current;
    if (!worldId || !meRef.current) return;
    const tick = Math.max(tickNow(), minTick?.current ?? 0);
    n.seq = (n.seq || Date.now() % SEQ_SPAN) + 1;
    const seq = n.seq;
    const mine: Pending = { tick, by: meRef.current, seq, kind, at: performance.now(), ...extra };
    n.pending.push(mine);
    n.dirty = true;
    act({ worldId, kind, clientTick: tick, seq, ...extra })
      .then(() => {
        mine.acked = true;
        n.pending.forEach((p) => p.seq === seq && (p.acked = true));
      })
      .catch(() => {
        n.pending = n.pending.filter((p) => p.seq !== seq);
        n.dirty = true;
        toast.error("That didn't go through.");
      });
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  return { meId, meRef, namesRef, worldIdRef, joinRef, fromRef, clock, net, send, sendRef };
}

export type GolfNet = ReturnType<typeof useGolfNet>;
