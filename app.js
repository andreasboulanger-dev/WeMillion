(function () {
"use strict";

const HOME_VIEW = {
  center: [0, 0],
  // Low enough to fit the entire globe in view, but pulled in a bit
  // further than 0 so the planet reads bigger on screen. Higher zooms
  // (>1.4) start pulling in more detailed coastlines, which isn't
  // needed when the whole planet is visible at once anyway. This is
  // where the intro animation below comes to rest.
  zoom: 1.3,
  pitch: 0,
  bearing: 0,
};

// Intro animation: the globe starts as a tiny dot, far from the
// viewer, then slowly drifts in and decelerates hard so it settles
// right at HOME_VIEW's zoom instead of overshooting past the edges of
// the screen.
const INTRO_START_ZOOM = -1.6;
const INTRO_DURATION_MS = 5000;

/* ---------------------------------------------------------------- *
 *  Giant counter: tracks how many times *this* user has tapped
 *  "Add my beer" and saved an entry, persisted in localStorage so it
 *  survives reloads. Animates up to the stored count on page load,
 *  and animates a short increment each time a new beer is saved.
 *  Hard-capped at one million.
 * ---------------------------------------------------------------- */

const COUNTER_MAX = 1000000;
const COUNTER_STORAGE_KEY = "beerCounterCount";
const COUNTER_LOAD_DURATION_MS = 1200;
const COUNTER_INCREMENT_DURATION_MS = 400;

const beerCounterEl = document.getElementById("beer-counter-value");
const beerCounterRemainingEl = document.getElementById("beer-counter-remaining");

// Which window the counter (and the globe's beer lights) are currently
// scoped to — changed via the dropdown below the counter. "all" mirrors
// the original always-on behaviour; "week"/"24h" filter both display
// down to entries from that window.
let selectedCounterRange = "all";

// Reads back whatever number is currently painted on the counter (mid
// count-up-animation or settled), so a new animation can smoothly
// continue from wherever the display actually is right now.
function currentDisplayedCounterValue() {
  const parsed = parseInt((beerCounterEl.textContent || "0").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBeerCount() {
  const stored = parseInt(localStorage.getItem(COUNTER_STORAGE_KEY), 10);
  return Number.isFinite(stored) ? Math.min(stored, COUNTER_MAX) : 0;
}

function setBeerCount(value) {
  const clamped = Math.min(Math.max(0, value), COUNTER_MAX);
  localStorage.setItem(COUNTER_STORAGE_KEY, String(clamped));
  return clamped;
}

// "N beers to go" — kept in sync with the big number itself, including
// while it's mid-animation, so the two count together.
function renderRemaining(value) {
  if (!beerCounterRemainingEl) return;
  const remaining = Math.max(0, COUNTER_MAX - value);
  const noun = remaining === 1 ? "beer" : "beers";
  beerCounterRemainingEl.textContent = `${remaining.toLocaleString("en-US")} ${noun} to go`;
}

// Ease-out so counts settle gently onto the final number instead of a
// flat linear count that feels mechanical.
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

function animateBeerCounter(from, to, durationMs) {
  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const value = Math.round(from + (to - from) * easeOutExpo(t));
    beerCounterEl.textContent = value.toLocaleString("en-US");
    renderRemaining(value);
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// On load, animate up from 0 to whatever this user has already logged.
animateBeerCounter(0, getBeerCount(), COUNTER_LOAD_DURATION_MS);

// Call this whenever a beer is successfully saved. The all-time cache
// in localStorage always advances, since a new entry is always "now"
// and so always belongs in every range — but if a filtered range
// (Week / 24h) is currently on screen, animate the visible number from
// wherever it actually is rather than snapping it to the all-time
// total.
function incrementBeerCounter() {
  const before = getBeerCount();
  const after = setBeerCount(before + 1);
  if (selectedCounterRange === "all") {
    if (after !== before) animateBeerCounter(before, after, COUNTER_INCREMENT_DURATION_MS);
  } else {
    const displayedBefore = currentDisplayedCounterValue();
    animateBeerCounter(displayedBefore, displayedBefore + 1, COUNTER_INCREMENT_DURATION_MS);
  }
}

/* ---------------------------------------------------------------- *
 *  "N beers to go": visible right away in its resting spot under the
 *  label, then quietly fades away a few seconds after load.
 * ---------------------------------------------------------------- */

const REMAINING_FADE_DELAY_MS = 5000;

setTimeout(() => {
  if (beerCounterRemainingEl) beerCounterRemainingEl.classList.add("is-hidden");
}, REMAINING_FADE_DELAY_MS);

/* ---------------------------------------------------------------- *
 *  Counter time-range control: lets the person scope both the giant
 *  counter and the globe's beer lights to the last 24h, the last
 *  week, or all time. An icon-only button, pinned below the counter
 *  on the screen's left edge (positioned by JS so it always clears
 *  the counter's block regardless of its responsive font size);
 *  tapping it reveals a segmented pill to its right whose active
 *  segment is itself a draggable thumb — press and drag it across the
 *  pill like an iOS segmented control, or just tap a label directly.
 * ---------------------------------------------------------------- */

const COUNTER_RANGE_ORDER = ["all", "week", "24h"];

const counterRangePanel = document.getElementById("counter-range-panel");
const counterRangeBtn = document.getElementById("counter-range-btn");
const counterRangeTrack = document.getElementById("counter-range-track");
const counterRangeThumb = document.getElementById("counter-range-thumb");
const counterRangeSegs = Array.from(document.querySelectorAll(".counter-range-seg"));
const beerCounterContainer = document.getElementById("beer-counter");

function positionCounterRangePanel() {
  if (!counterRangePanel || !beerCounterContainer) return;
  const rect = beerCounterContainer.getBoundingClientRect();
  counterRangePanel.style.top = `${Math.round(rect.bottom + 12)}px`;
}

positionCounterRangePanel();
window.addEventListener("resize", positionCounterRangePanel);
// The counter's own load-in animation doesn't change its height (one
// line at a fixed font size throughout), but a re-check shortly after
// covers any font/layout settling right after first paint.
setTimeout(positionCounterRangePanel, COUNTER_LOAD_DURATION_MS);

function openCounterRangeTrack() {
  counterRangeTrack.hidden = false;
  requestAnimationFrame(() => {
    counterRangeTrack.classList.add("is-open");
  });
  counterRangeBtn.setAttribute("aria-expanded", "true");
  document.addEventListener("click", onDocumentClickForCounterRange, true);
  document.addEventListener("keydown", onDocumentKeydownForCounterRange);
}

function closeCounterRangeTrack() {
  counterRangeTrack.classList.remove("is-open");
  counterRangeBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDocumentClickForCounterRange, true);
  document.removeEventListener("keydown", onDocumentKeydownForCounterRange);
  const onTransitionEnd = () => {
    counterRangeTrack.hidden = true;
    counterRangeTrack.removeEventListener("transitionend", onTransitionEnd);
  };
  counterRangeTrack.addEventListener("transitionend", onTransitionEnd);
}

function onDocumentClickForCounterRange(e) {
  if (counterRangeTrack.contains(e.target) || counterRangeBtn.contains(e.target)) return;
  closeCounterRangeTrack();
}

function onDocumentKeydownForCounterRange(e) {
  if (e.key === "Escape") closeCounterRangeTrack();
}

counterRangeBtn.addEventListener("click", () => {
  if (counterRangeTrack.classList.contains("is-open")) {
    closeCounterRangeTrack();
  } else {
    openCounterRangeTrack();
  }
});

// Re-fetches the worldwide count scoped to `range` and animates the
// counter from whatever it's currently showing to the new total. When
// scoped to "all", also true up the localStorage cache that the rest
// of the counter logic (increments, initial load) reads from.
async function refreshCounterForRange(range) {
  try {
    let query = supabaseClient.from("beer_entries").select("*", { count: "exact", head: true });
    const cutoffIso = leaderboardRangeCutoffIso(range);
    if (cutoffIso) query = query.gte("created_at", cutoffIso);
    const { count, error } = await query;
    if (error) throw error;
    if (typeof count === "number") {
      animateBeerCounter(currentDisplayedCounterValue(), count, COUNTER_LOAD_DURATION_MS);
      if (range === "all") setBeerCount(count);
    }
  } catch (err) {
    console.error("Failed to load beer count for range:", range, err);
  }
}

// "N beers to go" only makes sense against the all-time total, so it's
// hidden whenever a filtered range is showing instead of the all-time
// count.
function applyCounterRange(range) {
  if (beerCounterRemainingEl) beerCounterRemainingEl.hidden = range !== "all";
  refreshCounterForRange(range);
  initBeerLights(range);
}

// Applies `range` as the active segment: updates state, the visual
// selection (thumb position + label styling/aria), and re-scopes the
// counter/globe. Shared by both the tap-a-label path and the
// drag-and-release path below.
function selectCounterRange(range, { animateThumb = true } = {}) {
  const index = COUNTER_RANGE_ORDER.indexOf(range);
  if (index === -1) return;

  const changed = range !== selectedCounterRange;
  selectedCounterRange = range;

  counterRangeSegs.forEach((seg) => {
    const selected = seg.dataset.range === range;
    seg.classList.toggle("is-selected", selected);
    seg.setAttribute("aria-checked", selected ? "true" : "false");
  });

  if (!animateThumb) counterRangeThumb.classList.add("is-dragging");
  counterRangeThumb.style.transform = `translateX(${index * 100}%)`;
  if (!animateThumb) {
    // Force a reflow so the transform above applies instantly before
    // transitions are re-enabled, otherwise the next real drag/snap
    // would animate from the stale position.
    void counterRangeThumb.offsetWidth;
    counterRangeThumb.classList.remove("is-dragging");
  }

  if (changed) applyCounterRange(range);
}

counterRangeSegs.forEach((seg) => {
  seg.addEventListener("click", () => {
    selectCounterRange(seg.dataset.range);
    closeCounterRangeTrack();
  });
});

/* -- Dragging the active thumb directly, finger-following. -- */

let counterRangeDragging = false;
let counterRangeDragSegWidth = 0;
let counterRangeDragTrackLeft = 0;
let counterRangeDragX = 0;

function onCounterRangeThumbPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  counterRangeDragging = true;
  counterRangeThumb.classList.add("is-dragging");
  counterRangeThumb.setPointerCapture(e.pointerId);

  const trackRect = counterRangeTrack.getBoundingClientRect();
  const trackPadding = 3; // must match .counter-range-track padding
  counterRangeDragTrackLeft = trackRect.left + trackPadding;
  counterRangeDragSegWidth = (trackRect.width - trackPadding * 2) / COUNTER_RANGE_ORDER.length;
  counterRangeDragX = counterRangeDragSegWidth * COUNTER_RANGE_ORDER.indexOf(selectedCounterRange);
}

function onCounterRangeThumbPointerMove(e) {
  if (!counterRangeDragging) return;
  const maxX = counterRangeDragSegWidth * (COUNTER_RANGE_ORDER.length - 1);
  counterRangeDragX = Math.max(0, Math.min(maxX, e.clientX - counterRangeDragTrackLeft - counterRangeDragSegWidth / 2));
  counterRangeThumb.style.transform = `translateX(${counterRangeDragX}px)`;
}

function onCounterRangeThumbPointerUp() {
  if (!counterRangeDragging) return;
  counterRangeDragging = false;
  counterRangeThumb.classList.remove("is-dragging");

  const index = Math.round(counterRangeDragX / counterRangeDragSegWidth);
  const range = COUNTER_RANGE_ORDER[Math.max(0, Math.min(COUNTER_RANGE_ORDER.length - 1, index))];
  selectCounterRange(range);
  // Let the snap-into-place animation (see .counter-range-thumb's
  // transition) actually play before the track closes, same as
  // tapping a label does immediately.
  setTimeout(closeCounterRangeTrack, 280);
}

counterRangeThumb.addEventListener("pointerdown", onCounterRangeThumbPointerDown);
counterRangeThumb.addEventListener("pointermove", onCounterRangeThumbPointerMove);
counterRangeThumb.addEventListener("pointerup", onCounterRangeThumbPointerUp);
counterRangeThumb.addEventListener("pointercancel", onCounterRangeThumbPointerUp);

/* ---------------------------------------------------------------- *
 *  Supabase: gives every visitor a persistent (anonymous) identity,
 *  a profile row, and a shared, server-side beer log so entries and
 *  the "worldwide" counter are real across users/devices instead of
 *  just this browser's localStorage.
 * ---------------------------------------------------------------- */

const SUPABASE_URL = "https://zugfkgjcynebefivwwqx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1Z2ZrZ2pjeW5lYmVmaXZ3d3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjM4MDAsImV4cCI6MjEwMjQzOTgwMH0.qX5HVyCjmZJpsj0WWFhcuYq5IUThl8A89eIMwVdHZw8";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null; // { id, username, avatar_emoji, created_at }

// Sign the visitor in anonymously (or restore their existing anonymous
// session), make sure a profiles row exists (handled server-side by a
// trigger on auth.users), then load it and true up the beer counter
// against the real server-side total.
async function initSupabaseUser() {
  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    currentUser = session && session.user ? session.user : null;

    if (!currentUser) {
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      currentUser = data.user;
    }

    await loadProfile();
  } catch (err) {
    // Most likely cause: Anonymous Sign-Ins isn't enabled for this
    // Supabase project yet (Authentication -> Providers -> Anonymous).
    console.error("Supabase sign-in failed — profile and shared beer log are unavailable:", err);
  }

  refreshBeerCounterFromServer();
}

async function loadProfile() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_emoji, created_at")
      .eq("id", currentUser.id)
      .single();
    if (error) throw error;
    currentProfile = data;
    renderProfile();
  } catch (err) {
    console.error("Failed to load profile:", err);
  }
}

