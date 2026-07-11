import { useEffect, useState } from 'react';

// Shared entity-state store. Every SimpleTile used to run its own 5 s
// setInterval + POST for a single entity — a dozen tiles meant ~150
// requests/minute and a dozen uncoordinated re-render clocks. This module
// batches all subscribed entity ids into ONE POST per tick (the backend
// endpoint already accepts an ids array) and fans results out per entity.
// Subscribers are only notified when *their* entity's payload actually
// changed, so an idle dashboard stops re-rendering entirely.
const POLL_MS = 5000;
// Debounce for the initial mount wave: a screenful of tiles subscribing in
// the same frame produces one fetch, not twelve.
const COALESCE_MS = 50;

const subscribers = new Map(); // entityId -> Set<callback(state, error)>
const cache = new Map();       // entityId -> { json, state }
let lastError = null;
let timer = null;
let soonTimer = null;
let inflight = false;

async function pollAll() {
  if (inflight || subscribers.size === 0 || document.hidden) return;
  inflight = true;
  const ids = [...subscribers.keys()];
  try {
    const r = await fetch('api/ha/entity/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json();
    const errorCleared = lastError != null;
    lastError = null;
    const byId = new Map();
    for (const st of Array.isArray(arr) ? arr : []) {
      if (st && st.entityId) byId.set(st.entityId, st);
    }
    for (const id of ids) {
      const state = byId.get(id) ?? null;
      const json = JSON.stringify(state);
      const prev = cache.get(id);
      if (!errorCleared && prev && prev.json === json) continue;
      cache.set(id, { json, state });
      for (const cb of subscribers.get(id) ?? []) cb(state, null);
    }
  } catch (e) {
    const msg = String(e);
    if (msg !== lastError) {
      lastError = msg;
      for (const set of subscribers.values()) {
        for (const cb of set) cb(undefined, msg);
      }
    }
  } finally {
    inflight = false;
  }
}

function schedulePoll() {
  if (soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = null; pollAll(); }, COALESCE_MS);
}

function onVisible() {
  if (!document.hidden) pollAll();
}

function subscribe(entityId, cb) {
  let set = subscribers.get(entityId);
  if (!set) { set = new Set(); subscribers.set(entityId, set); }
  set.add(cb);
  if (!timer) {
    timer = setInterval(pollAll, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  schedulePoll();
  return () => {
    set.delete(cb);
    if (set.size === 0) subscribers.delete(entityId);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

// Force an off-schedule refresh — used right after a service call so the
// toggled entity's new state lands without waiting out the poll interval.
export function refreshEntities() {
  pollAll();
}

// Live state for one entity from the shared store. Returns
// { state, error }: `state` is undefined until the first poll lands,
// null when HA doesn't know the entity.
export function useEntityState(entityId) {
  const [snap, setSnap] = useState(() => {
    const cached = entityId ? cache.get(entityId) : null;
    return { state: cached ? cached.state : undefined, error: null };
  });
  useEffect(() => {
    if (!entityId) return undefined;
    const cached = cache.get(entityId);
    setSnap({ state: cached ? cached.state : undefined, error: null });
    return subscribe(entityId, (state, error) => {
      setSnap((prev) => (error != null
        ? { state: prev.state, error }
        : { state, error: null }));
    });
  }, [entityId]);
  return snap;
}