// Corrects the (locally-animated) counter to the real worldwide total
// once the server responds, and updates the local cache it's animated
// from so future increments stay in sync.
async function refreshBeerCounterFromServer() {
  try {
    const { count, error } = await supabaseClient.from("beer_entries").select("*", { count: "exact", head: true });
    if (error) throw error;
    if (typeof count === "number") {
      const before = getBeerCount();
      const after = setBeerCount(count);
      animateBeerCounter(before, after, COUNTER_LOAD_DURATION_MS);
    }
  } catch (err) {
    console.error("Failed to load worldwide beer count:", err);
  }
}

initSupabaseUser();

const map = new maplibregl.Map({
  container: "map",
  // Free, no API key, vector style with good default cartography.
  // Dark style so the map matches the night-sky/globe aesthetic.
  // Swap for MapTiler / Protomaps / your own style URL if you prefer.
  style: "https://tiles.openfreemap.org/styles/dark",
  center: HOME_VIEW.center,
  // Starts far zoomed out; the intro animation below eases it in to
  // HOME_VIEW.zoom once the style/globe projection are ready. minZoom
  // is lowered from MapLibre's default of 0 so this negative starting
  // zoom isn't silently clamped away before it can even render.
  zoom: INTRO_START_ZOOM,
  minZoom: -2,
  attributionControl: false,
  dragRotate: true,
  touchZoomRotate: true,
  // antialias sharpens coastlines/borders that otherwise look
  // jagged/pixelated on the WebGL canvas. alpha lets the canvas render
  // partially transparent pixels (used for the starfield below to show
  // through the sky).
  canvasContextAttributes: { antialias: true, alpha: true },
});

map.on("style.load", () => {
  map.setProjection({ type: "globe" });

  // Remove all text labels (place names, road names, POI labels, etc).
  // Also force every fill/background layer fully opaque: the "dark" style
  // was designed as an overlay basemap and ships several layers (water,
  // landcover) with fill-opacity < 1, which is fine on a flat opaque page
  // background but on the globe lets you see straight through the sphere.
  map.getStyle().layers.forEach((layer) => {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
    if (layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-opacity", 1);
    }
    if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-opacity", 1);
    }
  });

  // Atmosphere/sky. Note: MapLibre v5+ removed the old setFog() API —
  // fog properties now live inside setSky() instead.
  // sky-color is given with a touch of transparency (alpha 0.92) so the
  // CSS starfield behind the canvas subtly shows through the open sky;
  // horizon-color stays fully opaque so the glowing rim isn't muddied.
  map.setSky({
    "sky-color": "rgba(11, 15, 26, 0.92)",
    "horizon-color": "#245cdf",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.5,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  });

  // The sun-like specular highlight/glare on the globe comes from
  // MapLibre's separate `light` property (not `sky`), which by default
  // lights the scene from an implicit direction. Zero its intensity for
  // even, flat lighting now that the day/night sun logic is gone.
  map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0 });

  try {
    initBeerLights();
    map.on("move", updateBeerLightFade);
  } catch (err) {
    console.error("Beer lights setup failed:", err);
  }

  updateStarfield();
  map.on("move", updateStarfield);

  // Slow, dramatic entrance: hard deceleration (quintic ease-out) so
  // the globe drifts toward the viewer over several seconds and
  // settles at HOME_VIEW's zoom rather than overshooting past the
  // screen edges. Auto-rotate only kicks in once this settles, so it
  // doesn't fight the zoom.
  map.easeTo({
    zoom: HOME_VIEW.zoom,
    duration: INTRO_DURATION_MS,
    easing: (t) => 1 - Math.pow(1 - t, 5),
  });
  map.once("moveend", startAutoRotate);
});

/* ---------------------------------------------------------------- *
 *  Starfield: tracks the globe's rotation so the sky behind it isn't
 *  static. Longitude/latitude of the point you're facing pan the
 *  tiled star pattern (parallax), and bearing rotates it (compass).
 * ---------------------------------------------------------------- */

const starsEl = document.getElementById("stars");
const STAR_PARALLAX_PX_PER_DEG = 4; // aesthetic, not physically exact

function updateStarfield() {
  const center = map.getCenter();
  const bearing = map.getBearing();
  const xOffset = -(center.lng * STAR_PARALLAX_PX_PER_DEG);
  const yOffset = center.lat * STAR_PARALLAX_PX_PER_DEG;
  starsEl.style.backgroundPosition = `${xOffset}px ${yOffset}px`;
  starsEl.style.transform = `rotate(${bearing}deg)`;
}

/* ---------------------------------------------------------------- *
 *  Auto-rotate: a slow, continuous drift so the globe is never
 *  perfectly still. Pauses the instant the user interacts (drag,
 *  wheel, touch), and quietly resumes a couple seconds after they
 *  let go, rather than staying off for the rest of the session.
 * ---------------------------------------------------------------- */

const AUTO_ROTATE_DEG_PER_TICK = 0.12;
const AUTO_ROTATE_INTERVAL_MS = 50; // ~20fps instead of every animation frame (~60fps)
const AUTO_ROTATE_RESUME_DELAY_MS = 2000;

function startAutoRotate() {
  let paused = false;
  let resumeTimer = null;

  function pause() {
    paused = true;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      paused = false;
    }, AUTO_ROTATE_RESUME_DELAY_MS);
  }

  // Ticking on a fixed interval instead of every requestAnimationFrame
  // roughly halves how often we force the globe to re-render. Each
  // re-render triggers MapLibre's per-frame depth-buffer readback (used
  // to hide beer-light markers behind the globe), and doing that at full
  // 60fps nonstop is what was behind the "READ-usage buffer" console
  // warnings — a GPU performance advisory, not a functional bug, but
  // easy to quiet down since a slow drift doesn't need 60fps anyway.
  setInterval(() => {
    if (paused) return;
    const center = map.getCenter();
    center.lng -= AUTO_ROTATE_DEG_PER_TICK;
    map.setCenter(center);
  }, AUTO_ROTATE_INTERVAL_MS);

  map.on("dragstart", pause);
  map.on("wheel", pause);
  map.on("touchstart", pause);
  // dragging/zooming keeps firing move events the whole time it's held,
  // so re-arming the resume timer on drag/zoom (not just at the start)
  // stops auto-rotate from kicking back in mid-interaction.
  map.on("drag", pause);
  map.on("zoom", pause);
}

/* ---------------------------------------------------------------- *
 *  Beer lights: one glowing, twinkling marker per beer a user has
 *  logged, placed at the exact spot they were standing when they
 *  saved it. No random/decorative lights — only real entries,
 *  persisted in localStorage so they're still there next visit.
 * ---------------------------------------------------------------- */

const BEER_LIGHTS_STORAGE_KEY = "beerLightLocations";
let beerLights = []; // [{ lat, lng, el, fade, marker }]

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Great-circle angle (in degrees) between two lat/lng points.
function angularDistanceDeg(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const dLng = (lng2 - lng1) * rad;
  const cosC = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return Math.acos(Math.max(-1, Math.min(1, cosC))) * (180 / Math.PI);
}

const EARTH_RADIUS_METERS = 6371000;

// Great-circle distance in meters, built on the angular distance above.
function distanceMeters(lat1, lng1, lat2, lng2) {
  return angularDistanceDeg(lat1, lng1, lat2, lng2) * (Math.PI / 180) * EARTH_RADIUS_METERS;
}

function getStoredBeerLightLocations() {
  try {
    return JSON.parse(localStorage.getItem(BEER_LIGHTS_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function createBeerLightMarker(lat, lng) {
  // Three-level structure so each concern owns its own opacity:
  // el (positioned by the Marker, hard-hidden by opacityWhenCovered
  // once truly on the far side) > fade (our own soft opacity, eased
  // toward 0 as the dot nears the horizon) > dot (twinkle animation).
  const el = document.createElement("div");
  el.className = "beer-light";

  const fade = document.createElement("div");
  fade.className = "beer-light-fade";

  const dot = document.createElement("div");
  dot.className = "beer-light-dot";
  dot.style.animationDuration = `${(2 + Math.random() * 3).toFixed(2)}s`;
  dot.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s`;

  fade.appendChild(dot);
  el.appendChild(fade);

  // opacityWhenCovered: 0 fully hides the dot once it's truly behind
  // the globe (MapLibre tracks this automatically), as a hard backstop
  // beneath the soft fade below.
  const marker = new maplibregl.Marker({ element: el, opacityWhenCovered: 0 })
    .setLngLat([lng, lat])
    .addTo(map);
  return { lat, lng, el, fade, marker };
}

// Renders every beer logged so far, worldwide (public read on
// beer_entries) — falling back to this device's own localStorage
// cache if the server is unreachable. Re-runnable: called again by
// the counter time-range dropdown to rescope which lights are shown,
// clearing out whatever's currently on the globe first.
async function initBeerLights(range = "all") {
  beerLights.forEach((light) => light.marker.remove());
  beerLights = [];

  let locations = [];
  try {
    let query = supabaseClient
      .from("beer_entries")
      .select("bar_lat, bar_lng, created_at")
      .not("bar_lat", "is", null)
      .not("bar_lng", "is", null);
    const cutoffIso = leaderboardRangeCutoffIso(range);
    if (cutoffIso) query = query.gte("created_at", cutoffIso);
    const { data, error } = await query;
    if (error) throw error;
    locations = (data || []).map((row) => ({ lat: row.bar_lat, lng: row.bar_lng }));
  } catch (err) {
    console.error("Failed to load shared beer lights, falling back to local cache:", err);
    // The local cache has no timestamps to filter by, so it only makes
    // sense as a fallback for the all-time view.
    locations = range === "all" ? getStoredBeerLightLocations() : [];
  }

  beerLights = locations.map(({ lat, lng }) => createBeerLightMarker(lat, lng));
  updateBeerLightFade();
}

// Called right after a beer is saved: drops a new light immediately
// and keeps a local cache as an offline fallback for initBeerLights.
function addBeerLight(lat, lng) {
  const stored = getStoredBeerLightLocations();
  stored.push({ lat, lng });
  localStorage.setItem(BEER_LIGHTS_STORAGE_KEY, JSON.stringify(stored));

  beerLights.push(createBeerLightMarker(lat, lng));
  updateBeerLightFade();
}

// Fades each dot out gradually as it curves away toward the horizon,
// instead of popping visible/invisible at a hard edge.
const LIGHT_FADE_START_DEG = 60; // full opacity within this angle of the facing point
const LIGHT_FADE_END_DEG = 90; // fully faded out by the true horizon

function updateBeerLightFade() {
  const center = map.getCenter();
  beerLights.forEach((light) => {
    const dist = angularDistanceDeg(center.lat, center.lng, light.lat, light.lng);
    const t = clamp01((LIGHT_FADE_END_DEG - dist) / (LIGHT_FADE_END_DEG - LIGHT_FADE_START_DEG));
    light.fade.style.opacity = t.toFixed(2);
  });
}

/* ---------------------------------------------------------------- *
 *  "Add my beer" flow: camera -> drawer (nearby bar, beer, price,
 *  rating — every field optional).
 * ---------------------------------------------------------------- */

const addBeerBtn = document.getElementById("add-beer-btn");
const beerPhotoInput = document.getElementById("beer-photo-input");

const sheetBackdrop = document.getElementById("sheet-backdrop");
const beerSheet = document.getElementById("beer-sheet");
const beerForm = document.getElementById("beer-form");
const beerPhotoThumb = document.getElementById("beer-photo-thumb");

const barSearchInput = document.getElementById("bar-search-input");
const barSearchResults = document.getElementById("bar-search-results");
const barRequiredHint = document.getElementById("bar-required-hint");

const beerChipRow = document.getElementById("beer-chip-row");
const beerSearch = document.getElementById("beer-search");
const beerSearchInput = document.getElementById("beer-search-input");
const beerSearchResults = document.getElementById("beer-search-results");

const priceCarousel = document.getElementById("price-carousel");

const legendPopup = document.getElementById("legend-popup");

const starButtons = Array.from(document.querySelectorAll(".star"));
const saveBeerBtn = document.getElementById("save-beer-btn");

let currentRating = 0;
let capturedPhotoDataUrl = null;

/* ---------------------------------------------------------------- *
 *  Step 1: tapping the CTA opens the camera directly (via a hidden
 *  file input with capture="environment"). Once a photo comes back,
 *  it's kept and the drawer opens straight away — no separate
 *  "is this photo good?" confirmation step.
 * ---------------------------------------------------------------- */

addBeerBtn.addEventListener("click", () => {
  // Reset the input first so choosing the "same" photo twice in a
  // row still fires a change event.
  beerPhotoInput.value = "";
  beerPhotoInput.click();
});

beerPhotoInput.addEventListener("change", () => {
  const file = beerPhotoInput.files && beerPhotoInput.files[0];
  if (!file) return; // user cancelled the camera/picker

  const reader = new FileReader();
  reader.onload = () => {
    capturedPhotoDataUrl = reader.result;
    openBeerSheet();
  };
  reader.readAsDataURL(file);
});

/* ---------------------------------------------------------------- *
 *  Step 2: the drawer itself.
 * ---------------------------------------------------------------- */

// Only one drawer/sheet is ever open at a time — opening any of them
// closes whichever other one currently happens to be showing first.
function closeOtherSheets(exceptSheet) {
  if (exceptSheet !== beerSheet && !beerSheet.hidden) closeBeerSheet();
  if (exceptSheet !== profileSheet && !profileSheet.hidden) closeProfileSheet();
  if (exceptSheet !== statsSheet && !statsSheet.hidden) closeStatsSheet();
  if (exceptSheet !== battlefieldSheet && !battlefieldSheet.hidden) closeBattlefieldSheet();
}

function openBeerSheet() {
  closeOtherSheets(beerSheet);
  sheetBackdrop.hidden = false;
  beerSheet.hidden = false;
  // Two rAFs so the browser paints the hidden->visible state first,
  // otherwise the slide-up transition gets skipped.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheetBackdrop.classList.add("is-open");
      beerSheet.classList.add("is-open");
    });
  });

  if (capturedPhotoDataUrl) {
    beerPhotoThumb.src = capturedPhotoDataUrl;
    beerPhotoThumb.hidden = false;
  }

  resetBarState();
  resetBeerNameState();
  resetPriceState();
  renderBeerChips();
  locateUserForBars();
}

function closeBeerSheet() {
  sheetBackdrop.classList.remove("is-open");
  beerSheet.classList.remove("is-open");
  const onTransitionEnd = () => {
    sheetBackdrop.hidden = true;
    beerSheet.hidden = true;
    beerSheet.removeEventListener("transitionend", onTransitionEnd);
  };
  beerSheet.addEventListener("transitionend", onTransitionEnd);
}

function resetBeerForm() {
  setRating(0);
  capturedPhotoDataUrl = null;
  beerPhotoThumb.hidden = true;
  beerPhotoThumb.src = "";
  resetBarState();
  resetBeerNameState();
  resetPriceState();
}

sheetBackdrop.addEventListener("click", closeBeerSheet);

/* ---------------------------------------------------------------- *
 *  Shared little "chip" builder used by both the Nearby and Beer
 *  rows: a pill button that's either a fixed suggestion or the
 *  toggleable "Other…" chip.
 * ---------------------------------------------------------------- */

function createChip(label, isSelected) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip" + (isSelected ? " is-selected" : "");
  chip.textContent = label;
  chip.setAttribute("role", "radio");
  chip.setAttribute("aria-checked", isSelected ? "true" : "false");
  return chip;
}

/* ---------------------------------------------------------------- *
 *  Bar: required — the user always types it in. As they type, a
 *  dropdown suggests bars already logged by anyone in the app (from
 *  beer_entries itself, not an external POI database), fuzzy-matched
 *  by name and, once we know the user's location, narrowed to ones
 *  very close by. Picking a suggestion reuses its stored coordinates
 *  so repeat visits to the same spot land on the same lat/lng, which
 *  keeps Battlefield claims tied to one consistent bar instead of
 *  splintering across near-duplicate names. With location access off
 *  there's nothing to narrow by, so every matching bar name in the
 *  database shows instead.
 * ---------------------------------------------------------------- */

const NEARBY_RADIUS_METERS = 1500;

let userLat = null;
let userLng = null;
let locationStatus = "pending"; // "pending" | "granted" | "denied"
let selectedBarName = null;
let selectedBarLat = null;
let selectedBarLng = null;
let barTextSearchTimer = null;
let barSearchRequestId = 0; // guards a slow, stale lookup from clobbering a newer one

function resetBarState() {
  userLat = null;
  userLng = null;
  locationStatus = "pending";
  selectedBarName = null;
  selectedBarLat = null;
  selectedBarLng = null;
  clearTimeout(barTextSearchTimer);
  barSearchInput.value = "";
  barSearchResults.innerHTML = "";
  barRequiredHint.classList.remove("field-hint-error");
  updateBarHint();
}

function locateUserForBars() {
  if (!navigator.geolocation) {
    locationStatus = "denied";
    updateBarHint();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      locationStatus = "granted";
      updateBarHint();
      // Re-run whatever's already typed now that there's a location to
      // narrow suggestions by.
      if (barSearchInput.value.trim().length >= 2) debounceBarTextSearch(barSearchInput.value);
    },
    () => {
      locationStatus = "denied";
      updateBarHint();
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Contextual line under the input: what "nearby" means right now, or —
// once the user's tried to save without a name — a validation error.
function updateBarHint() {
  barRequiredHint.hidden = false;
  if (locationStatus === "granted") {
    barRequiredHint.textContent = "Showing bars near you as you type.";
  } else if (locationStatus === "denied") {
    barRequiredHint.textContent = "Location is off — showing every matching bar.";
  } else {
    barRequiredHint.textContent = "Start typing to search.";
  }
}

function selectBar(name, lat = null, lon = null) {
  selectedBarName = name;
  selectedBarLat = lat;
  selectedBarLng = lon;
  barSearchInput.value = name;
  barSearchResults.innerHTML = "";
}

barSearchInput.addEventListener("input", () => {
  const value = barSearchInput.value;
  // Every keystroke counts as the entered name, so simply typing
  // (without picking a suggestion) still satisfies the requirement —
  // coordinates just stay unset until/unless a suggestion is picked.
  selectedBarName = value.trim() || null;
  selectedBarLat = null;
  selectedBarLng = null;
  barRequiredHint.classList.remove("field-hint-error");
  updateBarHint();
  debounceBarTextSearch(value);
});

// Live search against our own beer_entries, debounced so it's one
// request per pause in typing rather than per keystroke.
function debounceBarTextSearch(query) {
  clearTimeout(barTextSearchTimer);
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    barSearchResults.innerHTML = "";
    return;
  }
  barSearchResults.innerHTML = '<li class="search-hint">Searching…</li>';
  barTextSearchTimer = setTimeout(async () => {
    const requestId = ++barSearchRequestId;
    try {
      const matches = await fetchBarSuggestions(trimmed, userLat, userLng);
      if (requestId !== barSearchRequestId) return; // superseded by newer typing
      renderBarSearchResults(matches);
    } catch (err) {
      if (requestId !== barSearchRequestId) return;
      console.error("Bar name search failed:", err);
      barSearchResults.innerHTML = '<li class="search-hint">Search failed — what you typed will still be used.</li>';
    }
  }, 400);
}

function renderBarSearchResults(matches) {
  barSearchResults.innerHTML = "";

  if (matches.length === 0) {
    const hint = document.createElement("li");
    hint.className = "search-hint";
    hint.textContent = "No matches yet — what you typed will still be used.";
    barSearchResults.appendChild(hint);
    return;
  }

  matches.forEach((place) => {
    const li = document.createElement("li");
    li.className = "search-result";

    const nameEl = document.createElement("span");
    nameEl.className = "search-result-name";
    nameEl.textContent = place.name;
    li.appendChild(nameEl);

    if (place.distance !== null) {
      const distEl = document.createElement("span");
      distEl.className = "search-result-location";
      distEl.textContent = formatDistance(place.distance);
      li.appendChild(distEl);
    }

    li.addEventListener("click", () => selectBar(place.name, place.lat, place.lon));
    barSearchResults.appendChild(li);
  });
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

// Searches this app's own bar names (beer_entries.bar_name) rather
// than an external POI database, so a suggestion always matches a bar
// someone in the app has actually logged before — and picking one
// reuses its coordinates, keeping repeat visits (and Battlefield
// claims) tied to the same spot instead of near-duplicate names.
// Fuzzy-matched by substring; narrowed to NEARBY_RADIUS_METERS once a
// location is known, unfiltered (every matching name) otherwise.
async function fetchBarSuggestions(query, lat, lon) {
  const { data, error } = await supabaseClient
    .from("beer_entries")
    .select("bar_name, bar_lat, bar_lng")
    .not("bar_name", "is", null)
    .ilike("bar_name", `%${query}%`)
    .limit(200);
  if (error) throw error;

  // Dedupe by name, keeping whichever logged coordinates are closest
  // to the user (or just the first seen, with no location to compare).
  const byName = new Map();
  (data || []).forEach((row) => {
    const name = (row.bar_name || "").trim();
    if (!name) return;
    const rlat = Number(row.bar_lat);
    const rlon = Number(row.bar_lng);
    const hasCoords = Number.isFinite(rlat) && Number.isFinite(rlon);
    const distance = hasCoords && lat !== null && lon !== null ? distanceMeters(lat, lon, rlat, rlon) : null;

    const existing = byName.get(name);
    if (!existing || (distance !== null && (existing.distance === null || distance < existing.distance))) {
      byName.set(name, { name, lat: hasCoords ? rlat : null, lon: hasCoords ? rlon : null, distance });
    }
  });

  let results = Array.from(byName.values());
  if (lat !== null && lon !== null) {
    results = results.filter((r) => r.distance !== null && r.distance <= NEARBY_RADIUS_METERS);
    results.sort((a, b) => a.distance - b.distance);
  } else {
    results.sort((a, b) => a.name.localeCompare(b.name));
  }
  return results.slice(0, 8);
}

/* ---------------------------------------------------------------- *
 *  Beer: the 2 names this user has logged most often (localStorage),
 *  falling back to Guinness/Heineken, plus "Other…" to search a
 *  curated list or type any name.
 * ---------------------------------------------------------------- */

const BEER_COUNTS_STORAGE_KEY = "beerNameCounts";
const DEFAULT_BEER_NAMES = ["Guinness", "Heineken"];
const COMMON_BEER_NAMES = [
  "Guinness", "Heineken", "Budweiser", "Corona", "Stella Artois", "Peroni",
  "Carlsberg", "Amstel", "Coors Light", "Miller Lite", "Asahi", "Sapporo",
  "Tsingtao", "Modelo Especial", "Pacifico", "Sol", "Kronenbourg 1664",
  "Leffe", "Hoegaarden", "Chimay", "Duvel", "Franziskaner", "Paulaner",
  "Erdinger", "Weihenstephaner", "Brooklyn Lager", "Sierra Nevada Pale Ale",
  "Blue Moon", "Samuel Adams", "Yuengling", "Newcastle Brown Ale",
  "Fuller's London Pride", "San Miguel", "Tiger Beer", "Singha", "Chang",
  "Efes", "Steinlager", "Monteith's", "Little Creatures", "Victoria Bitter",
];

let selectedBeerName = null;
let selectedBeerIsOther = false;

function resetBeerNameState() {
  selectedBeerName = null;
  selectedBeerIsOther = false;
  beerSearchInput.value = "";
  beerSearch.hidden = true;
  beerSearchResults.innerHTML = "";
}

function getBeerCounts() {
  try {
    return JSON.parse(localStorage.getItem(BEER_COUNTS_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function recordBeerName(name) {
  if (!name) return;
  const counts = getBeerCounts();
  counts[name] = (counts[name] || 0) + 1;
  localStorage.setItem(BEER_COUNTS_STORAGE_KEY, JSON.stringify(counts));
}

// Top 2 names this user has actually logged, topped up with the
// defaults (skipping any default that's already in the top list) so
// there are always exactly 2 suggestion chips.
function getTopBeerNames() {
  const counts = getBeerCounts();
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const top = ranked.slice(0, 2);
  for (const fallback of DEFAULT_BEER_NAMES) {
    if (top.length >= 2) break;
    if (!top.includes(fallback)) top.push(fallback);
  }
  return top;
}

function renderBeerChips() {
  beerChipRow.innerHTML = "";

  getTopBeerNames().forEach((name) => {
    const chip = createChip(name, !selectedBeerIsOther && selectedBeerName === name);
    chip.addEventListener("click", () => selectBeer(name, false));
    beerChipRow.appendChild(chip);
  });

  const otherLabel = selectedBeerIsOther && selectedBeerName ? selectedBeerName : "Other…";
  const otherChip = createChip(otherLabel, selectedBeerIsOther);
  otherChip.classList.add("chip-other");
  otherChip.addEventListener("click", toggleBeerSearch);
  beerChipRow.appendChild(otherChip);
}

function selectBeer(name, isOther) {
  selectedBeerName = name;
  selectedBeerIsOther = isOther;
  beerSearch.hidden = true;
  renderBeerChips();
}

function toggleBeerSearch() {
  const opening = beerSearch.hidden;
  beerSearch.hidden = !opening;
  if (opening) {
    beerSearchInput.focus();
    renderBeerSearchResults("");
  }
}

beerSearchInput.addEventListener("input", () => renderBeerSearchResults(beerSearchInput.value));

function renderBeerSearchResults(query) {
  const q = query.trim().toLowerCase();
  beerSearchResults.innerHTML = "";

  if (q) {
    const useCustom = document.createElement("li");
    useCustom.className = "search-result search-result-custom";
    useCustom.textContent = `Use “${query.trim()}”`;
    useCustom.addEventListener("click", () => selectBeer(query.trim(), true));
    beerSearchResults.appendChild(useCustom);
  }

  const matches = COMMON_BEER_NAMES.filter((name) => !q || name.toLowerCase().includes(q)).slice(0, 8);
  matches.forEach((name) => {
    const li = document.createElement("li");
    li.className = "search-result";
    li.textContent = name;
    li.addEventListener("click", () => selectBeer(name, true));
    beerSearchResults.appendChild(li);
  });
}

/* ---------------------------------------------------------------- *
 *  Price: an Apple-style wheel picker (like the spinning dial pickers
 *  in iOS) from "skip" through $0-$20. Whatever sits centered under
 *  the indicator is the value; scrolling/flicking spins it, tapping
 *  an item snaps it to center. Items scale up and brighten as they
 *  near the center so it reads as a dial rather than a button strip.
 * ---------------------------------------------------------------- */

const PRICE_MIN = 0;
const PRICE_MAX = 20;
const PRICE_ITEM_WIDTH = 52; // px, must match .price-wheel-item flex-basis
const PRICE_SKIP_VALUE = ""; // sentinel dataset value for "no price"

let selectedPrice = null;
let priceScrollRaf = null;
let priceCommitTimer = null;

function initPriceCarousel() {
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "price-wheel-item price-wheel-item-skip";
  skipBtn.textContent = "–";
  skipBtn.dataset.value = PRICE_SKIP_VALUE;
  skipBtn.setAttribute("role", "radio");
  skipBtn.setAttribute("aria-label", "No price");
  skipBtn.setAttribute("aria-checked", "true");
  skipBtn.addEventListener("click", () => centerPriceItem(skipBtn));
  priceCarousel.appendChild(skipBtn);

  for (let value = PRICE_MIN; value <= PRICE_MAX; value++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "price-wheel-item";
    btn.textContent = `$${value}`;
    btn.dataset.value = String(value);
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.addEventListener("click", () => centerPriceItem(btn));
    priceCarousel.appendChild(btn);
  }

  priceCarousel.addEventListener("scroll", onPriceWheelScroll, { passive: true });
}

// Smoothly spins the wheel so `item` lands under the center indicator.
// The scroll handler below picks up the resulting scroll and commits
// it as the selection once the motion settles.
function centerPriceItem(item) {
  item.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function onPriceWheelScroll() {
  if (priceScrollRaf) cancelAnimationFrame(priceScrollRaf);
  priceScrollRaf = requestAnimationFrame(updatePriceWheelVisuals);

  clearTimeout(priceCommitTimer);
  priceCommitTimer = setTimeout(commitPriceWheelSelection, 120);
}

// Scales/fades each item by its distance from the center indicator so
// the wheel reads as continuous motion while the user drags/flicks.
function updatePriceWheelVisuals() {
  const trackRect = priceCarousel.getBoundingClientRect();
  const centerX = trackRect.left + trackRect.width / 2;

  Array.from(priceCarousel.children).forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const dist = Math.abs(itemCenter - centerX);
    const norm = Math.min(dist / (PRICE_ITEM_WIDTH * 2.2), 1);
    item.style.transform = `scale(${1 - norm * 0.4})`;
    item.style.opacity = String(1 - norm * 0.7);
  });
}

// Once the wheel stops moving, whichever item is nearest center becomes
// the actual selection (and gets nudged the rest of the way to a clean
// center via CSS scroll-snap already handling most of that).
function commitPriceWheelSelection() {
  const trackRect = priceCarousel.getBoundingClientRect();
  const centerX = trackRect.left + trackRect.width / 2;

  let closest = null;
  let closestDist = Infinity;
  Array.from(priceCarousel.children).forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const dist = Math.abs(itemCenter - centerX);
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  });
  if (!closest) return;

  selectedPrice = closest.dataset.value === PRICE_SKIP_VALUE ? null : Number(closest.dataset.value);
  Array.from(priceCarousel.children).forEach((item) => {
    const isSelected = item === closest;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-checked", isSelected ? "true" : "false");
  });
}

function resetPriceState() {
  selectedPrice = null;
  priceCarousel.scrollTo({ left: 0 });
  Array.from(priceCarousel.children).forEach((item, i) => {
    item.classList.toggle("is-selected", i === 0);
    item.setAttribute("aria-checked", i === 0 ? "true" : "false");
  });
  requestAnimationFrame(updatePriceWheelVisuals);
}

initPriceCarousel();
requestAnimationFrame(updatePriceWheelVisuals);

/* ---------------------------------------------------------------- *
 *  Rating stars (unchanged behaviour, still fully optional).
 * ---------------------------------------------------------------- */

function setRating(value) {
  currentRating = value;
  starButtons.forEach((btn) => {
    const filled = Number(btn.dataset.value) <= value;
    btn.classList.toggle("is-filled", filled);
    btn.setAttribute("aria-checked", filled ? "true" : "false");
  });
}

starButtons.forEach((btn) => {
  const value = Number(btn.dataset.value);
  btn.addEventListener("click", () => setRating(value));
  btn.addEventListener("mouseenter", () => {
    starButtons.forEach((b) => b.classList.toggle("is-filled", Number(b.dataset.value) <= value));
  });
});

document.querySelector(".star-rating").addEventListener("mouseleave", () => {
  setRating(currentRating);
});

/* ---------------------------------------------------------------- *
 *  Save.
 * ---------------------------------------------------------------- */

// data:URL (from FileReader.readAsDataURL) -> Blob, so the photo can
// be handed to Supabase Storage's upload().
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Uploads into a folder named after the signed-in user's own id (the
// storage policies only allow writes under that prefix) and returns
// its public URL, or null if there's no photo / the upload fails.
async function uploadBeerPhoto(dataUrl) {
  if (!dataUrl || !currentUser) return null;
  try {
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type === "image/png" ? "png" : "jpg";
    const path = `${currentUser.id}/${Date.now()}.${ext}`;
    const { error } = await supabaseClient.storage.from("beer-photos").upload(path, blob, {
      contentType: blob.type,
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabaseClient.storage.from("beer-photos").getPublicUrl(path);
    return (data && data.publicUrl) || null;
  } catch (err) {
    console.error("Beer photo upload failed:", err);
    return null;
  }
}

// Center-screen celebration shown the instant Save is tapped — not
// gated on anything reaching the server. Re-triggering while it's
// already showing (two saves in quick succession) just restarts its
// 2s clock instead of stacking timers.
let legendPopupHideTimer = null;

function showLegendPopup() {
  clearTimeout(legendPopupHideTimer);
  legendPopup.classList.remove("is-open");
  legendPopup.hidden = false;
  // Two rAFs so the browser paints the hidden->visible state first,
  // same reasoning as the sheet-open transitions elsewhere.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      legendPopup.classList.add("is-open");
    });
  });

  legendPopupHideTimer = setTimeout(() => {
    legendPopup.classList.remove("is-open");
    const onTransitionEnd = () => {
      legendPopup.hidden = true;
      legendPopup.removeEventListener("transitionend", onTransitionEnd);
    };
    legendPopup.addEventListener("transitionend", onTransitionEnd);
  }, 2000);
}

beerForm.addEventListener("submit", (e) => {
  e.preventDefault();

  // Bar name is now always required — the user types it in, which is
  // also what keeps repeat visits (and Battlefield claims) tied to a
  // single consistent name instead of drifting apart.
  if (!selectedBarName) {
    barRequiredHint.hidden = false;
    barRequiredHint.classList.add("field-hint-error");
    barRequiredHint.textContent = "Please enter a bar name to continue.";
    barSearchInput.focus();
    return;
  }

  // Snapshot everything the background save will need — the drawer
  // (and the selection state behind it) gets reset immediately below,
  // before any of this has actually reached the server.
  const entry = {
    userId: currentUser ? currentUser.id : null,
    barName: selectedBarName,
    lat: userLat !== null ? userLat : selectedBarLat,
    lng: userLng !== null ? userLng : selectedBarLng,
    beerName: selectedBeerName,
    price: selectedPrice, // null if untouched
    rating: currentRating || 0, // 0 means "no rating given"
    photoDataUrl: capturedPhotoDataUrl,
  };

  // Everything visible happens right away — the globe light, the
  // counter, the drawer closing, the celebration — none of it waits
  // on the network. The Supabase write happens after, in the
  // background; if it fails, it fails silently from the user's point
  // of view (logged to the console) rather than undoing any of this.
  recordBeerName(entry.beerName);
  if (entry.lat !== null && entry.lng !== null) {
    addBeerLight(entry.lat, entry.lng);
  }
  incrementBeerCounter();

  closeBeerSheet();
  resetBeerForm();
  showLegendPopup();

  saveBeerEntryInBackground(entry);
});

// Uploads the photo (if any) and writes the row to Supabase without
// blocking the UI — by the time this resolves, or fails, the drawer
// is long since closed and the counter/light are already updated.
async function saveBeerEntryInBackground(entry) {
  if (!entry.userId) {
    console.warn("No signed-in user — beer entry was only kept on this device.");
    return;
  }
  try {
    const photoUrl = await uploadBeerPhoto(entry.photoDataUrl);
    const { error } = await supabaseClient.from("beer_entries").insert({
      user_id: entry.userId,
      bar_name: entry.barName,
      bar_lat: entry.lat,
      bar_lng: entry.lng,
      beer_name: entry.beerName,
      price: entry.price,
      rating: entry.rating,
      photo_url: photoUrl,
    });
    if (error) throw error;
    loadProfileStats();
  } catch (err) {
    console.error("Failed to save beer entry to the server:", err);
  }
}

/* ---------------------------------------------------------------- *
 *  Profile: top-right button opens a bottom drawer with the signed-in
 *  (anonymous) user's avatar, name, and stats. Avatar/name edits save
 *  straight to Supabase (profiles is owner-writable via RLS).
 * ---------------------------------------------------------------- */

const AVATAR_OPTIONS = ["🍺", "🍻", "🍷", "🥂", "🍹", "🌍", "😎", "🎉"];

const menuBtn = document.getElementById("menu-btn");
const menuBtnIcon = document.getElementById("menu-btn-icon");
const menuPanelList = document.getElementById("menu-panel-list");
const menuItemHome = document.getElementById("menu-item-home");
const menuItemProfile = document.getElementById("menu-item-profile");
const menuItemSettings = document.getElementById("menu-item-settings");
const menuItemBattlefield = document.getElementById("menu-item-battlefield");
const menuItemStats = document.getElementById("menu-item-stats");
const menuPopoverIcons = Array.from(document.querySelectorAll(".menu-popover-icon[data-icon-kind]"));
const menuProfileAvatarEmojiEl = document.getElementById("menu-profile-avatar-emoji");
const profileSheetBackdrop = document.getElementById("profile-sheet-backdrop");
const profileSheet = document.getElementById("profile-sheet");
const profileAvatarBtn = document.getElementById("profile-avatar-btn");
const profileAvatarEmojiEl = document.getElementById("profile-avatar-emoji");
const profileAvatarPicker = document.getElementById("profile-avatar-picker");
const profileUsernameInput = document.getElementById("profile-username-input");
const profileStatCountEl = document.getElementById("profile-stat-count");
const profileStatSinceEl = document.getElementById("profile-stat-since");
const profileFavoriteEl = document.getElementById("profile-favorite");
const profileStatusEl = document.getElementById("profile-status");

function openProfileSheet() {
  closeOtherSheets(profileSheet);
  profileSheetBackdrop.hidden = false;
  profileSheet.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      profileSheetBackdrop.classList.add("is-open");
      profileSheet.classList.add("is-open");
    });
  });

  profileAvatarPicker.hidden = true;
  renderProfile();
  loadProfileStats();
  refreshProfileMapCoverage();
}

function closeProfileSheet() {
  profileSheetBackdrop.classList.remove("is-open");
  profileSheet.classList.remove("is-open");
  const onTransitionEnd = () => {
    profileSheetBackdrop.hidden = true;
    profileSheet.hidden = true;
    profileSheet.removeEventListener("transitionend", onTransitionEnd);
  };
  profileSheet.addEventListener("transitionend", onTransitionEnd);
}

/* ---------------------------------------------------------------- *
 *  Menu popover: tapping the menu button opens a small on-the-spot
 *  menu (not a full sheet) with four items — "Home" recenters the
 *  globe and closes any open drawer; "Profil"/"Paramètre" both open
 *  the existing profile/account drawer below; "Battlefield" isn't
 *  wired to anything yet. Whichever item was tapped last becomes the
 *  menu button's own icon, so the button always reflects where you
 *  currently are.
 * ---------------------------------------------------------------- */

// Material Symbols Rounded glyph name for each popover "kind" — the
// menu button mirrors whichever one is active, filled in, via the
// variable font's FILL axis (see .is-active in style.css).
const MENU_ICON_NAME_BY_KIND = {
  home: "home",
  settings: "settings",
  stats: "bar_chart",
  battlefield: "flag",
};

// Which popover item is currently "active" (i.e. was tapped last),
// mirrored onto the menu button's own icon. Starts on "home" since
// that's the state the app opens on.
let activeMenuIcon = "home";

function renderMenuButtonIcon() {
  if (!menuBtnIcon) return;
  if (activeMenuIcon === "profile") {
    // "Profil" swaps the button to the avatar emoji rather than an
    // icon glyph — "Paramètre" keeps its own gear icon.
    menuBtnIcon.innerHTML = `<span class="menu-btn-avatar" aria-hidden="true">${(currentProfile && currentProfile.avatar_emoji) || "🍺"}</span>`;
  } else {
    const iconName = MENU_ICON_NAME_BY_KIND[activeMenuIcon] || MENU_ICON_NAME_BY_KIND.home;
    menuBtnIcon.innerHTML = `<span class="material-symbols-rounded is-filled" aria-hidden="true">${iconName}</span>`;
  }
  updateMenuPopoverActiveIcons();
}

// Fills in whichever popover item's icon matches the current active
// section (outlined the rest of the time). "Profil" and "Paramètre"
// share the same drawer, so both light up together.
function updateMenuPopoverActiveIcons() {
  menuPopoverIcons.forEach((icon) => {
    const kind = icon.dataset.iconKind;
    const isActive =
      kind === activeMenuIcon ||
      (kind === "settings" && activeMenuIcon === "profile");
    icon.classList.toggle("is-active", isActive);
  });
}

function setActiveMenuIcon(kind) {
  activeMenuIcon = kind;
  renderMenuButtonIcon();
}

// Sync the popover's filled/outlined icons to the default "home"
// state on load (the button itself is already marked filled in HTML).
updateMenuPopoverActiveIcons();

// Closes whichever drawer/sheet is currently open and eases the
// globe back to its resting home view.
function goHome() {
  closeOtherSheets(null);
  map.easeTo({
    center: HOME_VIEW.center,
    zoom: HOME_VIEW.zoom,
    pitch: HOME_VIEW.pitch,
    bearing: HOME_VIEW.bearing,
    duration: 900,
  });
}

function openMenuList() {
  menuPanelList.hidden = false;
  requestAnimationFrame(() => {
    menuPanelList.classList.add("is-open");
  });
  menuBtn.setAttribute("aria-expanded", "true");
  document.addEventListener("click", onDocumentClickForMenu, true);
  document.addEventListener("keydown", onDocumentKeydownForMenu);
}

function closeMenuList() {
  menuPanelList.classList.remove("is-open");
  menuBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDocumentClickForMenu, true);
  document.removeEventListener("keydown", onDocumentKeydownForMenu);
  const onTransitionEnd = () => {
    menuPanelList.hidden = true;
    menuPanelList.removeEventListener("transitionend", onTransitionEnd);
  };
  menuPanelList.addEventListener("transitionend", onTransitionEnd);
}

function onDocumentClickForMenu(e) {
  if (menuPanelList.contains(e.target) || menuBtn.contains(e.target)) return;
  closeMenuList();
}

function onDocumentKeydownForMenu(e) {
  if (e.key === "Escape") closeMenuList();
}

menuBtn.addEventListener("click", () => {
  if (menuPanelList.classList.contains("is-open")) {
    closeMenuList();
  } else {
    openMenuList();
  }
});

menuItemHome.addEventListener("click", () => {
  closeMenuList();
  setActiveMenuIcon("home");
  goHome();
});

menuItemProfile.addEventListener("click", () => {
  closeMenuList();
  setActiveMenuIcon("profile");
  openProfileSheet();
});

menuItemSettings.addEventListener("click", () => {
  closeMenuList();
  setActiveMenuIcon("settings");
  openProfileSheet();
});

menuItemStats.addEventListener("click", () => {
  closeMenuList();
  setActiveMenuIcon("stats");
  openStatsSheet();
});

menuItemBattlefield.addEventListener("click", () => {
  closeMenuList();
  setActiveMenuIcon("battlefield");
  openBattlefieldSheet();
});
profileSheetBackdrop.addEventListener("click", closeProfileSheet);

// Fills in avatar/name/member-since from whatever's currently cached
// in currentProfile (populated by loadProfile() on sign-in).
function renderProfile() {
  if (!currentUser) {
    profileStatusEl.hidden = false;
    profileStatusEl.classList.add("field-hint-error");
    profileStatusEl.textContent = "Couldn't sign you in — profile is unavailable right now.";
    return;
  }
  if (!currentProfile) return;

  profileStatusEl.hidden = true;
  profileStatusEl.classList.remove("field-hint-error");
  profileAvatarEmojiEl.textContent = currentProfile.avatar_emoji || "🍺";
  if (menuProfileAvatarEmojiEl) menuProfileAvatarEmojiEl.textContent = currentProfile.avatar_emoji || "🍺";
  if (activeMenuIcon === "profile") renderMenuButtonIcon();
  profileUsernameInput.value = currentProfile.username || "";

  const created = currentProfile.created_at ? new Date(currentProfile.created_at) : null;
  profileStatSinceEl.textContent =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "–";
}

// Beer count + favorite beer, scoped to this user, fetched fresh each
// time the drawer opens (and again right after a new beer is saved).
async function loadProfileStats() {
  if (!currentUser) return;
  try {
    const { data, error, count } = await supabaseClient
      .from("beer_entries")
      .select("beer_name", { count: "exact" })
      .eq("user_id", currentUser.id);
    if (error) throw error;

    profileStatCountEl.textContent = typeof count === "number" ? count.toLocaleString("en-US") : "0";

    const tally = {};
    (data || []).forEach((row) => {
      if (!row.beer_name) return;
      tally[row.beer_name] = (tally[row.beer_name] || 0) + 1;
    });
    const favorite = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    profileFavoriteEl.hidden = !favorite;
    if (favorite) profileFavoriteEl.textContent = `Favorite beer: ${favorite}`;
  } catch (err) {
    console.error("Failed to load profile stats:", err);
    profileStatCountEl.textContent = "–";
  }
}

async function saveProfileField(patch) {
  if (!currentUser) return;
  profileStatusEl.hidden = false;
  profileStatusEl.classList.remove("field-hint-error");
  profileStatusEl.textContent = "Saving…";
  try {
    const { error } = await supabaseClient.from("profiles").update(patch).eq("id", currentUser.id);
    if (error) throw error;
    currentProfile = Object.assign({}, currentProfile, patch);
    profileStatusEl.textContent = "Saved";
    setTimeout(() => {
      profileStatusEl.hidden = true;
    }, 1200);
  } catch (err) {
    console.error("Failed to save profile:", err);
    profileStatusEl.classList.add("field-hint-error");
    profileStatusEl.textContent = "Couldn't save — try again.";
  }
}

function renderAvatarPicker() {
  profileAvatarPicker.innerHTML = "";
  AVATAR_OPTIONS.forEach((emoji) => {
    const isSelected = Boolean(currentProfile && currentProfile.avatar_emoji === emoji);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip profile-avatar-option" + (isSelected ? " is-selected" : "");
    chip.textContent = emoji;
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", isSelected ? "true" : "false");
    chip.addEventListener("click", () => selectAvatar(emoji));
    profileAvatarPicker.appendChild(chip);
  });
}

async function selectAvatar(emoji) {
  profileAvatarEmojiEl.textContent = emoji;
  if (menuProfileAvatarEmojiEl) menuProfileAvatarEmojiEl.textContent = emoji;
  if (activeMenuIcon === "profile") renderMenuButtonIcon();
  profileAvatarPicker.hidden = true;
  await saveProfileField({ avatar_emoji: emoji });
}

profileAvatarBtn.addEventListener("click", () => {
  const opening = profileAvatarPicker.hidden;
  if (opening) renderAvatarPicker();
  profileAvatarPicker.hidden = !opening;
});

async function saveUsername() {
  const value = profileUsernameInput.value.trim();
  if (!currentProfile || value === (currentProfile.username || "")) return;
  await saveProfileField({ username: value || "Beer Explorer" });
}

profileUsernameInput.addEventListener("blur", saveUsername);
profileUsernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    profileUsernameInput.blur();
  }
});

/* ---------------------------------------------------------------- *
 *  Profile mini map: a small, always-dark world map showing every
 *  country the signed-in user has logged a beer in (gold fill).
 *  Countries are resolved from each entry's bar_lat/bar_lng via the
 *  same reverse-geocode cache the stats leaderboard uses, so repeat
 *  opens are cheap. Tapping the map shows a little toast with the
 *  percentage of the world's countries covered so far. The map
 *  itself is a lightweight custom style (no basemap tiles) rather
 *  than the heavier globe style, and isn't draggable/zoomable — it's
 *  a preview, not a second globe.
 * ---------------------------------------------------------------- */

const profileMapEl = document.getElementById("profile-map");
const profileMapToast = document.getElementById("profile-map-toast");
const profileMapToastTextEl = document.getElementById("profile-map-toast-text");

// Simplified (110m) Natural Earth country polygons — small enough for
// a mini map, and each feature carries an ISO_A2 code to match
// against Nominatim's reverse-geocode results.
const WORLD_COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";
const PROFILE_MAP_GOLD = "#ffdb7a";
const PROFILE_MAP_DEFAULT_FILL = "#232838";
const PROFILE_MAP_LINE_COLOR = "rgba(255, 255, 255, 0.12)";

// A handful of countries ship with ISO_A2 left unset ("-99") in the
// Natural Earth 110m dataset — patched here by admin name so they can
// still be matched and colored in.
const COUNTRY_ISO2_NAME_OVERRIDES = {
  France: "FR",
  Norway: "NO",
  Kosovo: "XK",
  Somaliland: "SO",
};

// How many of this user's distinct ~1.1km location buckets we're
// willing to reverse-geocode when building the map — generous enough
// to cover a well-traveled profile without hammering Nominatim (busiest
// buckets first, same priority order as the leaderboard).
const PROFILE_MAP_GEOCODE_BUCKET_LIMIT = 60;

let profileMap = null;
let profileMapGeojson = null;
let profileMapReady = false;
let profileMapTotalCountryCount = 0;
let profileMapVisitedIso2 = new Set();
let profileMapToastHideTimer = null;

function getFeatureIso2(feature) {
  const props = (feature && feature.properties) || {};
  let code = props.ISO_A2;
  if (!code || code === "-99") {
    code = COUNTRY_ISO2_NAME_OVERRIDES[props.ADMIN] || null;
  }
  return code ? String(code).toUpperCase() : null;
}

function buildProfileMapFillExpression() {
  if (!profileMapVisitedIso2.size) return PROFILE_MAP_DEFAULT_FILL;
  const expr = ["match", ["get", "ISO_A2"]];
  profileMapVisitedIso2.forEach((code) => {
    expr.push(code, PROFILE_MAP_GOLD);
  });
  expr.push(PROFILE_MAP_DEFAULT_FILL);
  return expr;
}

function applyProfileMapVisited() {
  if (!profileMap || !profileMapReady) return;
  profileMap.setPaintProperty("countries-fill", "fill-color", buildProfileMapFillExpression());
}

// Builds the map the first time the profile drawer opens; a no-op on
// every later open.
function initProfileMap() {
  if (profileMap || !profileMapEl || typeof maplibregl === "undefined") return;

  profileMap = new maplibregl.Map({
    container: profileMapEl,
    attributionControl: false,
    interactive: false,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0e16" } }],
    },
    center: [12, 15],
    zoom: 0,
  });

  profileMap.on("load", async () => {
    try {
      if (!profileMapGeojson) {
        const res = await fetch(WORLD_COUNTRIES_GEOJSON_URL);
        if (!res.ok) throw new Error(`Failed to load world map (${res.status})`);
        profileMapGeojson = await res.json();
      }

      const allCodes = new Set();
      profileMapGeojson.features.forEach((feature) => {
        const code = getFeatureIso2(feature);
        // Antarctica isn't a country you can log a beer "in" the same
        // way, so it's excluded from both the map's fill data and the
        // coverage percentage's denominator.
        if (code && code !== "AQ") allCodes.add(code);
      });
      profileMapTotalCountryCount = allCodes.size;

      profileMap.addSource("countries", { type: "geojson", data: profileMapGeojson });
      profileMap.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: { "fill-color": PROFILE_MAP_DEFAULT_FILL },
      });
      profileMap.addLayer({
        id: "countries-line",
        type: "line",
        source: "countries",
        paint: { "line-color": PROFILE_MAP_LINE_COLOR, "line-width": 0.5 },
      });

      // Crops out the far southern/northern extremes (mostly empty
      // ocean and Antarctica) so the inhabited world fills the mini
      // map's short, wide frame instead of a fixed guessed zoom.
      profileMap.fitBounds(
        [
          [-169, -58],
          [191, 83],
        ],
        { padding: 0, animate: false }
      );

      profileMapReady = true;
      applyProfileMapVisited();
    } catch (err) {
      console.error("Failed to set up profile map:", err);
    }
  });

  profileMapEl.addEventListener("click", onProfileMapTap);
  profileMapEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onProfileMapTap();
    }
  });
}

// One decimal place, but without a trailing ".0" for whole numbers.
function formatCoveragePercent(pct) {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function showProfileMapToast(message) {
  if (!profileMapToast || !profileMapToastTextEl) return;
  clearTimeout(profileMapToastHideTimer);
  profileMapToastTextEl.textContent = message;
  profileMapToast.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      profileMapToast.classList.add("is-open");
    });
  });

  profileMapToastHideTimer = setTimeout(() => {
    profileMapToast.classList.remove("is-open");
    const onTransitionEnd = () => {
      profileMapToast.hidden = true;
      profileMapToast.removeEventListener("transitionend", onTransitionEnd);
    };
    profileMapToast.addEventListener("transitionend", onTransitionEnd);
  }, 2200);
}

function onProfileMapTap() {
  if (!profileMapReady || !profileMapTotalCountryCount) {
    showProfileMapToast("Still mapping the world…");
    return;
  }
  const pct = (profileMapVisitedIso2.size / profileMapTotalCountryCount) * 100;
  showProfileMapToast(`${formatCoveragePercent(pct)}% of the world uncovered`);
}

// Reverse-geocodes this user's distinct beer-logging locations into
// ISO_A2 country codes, reusing the leaderboard's geocode cache so
// buckets already resolved elsewhere in the app cost nothing here.
async function loadProfileMapVisitedCountries() {
  if (!currentUser) return new Set();

  const { data, error } = await supabaseClient
    .from("beer_entries")
    .select("bar_lat, bar_lng")
    .eq("user_id", currentUser.id)
    .not("bar_lat", "is", null)
    .not("bar_lng", "is", null);
  if (error) throw error;

  const bucketCounts = {};
  const bucketCoords = {};
  (data || []).forEach((row) => {
    const lat = Number(row.bar_lat);
    const lng = Number(row.bar_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = roundCoordKey(lat, lng);
    bucketCounts[key] = (bucketCounts[key] || 0) + 1;
    if (!bucketCoords[key]) bucketCoords[key] = { lat, lng };
  });

  const busiestBuckets = topTallyEntries(bucketCounts, PROFILE_MAP_GEOCODE_BUCKET_LIMIT);
  if (!busiestBuckets.length) return new Set();

  const cache = loadGeocodeCache();
  let cacheDirty = false;
  const codes = new Set();

  for (const [key] of busiestBuckets) {
    let resolved = cache[key];
    // Cache entries written before country_code was tracked are
    // treated as misses so they pick it up on next resolve.
    if (!resolved || resolved.country_code === undefined) {
      const { lat, lng } = bucketCoords[key];
      try {
        resolved = await reverseGeocodePlace(lat, lng);
      } catch (err) {
        console.warn("Reverse geocode failed for", key, err);
        resolved = { city: null, country: null, country_code: null };
      }
      cache[key] = resolved;
      cacheDirty = true;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (resolved.country_code) codes.add(resolved.country_code.toUpperCase());
  }

  if (cacheDirty) saveGeocodeCache(cache);
  return codes;
}

// Called every time the profile drawer opens: builds the map on first
// call, then (re)resolves and paints the user's visited countries.
async function refreshProfileMapCoverage() {
  if (!currentUser || !profileMapEl) return;
  initProfileMap();
  if (profileMap) requestAnimationFrame(() => profileMap.resize());

  try {
    profileMapVisitedIso2 = await loadProfileMapVisitedCountries();
  } catch (err) {
    console.error("Failed to load visited countries:", err);
    profileMapVisitedIso2 = new Set();
  }
  applyProfileMapVisited();
}

/* ---------------------------------------------------------------- *
 *  Stats drawer: tapping the giant counter opens a second sheet with
 *  worldwide numbers (as opposed to the profile drawer's per-user
 *  stats) — total logged, activity in the last 24h, average rating,
 *  average price, and the current top beer/spot.
 * ---------------------------------------------------------------- */

const statsSheetBackdrop = document.getElementById("stats-sheet-backdrop");
const statsSheet = document.getElementById("stats-sheet");
const statsTotalEl = document.getElementById("stats-total-value");
const statsTodayEl = document.getElementById("stats-today-value");
const statsRatingEl = document.getElementById("stats-rating-value");
const statsPriceEl = document.getElementById("stats-price-value");
const statsStatusEl = document.getElementById("stats-status");

const leaderboardRangeButtons = Array.from(document.querySelectorAll(".leaderboard-range-tab"));
const leaderboardRangeThumb = document.getElementById("leaderboard-range-thumb");
const leaderboardPanels = Array.from(document.querySelectorAll(".leaderboard-panel")).map((panel) => ({
  scope: panel.dataset.scope,
  listEl: panel.querySelector(".leaderboard-list"),
  emptyEl: panel.querySelector(".leaderboard-empty"),
  statusEl: panel.querySelector(".leaderboard-status"),
}));

function openStatsSheet() {
  closeOtherSheets(statsSheet);
  statsSheetBackdrop.hidden = false;
  statsSheet.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      statsSheetBackdrop.classList.add("is-open");
      statsSheet.classList.add("is-open");
    });
  });

  loadWorldStats();
  loadLeaderboard();
}

function closeStatsSheet() {
  statsSheetBackdrop.classList.remove("is-open");
  statsSheet.classList.remove("is-open");
  const onTransitionEnd = () => {
    statsSheetBackdrop.hidden = true;
    statsSheet.hidden = true;
    statsSheet.removeEventListener("transitionend", onTransitionEnd);
  };
  statsSheet.addEventListener("transitionend", onTransitionEnd);
}

beerCounterEl.addEventListener("click", openStatsSheet);
statsSheetBackdrop.addEventListener("click", closeStatsSheet);

// Fetches every entry's lightweight fields and tallies them client-side
// — simplest approach while the table stays small; swap for a Postgres
// view/RPC (avg, count, group by) if the table grows large.
async function loadWorldStats() {
  statsTotalEl.textContent = "–";
  statsTodayEl.textContent = "–";
  statsRatingEl.textContent = "–";
  statsPriceEl.textContent = "–";
  statsStatusEl.hidden = true;

  try {
    const { data, error } = await supabaseClient
      .from("beer_entries")
      .select("price, rating, created_at");
    if (error) throw error;

    const rows = data || [];
    const total = rows.length;

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const loggedToday = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() >= dayAgo).length;

    const rated = rows.filter((r) => typeof r.rating === "number" && r.rating > 0);
    const avgRating = rated.length ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length : null;

    const priced = rows.filter((r) => r.price !== null && r.price !== undefined);
    const avgPrice = priced.length ? priced.reduce((sum, r) => sum + Number(r.price), 0) / priced.length : null;

    statsTotalEl.textContent = total.toLocaleString("en-US");
    statsTodayEl.textContent = loggedToday.toLocaleString("en-US");
    statsRatingEl.textContent = avgRating !== null ? `${avgRating.toFixed(1)} ★` : "–";
    statsPriceEl.textContent = avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "–";
  } catch (err) {
    console.error("Failed to load worldwide stats:", err);
    statsStatusEl.hidden = false;
    statsStatusEl.classList.add("field-hint-error");
    statsStatusEl.textContent = "Couldn't load stats — try again.";
  }
}

/* ---------------------------------------------------------------- *
 *  Leaderboard (inside the stats drawer): rank Users / Venues /
 *  Cities / Countries, each over 24h / the last week / all time.
 *  Users and Venues come straight off beer_entries. Cities and
 *  Countries don't have their own column — bar_lat/bar_lng get
 *  bucketed and reverse-geocoded (via the same Nominatim endpoint
 *  the "nearby bars" search already uses), with results cached in
 *  localStorage since a given spot's city/country never changes.
 * ---------------------------------------------------------------- */

let leaderboardRange = "all";
let leaderboardRequestId = 0; // guards against a slow, stale request clobbering a newer one

const LEADERBOARD_TOP_N = 3;

const LEADERBOARD_SCOPE_EMOJI = {
  beer: "🍺",
  venues: "📍",
  cities: "🏙️",
  countries: "🌍",
};

function slideLeaderboardRangeThumb(btn) {
  if (!leaderboardRangeThumb) return;
  const index = leaderboardRangeButtons.indexOf(btn);
  if (index === -1) return;
  leaderboardRangeThumb.style.transform = `translateX(${index * 100}%)`;
}

leaderboardRangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.range === leaderboardRange) return;
    leaderboardRange = btn.dataset.range;
    leaderboardRangeButtons.forEach((b) => {
      const selected = b === btn;
      b.classList.toggle("is-selected", selected);
      b.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    slideLeaderboardRangeThumb(btn);
    loadLeaderboard();
  });
});

// Position the thumb under whichever button starts selected (All time).
slideLeaderboardRangeThumb(
  leaderboardRangeButtons.find((b) => b.classList.contains("is-selected")) || leaderboardRangeButtons[leaderboardRangeButtons.length - 1]
);

function leaderboardRangeCutoffIso(range) {
  if (range === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (range === "week") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null; // "all"
}

// Loads all four category panels in parallel for the current range —
// there's no more "active tab" to switch, so every panel stays live
// and the person just scrolls sideways between them.
function loadLeaderboard() {
  const requestId = ++leaderboardRequestId;
  leaderboardPanels.forEach((panel) => loadLeaderboardPanel(panel, requestId));
}

async function loadLeaderboardPanel(panel, requestId) {
  const { scope, listEl, emptyEl, statusEl } = panel;
  listEl.innerHTML = "";
  emptyEl.hidden = true;
  statusEl.classList.remove("field-hint-error");
  statusEl.hidden = false;
  statusEl.textContent = "Loading…";

  try {
    const cutoffIso = leaderboardRangeCutoffIso(leaderboardRange);
    let items;
    if (scope === "users") items = await computeUsersLeaderboard(cutoffIso);
    else if (scope === "beer") items = await computeBeerLeaderboard(cutoffIso);
    else if (scope === "venues") items = await computeVenuesLeaderboard(cutoffIso);
    else items = await computePlacesLeaderboard(scope, cutoffIso);

    if (requestId !== leaderboardRequestId) return; // a newer range tap superseded this

    statusEl.hidden = true;
    if (!items.length) {
      emptyEl.hidden = false;
      return;
    }
    renderLeaderboard(listEl, items, scope);
  } catch (err) {
    if (requestId !== leaderboardRequestId) return;
    console.error(`Failed to load ${scope} leaderboard:`, err);
    statusEl.hidden = false;
    statusEl.classList.add("field-hint-error");
    statusEl.textContent = "Couldn't load leaderboard — try again.";
  }
}

function renderLeaderboard(listEl, items, scope) {
  const emoji = LEADERBOARD_SCOPE_EMOJI[scope] || null;
  listEl.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "leaderboard-row";
    if (item.isYou) li.classList.add("is-you");

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(i + 1);
    li.appendChild(rank);

    const glyph = item.emoji || emoji;
    if (glyph) {
      const emojiEl = document.createElement("span");
      emojiEl.className = "leaderboard-emoji";
      emojiEl.textContent = glyph;
      emojiEl.setAttribute("aria-hidden", "true");
      li.appendChild(emojiEl);
    }

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = item.name;
    li.appendChild(name);

    const count = document.createElement("span");
    count.className = "leaderboard-count";
    count.textContent = `${item.count.toLocaleString("en-US")} 🍺`;
    li.appendChild(count);

    listEl.appendChild(li);
  });
}

// Sorts a { key: count } tally into a descending [key, count][] list.
function topTallyEntries(tally, limit) {
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

async function computeUsersLeaderboard(cutoffIso) {
  let query = supabaseClient.from("beer_entries").select("user_id, created_at").not("user_id", "is", null);
  if (cutoffIso) query = query.gte("created_at", cutoffIso);
  const { data, error } = await query;
  if (error) throw error;

  const tally = {};
  (data || []).forEach((row) => {
    tally[row.user_id] = (tally[row.user_id] || 0) + 1;
  });
  const top = topTallyEntries(tally, LEADERBOARD_TOP_N);
  if (!top.length) return [];

  const ids = top.map(([id]) => id);
  const { data: profiles, error: profilesError } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_emoji")
    .in("id", ids);
  if (profilesError) throw profilesError;

  const profileById = {};
  (profiles || []).forEach((p) => {
    profileById[p.id] = p;
  });

  return top.map(([id, count]) => {
    const profile = profileById[id];
    return {
      name: (profile && profile.username) || "Beer Explorer",
      emoji: (profile && profile.avatar_emoji) || "🍺",
      count,
      isYou: Boolean(currentUser && currentUser.id === id),
    };
  });
}

async function computeVenuesLeaderboard(cutoffIso) {
  let query = supabaseClient.from("beer_entries").select("bar_name, created_at").not("bar_name", "is", null);
  if (cutoffIso) query = query.gte("created_at", cutoffIso);
  const { data, error } = await query;
  if (error) throw error;

  const tally = {};
  (data || []).forEach((row) => {
    const name = (row.bar_name || "").trim();
    if (!name) return;
    tally[name] = (tally[name] || 0) + 1;
  });
  return topTallyEntries(tally, LEADERBOARD_TOP_N).map(([name, count]) => ({ name, count }));
}

async function computeBeerLeaderboard(cutoffIso) {
  let query = supabaseClient.from("beer_entries").select("beer_name, created_at").not("beer_name", "is", null);
  if (cutoffIso) query = query.gte("created_at", cutoffIso);
  const { data, error } = await query;
  if (error) throw error;

  const tally = {};
  (data || []).forEach((row) => {
    const name = (row.beer_name || "").trim();
    if (!name) return;
    tally[name] = (tally[name] || 0) + 1;
  });
  return topTallyEntries(tally, LEADERBOARD_TOP_N).map(([name, count]) => ({ name, count }));
}

// How many distinct locations we're willing to reverse-geocode on a
// single leaderboard load. Kept small since Nominatim's free tier
// expects roughly one request per second — the busiest few buckets
// (by entry count) get resolved; the long tail is dropped rather
// than hammering the API for city names two or three entries deep.
const LEADERBOARD_GEOCODE_BUCKET_LIMIT = 20;
const GEOCODE_CACHE_STORAGE_KEY = "beerapp_geocode_cache_v1";

function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache) {
  try {
    localStorage.setItem(GEOCODE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn("Failed to persist geocode cache:", err);
  }
}

// ~1.1km buckets — plenty tight for grouping entries at the same
// venue/block while keeping the number of distinct lookups small.
function roundCoordKey(lat, lng) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

// How long to wait on a single Nominatim request before giving up —
// without a client-side timeout, a stalled connection could hang a
// leaderboard/battlefield/profile-map load indefinitely.
const GEOCODE_FETCH_TIMEOUT_MS = 6000;

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function reverseGeocodePlace(lat, lng) {
  const res = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1&accept-language=en`,
    { headers: { Accept: "application/json" } },
    GEOCODE_FETCH_TIMEOUT_MS
  );
  if (!res.ok) return { city: null, country: null, country_code: null };
  const data = await res.json();
  const addr = (data && data.address) || {};
  return {
    city: addr.city || addr.town || addr.village || addr.municipality || null,
    country: addr.country || null,
    // ISO 3166-1 alpha-2, always lowercase and locale-independent —
    // used to match countries on the profile mini map instead of the
    // display name above, which the app doesn't otherwise need.
    country_code: addr.country_code || null,
  };
}

async function computePlacesLeaderboard(scope, cutoffIso) {
  let query = supabaseClient
    .from("beer_entries")
    .select("bar_lat, bar_lng, created_at")
    .not("bar_lat", "is", null)
    .not("bar_lng", "is", null);
  if (cutoffIso) query = query.gte("created_at", cutoffIso);
  const { data, error } = await query;
  if (error) throw error;

  const bucketCounts = {}; // roundedKey -> count
  const bucketCoords = {}; // roundedKey -> { lat, lng }
  (data || []).forEach((row) => {
    const lat = Number(row.bar_lat);
    const lng = Number(row.bar_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = roundCoordKey(lat, lng);
    bucketCounts[key] = (bucketCounts[key] || 0) + 1;
    if (!bucketCoords[key]) bucketCoords[key] = { lat, lng };
  });

  const busiestBuckets = topTallyEntries(bucketCounts, LEADERBOARD_GEOCODE_BUCKET_LIMIT);
  if (!busiestBuckets.length) return [];

  const cache = loadGeocodeCache();
  let cacheDirty = false;
  const tally = {};

  for (const [key, count] of busiestBuckets) {
    let resolved = cache[key];
    if (!resolved) {
      const { lat, lng } = bucketCoords[key];
      try {
        resolved = await reverseGeocodePlace(lat, lng);
      } catch (err) {
        console.warn("Reverse geocode failed for", key, err);
        resolved = { city: null, country: null };
      }
      cache[key] = resolved;
      cacheDirty = true;
      // Stay well under Nominatim's ~1 req/sec usage policy between
      // cache misses; cached buckets (the common case after the
      // first load) skip this delay entirely.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    const name = scope === "countries" ? resolved.country : resolved.city;
    if (!name) continue;
    tally[name] = (tally[name] || 0) + count;
  }

  if (cacheDirty) saveGeocodeCache(cache);

  return topTallyEntries(tally, LEADERBOARD_TOP_N).map(([name, count]) => ({ name, count }));
}

/* ---------------------------------------------------------------- *
 *  Battlefield drawer — opened from the menu's "Battlefield" item.
 *  A country or bar is "claimed" by whoever has logged the most
 *  beers there. "Me" lists claims the signed-in user currently
 *  holds; "Other" lists claims held by anyone else, with who holds
 *  each one. Bars come straight off beer_entries' bar_name; countries
 *  reuse the same bucket + reverse-geocode + cache approach as the
 *  stats leaderboard above. The two category cards act as a tiny
 *  two-slide carousel — tapping either swaps the list beneath them.
 * ---------------------------------------------------------------- */

const battlefieldSheetBackdrop = document.getElementById("battlefield-sheet-backdrop");
const battlefieldSheet = document.getElementById("battlefield-sheet");
const battlefieldCards = Array.from(document.querySelectorAll(".battlefield-card"));
const battlefieldCountMeEl = document.getElementById("battlefield-count-me");
const battlefieldCountOtherEl = document.getElementById("battlefield-count-other");
const battlefieldDetailsLabelEl = document.getElementById("battlefield-details-label");
const battlefieldListEl = document.getElementById("battlefield-list");
const battlefieldEmptyEl = document.getElementById("battlefield-empty");
const battlefieldStatusEl = document.getElementById("battlefield-status");

// Kept modest for the same reason as LEADERBOARD_GEOCODE_BUCKET_LIMIT
// above — Nominatim's free tier expects roughly one request/sec, and
// results are cached, so repeat opens cost nothing.
const BATTLEFIELD_GEOCODE_BUCKET_LIMIT = 30;

let battlefieldSide = "me";
let battlefieldClaims = null; // { me: [...], other: [...] }, filled in by loadBattlefield
let battlefieldRequestId = 0; // guards against a slow, stale load clobbering a newer one

function openBattlefieldSheet() {
  closeOtherSheets(battlefieldSheet);
  battlefieldSheetBackdrop.hidden = false;
  battlefieldSheet.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      battlefieldSheetBackdrop.classList.add("is-open");
      battlefieldSheet.classList.add("is-open");
    });
  });

  loadBattlefield();
}

function closeBattlefieldSheet() {
  battlefieldSheetBackdrop.classList.remove("is-open");
  battlefieldSheet.classList.remove("is-open");
  const onTransitionEnd = () => {
    battlefieldSheetBackdrop.hidden = true;
    battlefieldSheet.hidden = true;
    battlefieldSheet.removeEventListener("transitionend", onTransitionEnd);
  };
  battlefieldSheet.addEventListener("transitionend", onTransitionEnd);
}

battlefieldSheetBackdrop.addEventListener("click", closeBattlefieldSheet);

battlefieldCards.forEach((card) => {
  card.addEventListener("click", () => {
    const side = card.dataset.side;
    if (side === battlefieldSide) return;
    setBattlefieldSide(side);
  });
});

function setBattlefieldSide(side) {
  battlefieldSide = side;
  battlefieldCards.forEach((card) => {
    const selected = card.dataset.side === side;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  });
  battlefieldDetailsLabelEl.textContent = side === "me" ? "Your territory" : "Held by others";
  renderBattlefieldList();
}

function renderBattlefieldList() {
  battlefieldListEl.innerHTML = "";
  if (!battlefieldClaims) return;

  const items = battlefieldClaims[battlefieldSide] || [];
  battlefieldEmptyEl.hidden = items.length > 0;
  battlefieldEmptyEl.textContent =
    battlefieldSide === "me"
      ? "Nothing claimed yet — log a beer somewhere to start claiming it."
      : "No rivals hold any territory yet.";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "battlefield-row";

    const icon = document.createElement("span");
    icon.className = "battlefield-row-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.type === "country" ? "🌍" : "📍";
    li.appendChild(icon);

    const main = document.createElement("div");
    main.className = "battlefield-row-main";

    const name = document.createElement("span");
    name.className = "battlefield-row-name";
    name.textContent = item.name;
    main.appendChild(name);

    const sub = document.createElement("span");
    sub.className = "battlefield-row-sub";
    sub.textContent =
      battlefieldSide === "other"
        ? `${item.claimantEmoji} Held by ${item.claimantName}`
        : item.type === "country"
        ? "Country"
        : "Bar";
    main.appendChild(sub);

    li.appendChild(main);

    const count = document.createElement("span");
    count.className = "battlefield-row-count";
    count.textContent = `${item.count.toLocaleString("en-US")} 🍺`;
    li.appendChild(count);

    battlefieldListEl.appendChild(li);
  });
}

// Tallies bar-name claims (no geocoding needed) into a flat list, one
// entry per bar, each carrying whichever user logged the most beers
// there and that winning count.
function tallyBarClaims(rows) {
  const byBar = {}; // bar name -> { userId -> count }
  rows.forEach((row) => {
    const name = (row.bar_name || "").trim();
    if (!name || !row.user_id) return;
    if (!byBar[name]) byBar[name] = {};
    byBar[name][row.user_id] = (byBar[name][row.user_id] || 0) + 1;
  });

  return Object.entries(byBar).map(([name, byUser]) => {
    const [claimantId, count] = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0];
    return { type: "bar", name, claimantId, count };
  });
}

// Buckets entries by rounded coords, reverse-geocodes the busiest
// buckets (reusing the leaderboard's cache/rate-limit approach above),
// then rolls each bucket's per-user tally up into its country so a
// country claim reflects every entry that resolved there, not just
// the busiest single spot.
async function tallyCountryClaims(rows) {
  const bucketCoords = {};
  const bucketByUser = {}; // roundedKey -> { userId -> count }
  const bucketTotals = {}; // roundedKey -> count, used to pick the busiest buckets to geocode

  rows.forEach((row) => {
    const lat = Number(row.bar_lat);
    const lng = Number(row.bar_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !row.user_id) return;
    const key = roundCoordKey(lat, lng);
    if (!bucketCoords[key]) bucketCoords[key] = { lat, lng };
    if (!bucketByUser[key]) bucketByUser[key] = {};
    bucketByUser[key][row.user_id] = (bucketByUser[key][row.user_id] || 0) + 1;
    bucketTotals[key] = (bucketTotals[key] || 0) + 1;
  });

  const busiestBuckets = topTallyEntries(bucketTotals, BATTLEFIELD_GEOCODE_BUCKET_LIMIT);
  if (!busiestBuckets.length) return [];

  const cache = loadGeocodeCache();
  let cacheDirty = false;
  const byCountry = {}; // country name -> { userId -> count }

  for (const [key] of busiestBuckets) {
    let resolved = cache[key];
    if (!resolved) {
      const { lat, lng } = bucketCoords[key];
      try {
        resolved = await reverseGeocodePlace(lat, lng);
      } catch (err) {
        console.warn("Reverse geocode failed for", key, err);
        resolved = { city: null, country: null, country_code: null };
      }
      cache[key] = resolved;
      cacheDirty = true;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    const country = resolved.country;
    if (!country) continue;
    if (!byCountry[country]) byCountry[country] = {};
    Object.entries(bucketByUser[key]).forEach(([userId, count]) => {
      byCountry[country][userId] = (byCountry[country][userId] || 0) + count;
    });
  }

  if (cacheDirty) saveGeocodeCache(cache);

  return Object.entries(byCountry).map(([name, byUser]) => {
    const [claimantId, count] = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0];
    return { type: "country", name, claimantId, count };
  });
}

async function loadBattlefield() {
  const requestId = ++battlefieldRequestId;
  battlefieldCountMeEl.textContent = "–";
  battlefieldCountOtherEl.textContent = "–";
  battlefieldListEl.innerHTML = "";
  battlefieldEmptyEl.hidden = true;
  battlefieldStatusEl.hidden = false;
  battlefieldStatusEl.classList.remove("field-hint-error");
  battlefieldStatusEl.textContent = "Loading…";

  try {
    const { data, error } = await supabaseClient.from("beer_entries").select("user_id, bar_name, bar_lat, bar_lng");
    if (error) throw error;
    const rows = data || [];

    const barClaims = tallyBarClaims(rows);
    const countryClaims = await tallyCountryClaims(rows);
    if (requestId !== battlefieldRequestId) return; // superseded by a later open

    const allClaims = [...countryClaims, ...barClaims].sort((a, b) => b.count - a.count);

    const claimantIds = Array.from(new Set(allClaims.map((c) => c.claimantId)));
    const profileById = {};
    if (claimantIds.length) {
      const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("id, username, avatar_emoji")
        .in("id", claimantIds);
      if (profilesError) throw profilesError;
      (profiles || []).forEach((p) => {
        profileById[p.id] = p;
      });
    }

    const me = [];
    const other = [];
    allClaims.forEach((claim) => {
      const isMe = Boolean(currentUser && claim.claimantId === currentUser.id);
      const profile = profileById[claim.claimantId];
      const entry = {
        type: claim.type,
        name: claim.name,
        count: claim.count,
        claimantName: (profile && profile.username) || "Beer Explorer",
        claimantEmoji: (profile && profile.avatar_emoji) || "🍺",
      };
      (isMe ? me : other).push(entry);
    });

    battlefieldClaims = { me, other };
    battlefieldCountMeEl.textContent = me.length.toLocaleString("en-US");
    battlefieldCountOtherEl.textContent = other.length.toLocaleString("en-US");
    battlefieldStatusEl.hidden = true;
    renderBattlefieldList();
  } catch (err) {
    if (requestId !== battlefieldRequestId) return;
    console.error("Failed to load battlefield:", err);
    battlefieldStatusEl.hidden = false;
    battlefieldStatusEl.classList.add("field-hint-error");
    battlefieldStatusEl.textContent = "Couldn't load the battlefield — try again.";
  }
}

/* ---------------------------------------------------------------- *
 *  Drag-to-dismiss: makes a bottom sheet follow the finger (or mouse)
 *  down from its handle, and either snaps back open or dismisses the
 *  sheet on release depending on how far/fast it was dragged. Pointer
 *  Events cover touch, mouse, and pen with one code path.
 * ---------------------------------------------------------------- */

const SHEET_DISMISS_DISTANCE_PX = 120; // dragged down at least this far -> dismiss
const SHEET_DISMISS_VELOCITY_PX_MS = 0.5; // or a fast-enough flick, even if short

function makeSheetDraggable(sheet, backdrop, handle, closeFn) {
  let dragging = false;
  let startY = 0;
  let currentY = 0;
  let startTime = 0;

  function onPointerDown(e) {
    // Only the primary mouse button / a single touch/pen contact.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    startY = e.clientY;
    currentY = 0;
    startTime = performance.now();
    sheet.classList.add("is-dragging");
    backdrop.classList.add("is-dragging");
    handle.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    // Only ever drag downward — the sheet has nowhere to go upward.
    currentY = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${currentY}px)`;
    backdrop.style.opacity = String(1 - clamp01(currentY / (sheet.offsetHeight || 1)));
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("is-dragging");
    backdrop.classList.remove("is-dragging");

    const elapsedMs = Math.max(1, performance.now() - startTime);
    const velocity = currentY / elapsedMs;
    const shouldDismiss = currentY > SHEET_DISMISS_DISTANCE_PX || velocity > SHEET_DISMISS_VELOCITY_PX_MS;

    // Clear the inline drag styles either way — the is-open class (via
    // closeFn, or because we're snapping back) drives the final
    // position/opacity through the sheet's normal CSS transition.
    sheet.style.transform = "";
    backdrop.style.opacity = "";

    if (shouldDismiss) closeFn();
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
}

makeSheetDraggable(beerSheet, sheetBackdrop, beerSheet.querySelector(".sheet-handle"), closeBeerSheet);
makeSheetDraggable(profileSheet, profileSheetBackdrop, profileSheet.querySelector(".sheet-handle"), closeProfileSheet);
makeSheetDraggable(statsSheet, statsSheetBackdrop, statsSheet.querySelector(".sheet-handle"), closeStatsSheet);
makeSheetDraggable(battlefieldSheet, battlefieldSheetBackdrop, battlefieldSheet.querySelector(".sheet-handle"), closeBattlefieldSheet);

})();
