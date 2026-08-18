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
 *  Counter time-range control ("Timing"): lets the person scope both
 *  the giant counter and the globe's beer lights to the last 24h, the
 *  last week, or all time. Lives as the "Time" row inside the
 *  top-right "Layer" popover (#view-menu-list) — see createIconRow
 *  further down, which wires up its drag/tap mechanics generically
 *  for this row and the Map/Show rows alike.
 * ---------------------------------------------------------------- */

const COUNTER_RANGE_ORDER = ["all", "week", "24h"];

const beerCounterContainer = document.getElementById("beer-counter");

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
  initBeerLights(range, viewScopeMode);
}

// The Time row's selection/drag mechanics are wired up generically by
// createIconRow, alongside the Map and Show rows — see
// "View menu: the top-right 'Layer' popover" further down.

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
let currentProfile = null; // { id, username, created_at }

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
    await loadCurrentLeagueMembership();
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
      .select("id, username, created_at")
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

const viewMenuPanel = document.getElementById("view-menu-panel");
const viewMenuBtn = document.getElementById("view-menu-btn");
const viewMenuBtnIcon = document.getElementById("view-menu-btn-icon");
const viewMenuList = document.getElementById("view-menu-list");

// Populated inside style.load below with every fill/background layer id
// from the base vector style — exactly the layers that need hiding when
// satellite view (or the country-coverage view further down) is on,
// since otherwise they'd paint over it.
const baseFillLayerIds = [];
const baseBackgroundLayerIds = [];
let satelliteEnabled = false;
// Set inside style.load, reused later to insert the country-coverage
// layers (see ensureMainMapCountriesLayer) at the same spot as the
// satellite layer, so line/border layers stay drawn on top of both.
let firstVectorLineLayerId = undefined;
let viewBasemapMode = "satellite"; // "satellite" | "my-country" | "missing-countries"
let viewScopeMode = "everybody"; // "everybody" | "league" | "me"

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
  // Fill/background layer ids are also collected here — they're exactly
  // the layers that need hiding when satellite view is switched on below,
  // since otherwise they'd paint straight over the satellite imagery.
  map.getStyle().layers.forEach((layer) => {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
    if (layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-opacity", 1);
      baseFillLayerIds.push(layer.id);
    }
    if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-opacity", 1);
      baseBackgroundLayerIds.push(layer.id);
    }
  });

  // Satellite view: a free, no-API-key raster imagery layer (EOX
  // Sentinel-2 cloudless — https://s2maps.eu, CC BY 4.0) added
  // underneath the vector style's line/border layers so those still
  // show through as a hybrid look when satellite is toggled on.
  // Starts hidden; setSatelliteView below flips it (and the base
  // fill/background layers it needs to hide) once the mode is applied
  // just below.
  const firstLineLayer = map.getStyle().layers.find((layer) => layer.type === "line");
  firstVectorLineLayerId = firstLineLayer ? firstLineLayer.id : undefined;
  map.addSource("satellite", {
    type: "raster",
    tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
    tileSize: 256,
    attribution: "Sentinel-2 cloudless — s2maps.eu by EOX IT Services GmbH",
  });
  map.addLayer(
    {
      id: "satellite",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
    },
    firstVectorLineLayerId
  );
  viewMenuBtn.disabled = false;
  setViewBasemapMode("satellite"); // satellite is the default view

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
    initBeerLights("all", viewScopeMode);
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
 *  View menu: the top-right button beneath the main menu, opened
 *  with a "Layer" icon, reveals a small popover (same frosted-glass
 *  look as the main one) with three independent, icon-only rows —
 *  see createIconRow below for the shared drag/tap mechanics.
 *
 *  Map (mutually exclusive):
 *    - Satellite: the EOX raster layer added above (default)
 *    - My country only: every country this user has logged a beer in,
 *      highlighted gold on an otherwise dim world (same idea as the
 *      profile drawer's mini map, reused here on the interactive globe)
 *    - Countries I don't have: the inverse — gold is what's missing
 *
 *  Show (mutually exclusive, filters which beer lights render):
 *    - Everybody counts: every logged beer, worldwide (default)
 *    - My league only: currentLeague's member ids (see the League
 *      card in the profile drawer for join/create) — empty globe if
 *      the user isn't in one
 *    - Me only: just this signed-in user's own beers
 *
 *  Time (mutually exclusive, scopes the counter + beer lights):
 *    - All time (default) / Week / 24h
 *
 *  None of the Map/Show choices ever call map.setStyle(), so none of
 *  the globe/sky/light/beer-lights setup above needs to be redone —
 *  this only flips layer visibility (and beer-light query filters) on
 *  the style already loaded.
 * ---------------------------------------------------------------- */

function setSatelliteView(enabled) {
  satelliteEnabled = enabled;
  map.setLayoutProperty("satellite", "visibility", enabled ? "visible" : "none");
  const vectorVisibility = enabled ? "none" : "visible";
  baseFillLayerIds.forEach((id) => map.setLayoutProperty(id, "visibility", vectorVisibility));
  baseBackgroundLayerIds.forEach((id) => map.setLayoutProperty(id, "visibility", vectorVisibility));
}

// Mirrors the profile drawer's mini map: default-fill (dim) countries
// with a gold "match" expression for whichever ISO_A2 set applies.
// invert=true swaps which side of the set gets the gold treatment,
// used for "Countries I don't have".
function buildCountryFillExpression(visitedIso2, invert) {
  const visitedColor = invert ? PROFILE_MAP_DEFAULT_FILL : PROFILE_MAP_GOLD;
  const defaultColor = invert ? PROFILE_MAP_GOLD : PROFILE_MAP_DEFAULT_FILL;
  if (!visitedIso2 || !visitedIso2.size) return defaultColor;
  const expr = ["match", ["get", "ISO_A2"]];
  visitedIso2.forEach((code) => expr.push(code, visitedColor));
  expr.push(defaultColor);
  return expr;
}

// Lazily adds the "countries" source + fill/line layers to the globe
// (reusing profileMapGeojson if the profile drawer already fetched
// it), inserted at the same spot as the satellite layer so the vector
// style's own line/border layers stay drawn on top of both. Cached in
// a promise so repeat mode switches don't re-add or re-fetch.
let mainMapCountriesLayerPromise = null;
function ensureMainMapCountriesLayer() {
  if (mainMapCountriesLayerPromise) return mainMapCountriesLayerPromise;
  mainMapCountriesLayerPromise = (async () => {
    if (!profileMapGeojson) {
      const res = await fetch(WORLD_COUNTRIES_GEOJSON_URL);
      if (!res.ok) throw new Error(`Failed to load world map (${res.status})`);
      profileMapGeojson = await res.json();
    }
    if (!map.getSource("countries")) {
      map.addSource("countries", { type: "geojson", data: profileMapGeojson });
    }
    if (!map.getLayer("countries-fill")) {
      map.addLayer(
        {
          id: "countries-fill",
          type: "fill",
          source: "countries",
          layout: { visibility: "none" },
          paint: { "fill-color": PROFILE_MAP_DEFAULT_FILL },
        },
        firstVectorLineLayerId
      );
    }
    if (!map.getLayer("countries-line")) {
      map.addLayer(
        {
          id: "countries-line",
          type: "line",
          source: "countries",
          layout: { visibility: "none" },
          paint: { "line-color": PROFILE_MAP_LINE_COLOR, "line-width": 0.5 },
        },
        firstVectorLineLayerId
      );
    }
  })();
  return mainMapCountriesLayerPromise;
}

// This user's visited-country ISO2 codes, cached for the session once
// resolved — kept separate from the profile drawer's own copy (which
// intentionally re-resolves fresh every time that drawer opens) since
// re-running the reverse-geocode pass on every map-mode switch here
// would be wasteful.
let mainMapVisitedIso2 = new Set();
let mainMapVisitedPromise = null;
function ensureMainMapVisitedCountries() {
  if (!mainMapVisitedPromise) {
    mainMapVisitedPromise = loadProfileMapVisitedCountries()
      .then((set) => {
        mainMapVisitedIso2 = set;
        return set;
      })
      .catch((err) => {
        console.error("Failed to load visited countries for globe view:", err);
        mainMapVisitedPromise = null;
        return new Set();
      });
  }
  return mainMapVisitedPromise;
}

// The layer button's own icon switches to the filled/solid glyph
// whenever any of the three rows sits away from its default (Map:
// satellite, Show: everybody, Time: all time) — a quick "something's
// customized in here" signal on the closed button, before the person
// even opens the popover to see which row it is.
function updateViewMenuBtnFillState() {
  const isCustomized = viewBasemapMode !== "satellite" || viewScopeMode !== "everybody" || selectedCounterRange !== "all";
  if (viewMenuBtnIcon) viewMenuBtnIcon.classList.toggle("is-filled", isCustomized);
}

async function setViewBasemapMode(mode) {
  viewBasemapMode = mode;
  updateViewMenuBtnFillState();
  setSatelliteView(mode === "satellite");

  const showCountries = mode === "my-country" || mode === "missing-countries";
  if (!showCountries) {
    if (map.getLayer("countries-fill")) {
      map.setLayoutProperty("countries-fill", "visibility", "none");
      map.setLayoutProperty("countries-line", "visibility", "none");
    }
    return;
  }

  try {
    await ensureMainMapCountriesLayer();
    const visited = await ensureMainMapVisitedCountries();
    // Bail if the menu moved on to a different mode while this was
    // resolving, so a slow geocode pass can't clobber a later choice.
    if (viewBasemapMode !== mode) return;
    map.setPaintProperty("countries-fill", "fill-color", buildCountryFillExpression(visited, mode === "missing-countries"));
    map.setLayoutProperty("countries-fill", "visibility", "visible");
    map.setLayoutProperty("countries-line", "visibility", "visible");
  } catch (err) {
    console.error("Failed to show country coverage on the globe:", err);
  }
}

function setViewScopeMode(scope) {
  viewScopeMode = scope;
  updateViewMenuBtnFillState();
  initBeerLights(selectedCounterRange, scope);
}

function openViewMenu() {
  viewMenuList.hidden = false;
  requestAnimationFrame(() => {
    viewMenuList.classList.add("is-open");
  });
  viewMenuBtn.setAttribute("aria-expanded", "true");
  document.addEventListener("click", onDocumentClickForViewMenu, true);
  document.addEventListener("keydown", onDocumentKeydownForViewMenu);
}

function closeViewMenu() {
  viewMenuList.classList.remove("is-open");
  viewMenuBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDocumentClickForViewMenu, true);
  document.removeEventListener("keydown", onDocumentKeydownForViewMenu);
  const onTransitionEnd = () => {
    viewMenuList.hidden = true;
    viewMenuList.removeEventListener("transitionend", onTransitionEnd);
  };
  viewMenuList.addEventListener("transitionend", onTransitionEnd);
}

function onDocumentClickForViewMenu(e) {
  if (viewMenuList.contains(e.target) || viewMenuBtn.contains(e.target)) return;
  closeViewMenu();
}

function onDocumentKeydownForViewMenu(e) {
  if (e.key === "Escape") closeViewMenu();
}

viewMenuBtn.addEventListener("click", () => {
  if (viewMenuList.classList.contains("is-open")) {
    closeViewMenu();
  } else {
    openViewMenu();
  }
});

/* ---------------------------------------------------------------- *
 *  Generic draggable icon row: powers every section inside the
 *  "Layer" popover above (Map / Show / Time). Each row is a small
 *  horizontal segmented control, icon-only, with a solid pill under
 *  whichever icon is active. Tap an icon to select it directly, or
 *  press-and-drag the pill itself — it follows your finger across the
 *  row and snaps to the nearest icon on release, same mechanics the
 *  old standalone Time control used, now shared across all three
 *  rows. Unlike the old per-control popovers, selecting an option
 *  here does NOT close the popover, since the three rows are
 *  independent choices someone may want to adjust one after another.
 * ---------------------------------------------------------------- */
function createIconRow({ row, thumb, order, datasetKey, initial, onSelect }) {
  const items = Array.from(row.querySelectorAll(".popover-icon-row-item"));
  let selected = initial;
  let dragging = false;
  let dragItemWidth = 0;
  let dragTrackLeft = 0;
  let dragX = 0;

  function applySelection(value, { animate = true } = {}) {
    const index = order.indexOf(value);
    if (index === -1) return;
    selected = value;
    items.forEach((item) => {
      const isActive = item.dataset[datasetKey] === value;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-checked", String(isActive));
    });
    if (!animate) thumb.classList.add("is-dragging");
    thumb.style.transform = `translateX(${index * 100}%)`;
    if (!animate) {
      // Force a reflow so the transform above applies instantly
      // before transitions are re-enabled, otherwise the next real
      // drag/snap would animate from the stale position.
      void thumb.offsetWidth;
      thumb.classList.remove("is-dragging");
    }
  }

  function selectAndNotify(value) {
    const changed = value !== selected;
    applySelection(value);
    if (changed) onSelect(value);
  }

  items.forEach((item) => {
    item.addEventListener("click", () => selectAndNotify(item.dataset[datasetKey]));
  });

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    thumb.classList.add("is-dragging");
    thumb.setPointerCapture(e.pointerId);
    const trackRect = row.getBoundingClientRect();
    const trackPadding = 3; // must match .popover-icon-row padding
    dragTrackLeft = trackRect.left + trackPadding;
    dragItemWidth = (trackRect.width - trackPadding * 2) / order.length;
    dragX = dragItemWidth * order.indexOf(selected);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const maxX = dragItemWidth * (order.length - 1);
    dragX = Math.max(0, Math.min(maxX, e.clientX - dragTrackLeft - dragItemWidth / 2));
    thumb.style.transform = `translateX(${dragX}px)`;
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("is-dragging");
    const index = Math.round(dragX / dragItemWidth);
    const value = order[Math.max(0, Math.min(order.length - 1, index))];
    selectAndNotify(value);
  }

  thumb.addEventListener("pointerdown", onPointerDown);
  thumb.addEventListener("pointermove", onPointerMove);
  thumb.addEventListener("pointerup", onPointerUp);
  thumb.addEventListener("pointercancel", onPointerUp);

  // Snap the thumb to its initial position with no transition, so it
  // doesn't animate in from the left on first paint.
  applySelection(initial, { animate: false });

  return { select: selectAndNotify };
}

createIconRow({
  row: document.getElementById("view-mode-row"),
  thumb: document.getElementById("view-mode-thumb"),
  order: ["satellite", "my-country", "missing-countries"],
  datasetKey: "viewMode",
  initial: viewBasemapMode,
  onSelect: setViewBasemapMode,
});

createIconRow({
  row: document.getElementById("view-scope-row"),
  thumb: document.getElementById("view-scope-thumb"),
  order: ["everybody", "league", "me"],
  datasetKey: "viewScope",
  initial: viewScopeMode,
  onSelect: setViewScopeMode,
});

createIconRow({
  row: document.getElementById("counter-range-row"),
  thumb: document.getElementById("counter-range-thumb"),
  order: COUNTER_RANGE_ORDER,
  datasetKey: "range",
  initial: selectedCounterRange,
  onSelect: (range) => {
    selectedCounterRange = range;
    updateViewMenuBtnFillState();
    applyCounterRange(range);
  },
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
// clearing out whatever's currently on the globe first. `who` is the
// view menu's "Show" selection — "me" filters to just this user's own
// entries; "league" filters to currentLeague's member ids (empty globe
// if the user isn't in a league — see the profile drawer's League
// card for join/create).
async function initBeerLights(range = "all", who = viewScopeMode) {
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
    if (who === "me" && currentUser) {
      query = query.eq("user_id", currentUser.id);
    } else if (who === "league") {
      if (!currentLeague) {
        // Not in a league — nothing to scope to yet. Left empty rather
        // than silently falling back to "everybody", since selecting
        // this and seeing the full globe would be misleading.
        beerLights = [];
        updateBeerLightFade();
        return;
      }
      const memberIds = Array.from(await ensureLeagueMemberIds());
      if (!memberIds.length) {
        beerLights = [];
        updateBeerLightFade();
        return;
      }
      query = query.in("user_id", memberIds);
    }
    const { data, error } = await query;
    if (error) throw error;
    locations = (data || []).map((row) => ({ lat: row.bar_lat, lng: row.bar_lng }));
  } catch (err) {
    console.error("Failed to load shared beer lights, falling back to local cache:", err);
    // The local cache has no timestamps or user ids to filter by, so
    // it only makes sense as a fallback for the all-time/everybody view.
    locations = range === "all" && who !== "league" ? getStoredBeerLightLocations() : [];
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

const beerExpertToggle = document.getElementById("beer-expert-toggle");
const beerExpertFields = document.getElementById("beer-expert-fields");

const barSearchInput = document.getElementById("bar-search-input");
const barSearchResults = document.getElementById("bar-search-results");
const barRequiredHint = document.getElementById("bar-required-hint");

const beerChipRow = document.getElementById("beer-chip-row");
const beerSearch = document.getElementById("beer-search");
const beerSearchInput = document.getElementById("beer-search-input");
const beerSearchResults = document.getElementById("beer-search-results");

const priceCarousel = document.getElementById("price-carousel");
const sizeCarousel = document.getElementById("size-carousel");

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
  resetSizeState();
  renderBeerChips();
  locateUserForBars();
  setBeerExpertMode(false);
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
  resetSizeState();
}

sheetBackdrop.addEventListener("click", closeBeerSheet);
document.getElementById("beer-back-btn").addEventListener("click", closeBeerSheet);
document.getElementById("beer-close-btn").addEventListener("click", closeBeerSheet);

/* Expert mode: reveals the optional Beer / Price / Rating fields.
   Off by default each time the drawer opens (see openBeerSheet)
   so it always starts at its smallest. */
function setBeerExpertMode(isOpen) {
  beerExpertFields.classList.toggle("is-open", isOpen);
  beerExpertToggle.setAttribute("aria-pressed", String(isOpen));
}

beerExpertToggle.addEventListener("click", () => {
  const isOpen = beerExpertToggle.getAttribute("aria-pressed") === "true";
  setBeerExpertMode(!isOpen);
});

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

// Called on reset/location changes. The only text this hint area ever
// shows now is the "please enter a bar name" validation error (set
// directly where that's checked), so this just keeps it hidden the
// rest of the time.
function updateBarHint() {
  barRequiredHint.hidden = true;
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
    btn.dataset.decimal = "0"; // tenths, set via long-press/upward-drag fine-tune
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.addEventListener("click", () => centerPriceItem(btn));
    btn.addEventListener("pointerdown", (e) => onPriceItemPointerDown(e, btn));
    btn.addEventListener("pointermove", (e) => onPriceItemPointerMove(e, btn));
    btn.addEventListener("pointerup", (e) => onPriceItemPointerUp(e, btn));
    btn.addEventListener("pointercancel", (e) => onPriceItemPointerUp(e, btn));
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

  selectedPrice =
    closest.dataset.value === PRICE_SKIP_VALUE
      ? null
      : Number(closest.dataset.value) + Number(closest.dataset.decimal || 0) / 10;
  Array.from(priceCarousel.children).forEach((item) => {
    const isSelected = item === closest;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-checked", isSelected ? "true" : "false");
  });
}

function resetPriceState() {
  selectedPrice = null;
  closePriceDecimalAdjust(false);
  priceCarousel.scrollTo({ left: 0 });
  Array.from(priceCarousel.children).forEach((item, i) => {
    item.classList.toggle("is-selected", i === 0);
    item.setAttribute("aria-checked", i === 0 ? "true" : "false");
    if (item.dataset.value !== PRICE_SKIP_VALUE) {
      item.dataset.decimal = "0";
      item.textContent = `$${item.dataset.value}`;
    }
  });
  requestAnimationFrame(updatePriceWheelVisuals);
}

initPriceCarousel();
requestAnimationFrame(updatePriceWheelVisuals);

/* ---------------------------------------------------------------- *
 *  Price fine-tune: lets a cent-level value be dialed in on top of
 *  the whole-dollar wheel above, via either gesture:
 *    - hold a number for PRICE_LONG_PRESS_MS without moving, or
 *    - start dragging upward on a number past a small threshold
 *  Either opens a small vertical ".0"-".9" popover above that item;
 *  further up/down movement (PRICE_DECIMAL_STEP_PX per digit) moves
 *  through the tenths, and releasing commits it (e.g. "$7" -> "$7.4").
 *  Ordinary sideways spinning of the wheel is untouched — this only
 *  engages once vertical intent is clear, and .price-wheel-track sets
 *  touch-action: pan-x so the bottom sheet doesn't swallow the
 *  vertical drag as a page scroll before we get to see it.
 * ---------------------------------------------------------------- */

const PRICE_LONG_PRESS_MS = 1000;
const PRICE_DECIMAL_TRIGGER_PX = 14; // upward move that opens fine-tune immediately
const PRICE_DECIMAL_STEP_PX = 20; // vertical px per tenth digit
const PRICE_DECIMAL_MAX_DIGIT = 9;

let priceDecimalPopover = null;
let priceDecimalActiveItem = null;
let priceDecimalStartX = 0;
let priceDecimalStartY = 0;
let priceDecimalStartDigit = 0;
let priceDecimalLongPressTimer = null;
let priceDecimalDragging = false; // true once fine-tune mode is actually engaged
let priceDecimalPointerId = null;

function priceItemDecimal(item) {
  return Number(item.dataset.decimal || 0);
}

function formatPriceItemLabel(item) {
  const decimal = priceItemDecimal(item);
  return decimal > 0 ? `$${item.dataset.value}.${decimal}` : `$${item.dataset.value}`;
}

function ensurePriceDecimalPopover() {
  if (priceDecimalPopover) return priceDecimalPopover;
  const el = document.createElement("div");
  el.className = "price-decimal-popover";
  el.setAttribute("aria-hidden", "true");
  for (let d = 0; d <= PRICE_DECIMAL_MAX_DIGIT; d++) {
    const digitEl = document.createElement("span");
    digitEl.className = "price-decimal-digit";
    digitEl.textContent = `.${d}`;
    digitEl.dataset.digit = String(d);
    el.appendChild(digitEl);
  }
  el.hidden = true;
  // Appended to <body> with position: fixed (see style.css) rather than
  // nested in the price wheel, since the drawer's grid-rows collapse
  // trick relies on an overflow:hidden ancestor that would otherwise
  // clip a popover poking out above the wheel.
  document.body.appendChild(el);
  priceDecimalPopover = el;
  return el;
}

// Anchors the fixed-position popover to the current screen location of
// `item` — called once on open, since the item's own position doesn't
// shift again while a fine-tune drag is in progress.
function positionPriceDecimalPopover(item) {
  const popover = ensurePriceDecimalPopover();
  const rect = item.getBoundingClientRect();
  popover.style.left = `${rect.left + rect.width / 2}px`;
  popover.style.top = `${rect.top}px`;
}

// Clamps to 0-9 and highlights the matching digit in the popover;
// returns the clamped value so callers can store it.
function updatePriceDecimalHighlight(digit) {
  const clamped = Math.max(0, Math.min(PRICE_DECIMAL_MAX_DIGIT, digit));
  const popover = ensurePriceDecimalPopover();
  Array.from(popover.children).forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.digit) === clamped);
  });
  return clamped;
}

function openPriceDecimalAdjust(item, startDigit) {
  priceDecimalDragging = true;
  priceDecimalActiveItem = item;
  item.classList.add("is-fine-tuning");
  const popover = ensurePriceDecimalPopover();
  positionPriceDecimalPopover(item);
  popover.hidden = false;
  requestAnimationFrame(() => popover.classList.add("is-open"));
  updatePriceDecimalHighlight(startDigit);
}

function closePriceDecimalAdjust(commit) {
  if (!priceDecimalDragging) return;
  const item = priceDecimalActiveItem;
  const popover = priceDecimalPopover;
  if (popover) {
    popover.classList.remove("is-open");
    const onEnd = () => {
      popover.hidden = true;
      popover.removeEventListener("transitionend", onEnd);
    };
    popover.addEventListener("transitionend", onEnd);
  }
  if (item) {
    item.classList.remove("is-fine-tuning");
    if (commit) {
      item.textContent = formatPriceItemLabel(item);
      centerPriceItem(item); // re-centers + triggers commitPriceWheelSelection,
      // which reads item.dataset.decimal set during the drag below
    }
  }
  priceDecimalDragging = false;
  priceDecimalActiveItem = null;
}

function onPriceItemPointerDown(e, item) {
  if (item.dataset.value === PRICE_SKIP_VALUE) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  clearTimeout(priceDecimalLongPressTimer);
  priceDecimalStartX = e.clientX;
  priceDecimalStartY = e.clientY;
  priceDecimalStartDigit = priceItemDecimal(item);
  priceDecimalPointerId = e.pointerId;
  priceDecimalDragging = false;

  priceDecimalLongPressTimer = setTimeout(() => {
    if (priceDecimalPointerId === e.pointerId && !priceDecimalDragging) {
      openPriceDecimalAdjust(item, priceDecimalStartDigit);
    }
  }, PRICE_LONG_PRESS_MS);
}

function onPriceItemPointerMove(e, item) {
  if (priceDecimalPointerId !== e.pointerId) return;
  const deltaY = priceDecimalStartY - e.clientY; // positive = moved upward

  if (!priceDecimalDragging) {
    const deltaX = Math.abs(e.clientX - priceDecimalStartX);
    // Only treat this as fine-tune once the vertical movement clearly
    // leads the horizontal one — otherwise it's just a normal spin.
    if (deltaY > PRICE_DECIMAL_TRIGGER_PX && deltaY > deltaX) {
      clearTimeout(priceDecimalLongPressTimer);
      openPriceDecimalAdjust(item, priceDecimalStartDigit);
      try {
        item.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort — harmless if unsupported.
      }
    } else {
      return;
    }
  }

  e.preventDefault();
  const digit = updatePriceDecimalHighlight(priceDecimalStartDigit + Math.round(deltaY / PRICE_DECIMAL_STEP_PX));
  item.dataset.decimal = String(digit);
  item.textContent = formatPriceItemLabel(item);
}

function onPriceItemPointerUp(e, item) {
  clearTimeout(priceDecimalLongPressTimer);
  if (priceDecimalPointerId === e.pointerId) {
    closePriceDecimalAdjust(priceDecimalDragging);
  }
  priceDecimalPointerId = null;
}

/* ---------------------------------------------------------------- *
 *  Size: the same Apple-style wheel dial as Price, just spun off of
 *  a fixed list of common beer sizes instead of a numeric range.
 * ---------------------------------------------------------------- */

const SIZE_ITEM_WIDTH = 78; // px, must match .size-wheel-item flex-basis
const SIZE_SKIP_VALUE = ""; // sentinel dataset value for "no size"
const SIZE_VALUES = [
  "33cl", "35.5cl", "50cl", "57cl", "65cl", "74.5cl", "75cl", "1L",
  "6pack", "24 crate", "30 crate",
];

let selectedSize = null;
let sizeScrollRaf = null;
let sizeCommitTimer = null;

function initSizeCarousel() {
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "price-wheel-item price-wheel-item-skip size-wheel-item";
  skipBtn.textContent = "–";
  skipBtn.dataset.value = SIZE_SKIP_VALUE;
  skipBtn.setAttribute("role", "radio");
  skipBtn.setAttribute("aria-label", "No size");
  skipBtn.setAttribute("aria-checked", "true");
  skipBtn.addEventListener("click", () => centerSizeItem(skipBtn));
  sizeCarousel.appendChild(skipBtn);

  SIZE_VALUES.forEach((value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "price-wheel-item size-wheel-item";
    btn.textContent = value;
    btn.dataset.value = value;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.addEventListener("click", () => centerSizeItem(btn));
    sizeCarousel.appendChild(btn);
  });

  sizeCarousel.addEventListener("scroll", onSizeWheelScroll, { passive: true });
}

// Smoothly spins the wheel so `item` lands under the center indicator.
// The scroll handler below picks up the resulting scroll and commits
// it as the selection once the motion settles.
function centerSizeItem(item) {
  item.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function onSizeWheelScroll() {
  if (sizeScrollRaf) cancelAnimationFrame(sizeScrollRaf);
  sizeScrollRaf = requestAnimationFrame(updateSizeWheelVisuals);

  clearTimeout(sizeCommitTimer);
  sizeCommitTimer = setTimeout(commitSizeWheelSelection, 120);
}

// Scales/fades each item by its distance from the center indicator so
// the wheel reads as continuous motion while the user drags/flicks.
function updateSizeWheelVisuals() {
  const trackRect = sizeCarousel.getBoundingClientRect();
  const centerX = trackRect.left + trackRect.width / 2;

  Array.from(sizeCarousel.children).forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const dist = Math.abs(itemCenter - centerX);
    const norm = Math.min(dist / (SIZE_ITEM_WIDTH * 2.2), 1);
    item.style.transform = `scale(${1 - norm * 0.4})`;
    item.style.opacity = String(1 - norm * 0.7);
  });
}

// Once the wheel stops moving, whichever item is nearest center becomes
// the actual selection (and gets nudged the rest of the way to a clean
// center via CSS scroll-snap already handling most of that).
function commitSizeWheelSelection() {
  const trackRect = sizeCarousel.getBoundingClientRect();
  const centerX = trackRect.left + trackRect.width / 2;

  let closest = null;
  let closestDist = Infinity;
  Array.from(sizeCarousel.children).forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const dist = Math.abs(itemCenter - centerX);
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  });
  if (!closest) return;

  selectedSize = closest.dataset.value === SIZE_SKIP_VALUE ? null : closest.dataset.value;
  Array.from(sizeCarousel.children).forEach((item) => {
    const isSelected = item === closest;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-checked", isSelected ? "true" : "false");
  });
}

function resetSizeState() {
  selectedSize = null;
  sizeCarousel.scrollTo({ left: 0 });
  Array.from(sizeCarousel.children).forEach((item, i) => {
    item.classList.toggle("is-selected", i === 0);
    item.setAttribute("aria-checked", i === 0 ? "true" : "false");
  });
  requestAnimationFrame(updateSizeWheelVisuals);
}

initSizeCarousel();
requestAnimationFrame(updateSizeWheelVisuals);

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
    size: selectedSize, // null if untouched
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

// Resolves (and caches, via the shared geocode cache used elsewhere
// in this file) the country for a fresh entry's coordinates, so it
// can be stored on the row itself. The server-side feed trigger
// (see the beer_entries AFTER INSERT trigger in Supabase) keys its
// "country discovered" / "took the throne" events off these two
// columns — that's the only reason the client still does this
// lookup: everything else about the feed now lives server-side.
async function resolveEntryCountry(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { country_code: null, country_name: null };
  const key = roundCoordKey(lat, lng);
  const cache = loadGeocodeCache();
  let resolved = cache[key];
  if (!resolved || resolved.country_code === undefined) {
    try {
      resolved = await reverseGeocodePlace(lat, lng);
    } catch (err) {
      resolved = { city: null, country: null, country_code: null };
    }
    cache[key] = resolved;
    saveGeocodeCache(cache);
  }
  return {
    country_code: resolved.country_code ? resolved.country_code.toUpperCase() : null,
    country_name: resolved.country || null,
  };
}

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
    const { country_code, country_name } = await resolveEntryCountry(entry.lat, entry.lng);
    const { error } = await supabaseClient.from("beer_entries").insert({
      user_id: entry.userId,
      bar_name: entry.barName,
      bar_lat: entry.lat,
      bar_lng: entry.lng,
      beer_name: entry.beerName,
      price: entry.price,
      size: entry.size,
      rating: entry.rating,
      photo_url: photoUrl,
      country_code,
      country_name,
    });
    if (error) throw error;
    loadProfileStats();
    profileActivityLoaded = false;
    if (profileStatBeersEl && profileStatBeersEl.classList.contains("is-expanded")) {
      profileActivityLoaded = true;
      loadProfileActivity();
    }
  } catch (err) {
    console.error("Failed to save beer entry to the server:", err);
  }
}

/* ---------------------------------------------------------------- *
 *  Live activity feed: a Twitch-chat-style ticker, pinned just above
 *  the "Add my beer" button (see #beer-feed in style.css), that
 *  broadcasts what everyone using the app is doing right now:
 *    "[user] added a new beer!"
 *    "[country] discovered! First beer added there!"
 *    "[user] is now first worldwide!"
 *    "[user] just logged their first beer!"
 *    "[bar name] discovered! First beer added there!"
 *    "[user] just hit [N] beers!"
 *    "[N] beers logged worldwide!"
 *    "[user] just claimed [bar name]!"
 *    "[user] took the [country] throne!"
 *
 *  All of that is now computed SERVER-SIDE, by a Postgres trigger on
 *  beer_entries (see feed_events_migration.sql) that writes one row
 *  per event into a `feed_events` table. The client's only job here
 *  is to subscribe to Realtime INSERTs on that table and render them
 *  — no more re-tallying leaderboards, re-geocoding history, or
 *  keeping local "known countries" state on every single client.
 * ---------------------------------------------------------------- */

const beerFeedEl = document.getElementById("beer-feed");
const BEER_FEED_ITEM_LIFETIME_MS = 6500;
const BEER_FEED_MAX_ITEMS = 30; // safety cap on DOM nodes, well above what's ever visible

let beerFeedProfileCache = {}; // user_id -> { username } | null

// Builds a message out of plain-text segments (some bolded) without
// ever touching innerHTML — usernames/bar names are free text people
// chose themselves, so this keeps the feed safe from markup injection.
function buildFeedMessageNode(segments) {
  const frag = document.createDocumentFragment();
  segments.forEach(([text, strong]) => {
    if (strong) {
      const el = document.createElement("strong");
      el.textContent = text;
      frag.appendChild(el);
    } else {
      frag.appendChild(document.createTextNode(text));
    }
  });
  return frag;
}

function pushBeerFeedMessage(segments, { milestone = false } = {}) {
  if (!beerFeedEl) return;

  // The panel itself fades/slides up once, the first time it has
  // anything to show — individual items just appear instantly after
  // that, so a long-running feed with many lines doesn't feel noisy.
  if (!beerFeedEl.classList.contains("is-active")) {
    beerFeedEl.classList.add("is-active");
  }

  while (beerFeedEl.children.length >= BEER_FEED_MAX_ITEMS) {
    beerFeedEl.removeChild(beerFeedEl.firstElementChild);
  }

  const item = document.createElement("div");
  item.className = "beer-feed-item" + (milestone ? " is-milestone" : "");
  item.appendChild(buildFeedMessageNode(segments));
  beerFeedEl.appendChild(item);

  setTimeout(() => {
    item.classList.add("is-leaving");
    item.addEventListener(
      "animationend",
      () => {
        if (item.parentNode) item.parentNode.removeChild(item);
      },
      { once: true }
    );
  }, BEER_FEED_ITEM_LIFETIME_MS);
}

async function getBeerFeedProfile(userId) {
  if (!userId) return null;
  if (userId in beerFeedProfileCache) return beerFeedProfileCache[userId];
  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();
    if (error) throw error;
    beerFeedProfileCache[userId] = data;
    return data;
  } catch (err) {
    console.warn("Beer feed: failed to load profile for", userId, err);
    beerFeedProfileCache[userId] = null;
    return null;
  }
}

function beerFeedDisplayName(profile) {
  return (profile && profile.username) || "Beer Explorer";
}

// Turns one feed_events row into the segments pushBeerFeedMessage
// wants, plus whether it should render with the "milestone" style.
// This is purely presentational — every decision about *whether* an
// event happened (first in a country, milestone reached, claim
// changed, ...) was already made server-side by the trigger.
async function buildFeedEventDisplay(row) {
  switch (row.event_type) {
    case "new_beer": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [" added a new beer!", false],
        ],
      };
    }
    case "first_beer": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [" just logged their first beer!", false],
        ],
        milestone: true,
      };
    }
    case "country_discovered": {
      return {
        segments: [
          [row.country_name || "A new country", true],
          [" discovered! First beer added there!", false],
        ],
        milestone: true,
      };
    }
    case "bar_discovered": {
      return {
        segments: [
          [row.bar_name || "A new bar", true],
          [" discovered! First beer added there!", false],
        ],
        milestone: true,
      };
    }
    case "user_milestone": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [` just hit ${row.milestone_count} beers!`, false],
        ],
        milestone: true,
      };
    }
    case "global_milestone": {
      return {
        segments: [
          [String(row.milestone_count), true],
          [" beers logged worldwide!", false],
        ],
        milestone: true,
      };
    }
    case "worldwide_first": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [" is now first worldwide!", false],
        ],
        milestone: true,
      };
    }
    case "bar_claimed": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [` just claimed ${row.bar_name}!`, false],
        ],
        milestone: true,
      };
    }
    case "country_throne": {
      const profile = await getBeerFeedProfile(row.actor_id);
      return {
        segments: [
          [beerFeedDisplayName(profile), true],
          [` took the ${row.country_name} throne!`, false],
        ],
        milestone: true,
      };
    }
    default:
      return null;
  }
}

async function handleFeedEventInsert(payload) {
  const row = payload && payload.new;
  if (!row) return;
  const display = await buildFeedEventDisplay(row);
  if (!display) return;
  pushBeerFeedMessage(display.segments, { milestone: Boolean(display.milestone) });
}

function initBeerFeed() {
  if (!beerFeedEl) return;

  supabaseClient
    .channel("feed-events")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "feed_events" }, handleFeedEventInsert)
    .subscribe((status, err) => {
      // If this never logs SUBSCRIBED, the feed will look empty even
      // when beers are being added — almost always because the
      // feed_events table hasn't been added to Supabase's realtime
      // publication yet (run feed_events_migration.sql, or toggle it
      // on under Database -> Replication in the dashboard).
      console.log("Beer feed realtime status:", status, err || "");
    });
}

initBeerFeed();

/* ---------------------------------------------------------------- *
 *  Profile: top-right button opens a bottom drawer with the signed-in
 *  (anonymous) user's name and stats. The avatar is a single fixed
 *  icon for everyone (not customizable). Name edits save straight to
 *  Supabase (profiles is owner-writable via RLS).
 * ---------------------------------------------------------------- */

const menuBtn = document.getElementById("menu-btn");
const menuBtnIcon = document.getElementById("menu-btn-icon");
const menuPanelList = document.getElementById("menu-panel-list");
const menuItemHome = document.getElementById("menu-item-home");
const menuItemProfile = document.getElementById("menu-item-profile");
const menuItemBattlefield = document.getElementById("menu-item-battlefield");
const menuItemStats = document.getElementById("menu-item-stats");
const menuPopoverIcons = Array.from(document.querySelectorAll(".menu-popover-icon[data-icon-kind]"));
const menuPopoverItems = Array.from(document.querySelectorAll(".menu-popover-item[data-icon-kind]"));
const profileSheetBackdrop = document.getElementById("profile-sheet-backdrop");
const profileSheet = document.getElementById("profile-sheet");
const profileBackBtn = document.getElementById("profile-back-btn");
const profileUsernameInput = document.getElementById("profile-username-input");
const profileStatCountEl = document.getElementById("profile-stat-count");
const profileStatSinceEl = document.getElementById("profile-stat-since");
const profileStatSpendEl = document.getElementById("profile-stat-spend");
const profileStatLitresEl = document.getElementById("profile-stat-litres");
const profileStatBeersEl = document.getElementById("profile-stat-beers");
const profileActivityListEl = document.getElementById("profile-activity-list");
const profileActivityEmptyEl = document.getElementById("profile-activity-empty");
const profileActivityStatusEl = document.getElementById("profile-activity-status");
const profileFavoriteEl = document.getElementById("profile-favorite");
const profileStatusEl = document.getElementById("profile-status");
const profileLeagueNoneEl = document.getElementById("profile-league-none");
const profileLeagueActiveEl = document.getElementById("profile-league-active");
const profileLeagueCodeInput = document.getElementById("profile-league-code-input");
const profileLeagueJoinBtn = document.getElementById("profile-league-join-btn");
const profileLeagueCreateBtn = document.getElementById("profile-league-create-btn");
const profileLeagueNameEl = document.getElementById("profile-league-name");
const profileLeagueCountEl = document.getElementById("profile-league-count");
const profileLeagueInviteCodeEl = document.getElementById("profile-league-invite-code");
const profileLeagueCopyBtn = document.getElementById("profile-league-copy-btn");
const profileLeagueLeaveBtn = document.getElementById("profile-league-leave-btn");
const profileLeagueStatusEl = document.getElementById("profile-league-status");

// Hides the top-right "Layer" popover button (Map/Show/Time) while a
// drawer opened from the menu popover (Profil, Stats, Battlefield) is
// open — "Add my beer" isn't reached from that popover, so it's left
// alone.
function setScheduleButtonVisible(visible) {
  if (viewMenuPanel) viewMenuPanel.classList.toggle("is-hidden", !visible);
}


function openProfileSheet() {
  closeOtherSheets(profileSheet);
  setScheduleButtonVisible(false);
  profileSheetBackdrop.hidden = false;
  profileSheet.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      profileSheetBackdrop.classList.add("is-open");
      profileSheet.classList.add("is-open");
    });
  });

  if (profileStatBeersEl) {
    profileStatBeersEl.classList.remove("is-expanded");
    profileStatBeersEl.setAttribute("aria-expanded", "false");
  }
  renderProfile();
  loadProfileStats();
  refreshProfileMapCoverage();
  renderProfileLeague();
}

function closeProfileSheet() {
  setScheduleButtonVisible(true);
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
 *  menu (not a full sheet) with items — "Home" recenters the globe
 *  and closes any open drawer; "Profil" opens the profile drawer;
 *  "Battlefield" isn't wired to anything yet. Whichever item was
 *  tapped last becomes the menu button's own icon and gets a solid
 *  pill background in the popover, so both reflect where you
 *  currently are.
 * ---------------------------------------------------------------- */

// Material Symbols Rounded glyph name for each popover "kind" — the
// menu button mirrors whichever one is active, filled in, via the
// variable font's FILL axis (see .is-active in style.css).
const MENU_ICON_NAME_BY_KIND = {
  home: "home",
  profile: "person",
  stats: "bar_chart",
  battlefield: "flag",
};

// Which popover item is currently "active" (i.e. was tapped last),
// mirrored onto the menu button's own icon. Starts on "home" since
// that's the state the app opens on.
let activeMenuIcon = "home";

function renderMenuButtonIcon() {
  if (!menuBtnIcon) return;
  const iconName = MENU_ICON_NAME_BY_KIND[activeMenuIcon] || MENU_ICON_NAME_BY_KIND.home;
  menuBtnIcon.innerHTML = `<span class="material-symbols-rounded is-filled" aria-hidden="true">${iconName}</span>`;
  updateMenuPopoverActiveIcons();
}

// Fills in whichever popover item's icon matches the current active
// section (outlined the rest of the time), and drops a solid pill
// behind that same item's row.
function updateMenuPopoverActiveIcons() {
  menuPopoverIcons.forEach((icon) => {
    icon.classList.toggle("is-active", icon.dataset.iconKind === activeMenuIcon);
  });
  menuPopoverItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.iconKind === activeMenuIcon);
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
profileBackBtn.addEventListener("click", () => {
  closeProfileSheet();
  setActiveMenuIcon("home");
});

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
      .select("beer_name, price", { count: "exact" })
      .eq("user_id", currentUser.id);
    if (error) throw error;

    profileStatCountEl.textContent = typeof count === "number" ? count.toLocaleString("en-US") : "0";

    const tally = {};
    let totalSpend = 0;
    (data || []).forEach((row) => {
      if (row.beer_name) tally[row.beer_name] = (tally[row.beer_name] || 0) + 1;
      if (typeof row.price === "number") totalSpend += row.price;
    });
    const favorite = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    profileFavoriteEl.hidden = !favorite;
    if (favorite) profileFavoriteEl.textContent = `Favorite beer: ${favorite}`;

    profileStatSpendEl.textContent = `$${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

    // beer_entries has no volume/serving-size column, so "litres drunk"
    // is an estimate: one logged beer = a standard 0.5L serving. Swap
    // this out for a real sum once/if a volume field gets added.
    const litres = (typeof count === "number" ? count : 0) * 0.5;
    profileStatLitresEl.textContent = `${litres.toLocaleString("en-US", { maximumFractionDigits: 1 })}L`;
  } catch (err) {
    console.error("Failed to load profile stats:", err);
    profileStatCountEl.textContent = "–";
    profileStatSpendEl.textContent = "–";
    profileStatLitresEl.textContent = "–";
  }
}

/* ---------------------------------------------------------------- *
 *  Recent activity: tapping the "Beers logged" tile expands it to
 *  almost full width and reveals the user's own log, most recent
 *  first. Only about 5 rows fit in the revealed space at once — the
 *  list itself scrolls internally for anything beyond that, rather
 *  than paging.
 * ---------------------------------------------------------------- */

const PROFILE_ACTIVITY_FETCH_LIMIT = 30; // plenty to fill the scrollable list
let profileActivityLoaded = false; // re-fetched next time the drawer opens, not on every tap

function toggleProfileActivity() {
  if (!profileStatBeersEl) return;
  const expanded = profileStatBeersEl.classList.toggle("is-expanded");
  profileStatBeersEl.setAttribute("aria-expanded", expanded ? "true" : "false");
  if (expanded && !profileActivityLoaded) {
    profileActivityLoaded = true;
    loadProfileActivity();
  }
}

if (profileStatBeersEl) {
  profileStatBeersEl.addEventListener("click", toggleProfileActivity);
  profileStatBeersEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleProfileActivity();
    }
  });
}

// Short, friendly "how long ago" label — same rough tiers used for
// the ETA card's duration text, just phrased as elapsed instead of
// remaining time.
function formatActivityTimeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, (Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function loadProfileActivity() {
  if (!currentUser || !profileActivityListEl) return;

  profileActivityListEl.innerHTML = "";
  profileActivityEmptyEl.hidden = true;
  profileActivityStatusEl.hidden = false;
  profileActivityStatusEl.classList.remove("field-hint-error");
  profileActivityStatusEl.textContent = "Loading…";

  try {
    const { data, error } = await supabaseClient
      .from("beer_entries")
      .select("beer_name, bar_name, price, rating, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(PROFILE_ACTIVITY_FETCH_LIMIT);
    if (error) throw error;

    const rows = data || [];
    profileActivityStatusEl.hidden = true;

    if (!rows.length) {
      profileActivityEmptyEl.hidden = false;
      return;
    }

    profileActivityListEl.innerHTML = "";
    rows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "profile-activity-item";

      const icon = document.createElement("span");
      icon.className = "profile-activity-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "🍺";

      const main = document.createElement("div");
      main.className = "profile-activity-main";

      const title = document.createElement("span");
      title.className = "profile-activity-title";
      title.textContent = row.beer_name || "Beer";

      const meta = document.createElement("span");
      meta.className = "profile-activity-meta";
      meta.textContent = [row.bar_name, formatActivityTimeAgo(row.created_at)].filter(Boolean).join(" · ");

      main.append(title, meta);

      const side = document.createElement("span");
      side.className = "profile-activity-side";
      side.textContent =
        typeof row.rating === "number" && row.rating > 0
          ? `${row.rating.toFixed(1)} ★`
          : typeof row.price === "number"
          ? `$${row.price.toFixed(2)}`
          : "";

      li.append(icon, main, side);
      profileActivityListEl.appendChild(li);
    });
  } catch (err) {
    console.error("Failed to load profile activity:", err);
    profileActivityStatusEl.hidden = false;
    profileActivityStatusEl.classList.add("field-hint-error");
    profileActivityStatusEl.textContent = "Couldn't load activity — try again.";
  }
}

/* ---------------------------------------------------------------- *
 *  League: a group the user is a member of — at most one at a time
 *  (joining/creating another replaces it; enforced here in app logic,
 *  not by the schema). Backs "My league only" in the globe's view
 *  menu. Membership is looked up fresh every time the profile drawer
 *  opens, same as the rest of the profile stats above.
 * ---------------------------------------------------------------- */

// currentLeague is read by ensureLeagueMemberIds() (used by the globe's
// beer-lights filter) as well as by the profile card here.
let currentLeague = null; // { id, name, invite_code } | null
let leagueMemberIdsPromise = null; // cache, invalidated on join/create/leave

function showProfileLeagueStatus(message, isError) {
  profileLeagueStatusEl.hidden = false;
  profileLeagueStatusEl.textContent = message;
  profileLeagueStatusEl.classList.toggle("field-hint-error", Boolean(isError));
}

function clearProfileLeagueStatus() {
  profileLeagueStatusEl.hidden = true;
  profileLeagueStatusEl.classList.remove("field-hint-error");
}

// 6 unambiguous uppercase letters/digits (no 0/O/1/I) — short enough
// to read out loud or type from memory.
const LEAGUE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateLeagueInviteCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += LEAGUE_CODE_ALPHABET[Math.floor(Math.random() * LEAGUE_CODE_ALPHABET.length)];
  }
  return code;
}

// Renders whichever of the two inner blocks matches currentLeague, and
// fills in the member count once currentLeague is set.
async function renderProfileLeagueCard() {
  const inLeague = Boolean(currentLeague);
  profileLeagueNoneEl.hidden = inLeague;
  profileLeagueActiveEl.hidden = !inLeague;
  if (!inLeague) return;

  profileLeagueNameEl.textContent = currentLeague.name;
  profileLeagueInviteCodeEl.textContent = currentLeague.invite_code;
  profileLeagueCountEl.textContent = "–";
  try {
    const { count, error } = await supabaseClient
      .from("league_members")
      .select("user_id", { count: "exact", head: true })
      .eq("league_id", currentLeague.id);
    if (error) throw error;
    profileLeagueCountEl.textContent = `${count || 0} member${count === 1 ? "" : "s"}`;
  } catch (err) {
    console.error("Failed to load league member count:", err);
    profileLeagueCountEl.textContent = "";
  }
}

// Resolves currentLeague from this user's membership row, if any —
// called once at startup (so the globe's "My league only" filter works
// without ever opening the profile drawer) and again every time that
// drawer opens (in case membership changed elsewhere/another device).
async function loadCurrentLeagueMembership() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from("league_members")
      .select("leagues(id, name, invite_code)")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    currentLeague = data && data.leagues ? data.leagues : null;
  } catch (err) {
    console.error("Failed to load league membership:", err);
    currentLeague = null;
  }
}

// Called every time the profile drawer opens.
async function renderProfileLeague() {
  if (!currentUser) return;
  clearProfileLeagueStatus();
  await loadCurrentLeagueMembership();
  renderProfileLeagueCard();
}

// Shared by both Join and Create: at most one league per user, so any
// existing membership row is cleared first.
async function replaceLeagueMembership(leagueId) {
  await supabaseClient.from("league_members").delete().eq("user_id", currentUser.id);
  const { error } = await supabaseClient.from("league_members").insert({ league_id: leagueId, user_id: currentUser.id });
  if (error) throw error;
  leagueMemberIdsPromise = null;
}

async function joinLeagueByCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (!code) return;
  if (!currentUser) {
    showProfileLeagueStatus("Sign-in still loading — try again in a moment.", true);
    return;
  }
  showProfileLeagueStatus("Joining…", false);
  try {
    const { data: league, error: findError } = await supabaseClient
      .from("leagues")
      .select("id, name, invite_code")
      .eq("invite_code", code)
      .maybeSingle();
    if (findError) throw findError;
    if (!league) {
      showProfileLeagueStatus("No league with that code.", true);
      return;
    }
    await replaceLeagueMembership(league.id);
    currentLeague = league;
    profileLeagueCodeInput.value = "";
    clearProfileLeagueStatus();
    renderProfileLeagueCard();
    // If "My league only" is the active Show scope, the globe's lights
    // should reflect the new membership right away.
    if (viewScopeMode === "league") initBeerLights(selectedCounterRange, "league");
  } catch (err) {
    console.error("Failed to join league:", err);
    showProfileLeagueStatus("Couldn't join that league — try again.", true);
  }
}

async function createLeague() {
  if (!currentUser) {
    showProfileLeagueStatus("Sign-in still loading — try again in a moment.", true);
    return;
  }
  const name = (window.prompt("Name your league") || "").trim();
  if (!name) return;
  showProfileLeagueStatus("Creating…", false);
  try {
    // Invite codes are unique; a collision is astronomically unlikely
    // at 33^6 combinations, but retried a couple of times just in case.
    let league = null;
    for (let attempt = 0; attempt < 3 && !league; attempt++) {
      const invite_code = generateLeagueInviteCode();
      const { data, error } = await supabaseClient
        .from("leagues")
        .insert({ name, invite_code, created_by: currentUser.id })
        .select("id, name, invite_code")
        .single();
      if (error) {
        if (error.code === "23505") continue; // invite_code collision — retry
        throw error;
      }
      league = data;
    }
    if (!league) throw new Error("Could not generate a unique invite code");

    await replaceLeagueMembership(league.id);
    currentLeague = league;
    clearProfileLeagueStatus();
    renderProfileLeagueCard();
    if (viewScopeMode === "league") initBeerLights(selectedCounterRange, "league");
  } catch (err) {
    console.error("Failed to create league:", err);
    showProfileLeagueStatus("Couldn't create a league — try again.", true);
  }
}

async function leaveLeague() {
  if (!currentUser || !currentLeague) return;
  showProfileLeagueStatus("Leaving…", false);
  try {
    const { error } = await supabaseClient
      .from("league_members")
      .delete()
      .eq("league_id", currentLeague.id)
      .eq("user_id", currentUser.id);
    if (error) throw error;
    currentLeague = null;
    leagueMemberIdsPromise = null;
    clearProfileLeagueStatus();
    renderProfileLeagueCard();
    if (viewScopeMode === "league") initBeerLights(selectedCounterRange, "league");
  } catch (err) {
    console.error("Failed to leave league:", err);
    showProfileLeagueStatus("Couldn't leave that league — try again.", true);
  }
}

profileLeagueJoinBtn.addEventListener("click", () => joinLeagueByCode(profileLeagueCodeInput.value));
profileLeagueCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinLeagueByCode(profileLeagueCodeInput.value);
});
profileLeagueCreateBtn.addEventListener("click", createLeague);
profileLeagueLeaveBtn.addEventListener("click", leaveLeague);
profileLeagueCopyBtn.addEventListener("click", async () => {
  if (!currentLeague) return;
  try {
    await navigator.clipboard.writeText(currentLeague.invite_code);
    showProfileLeagueStatus("Code copied", false);
    setTimeout(clearProfileLeagueStatus, 1200);
  } catch (err) {
    console.error("Failed to copy invite code:", err);
  }
});

// Resolves currentLeague's member ids for the globe's "My league only"
// beer-lights filter, cached until join/create/leave invalidates it.
async function ensureLeagueMemberIds() {
  if (!currentLeague) return new Set();
  if (!leagueMemberIdsPromise) {
    leagueMemberIdsPromise = supabaseClient
      .from("league_members")
      .select("user_id")
      .eq("league_id", currentLeague.id)
      .then(({ data, error }) => {
        if (error) throw error;
        return new Set((data || []).map((row) => row.user_id));
      })
      .catch((err) => {
        console.error("Failed to load league members:", err);
        leagueMemberIdsPromise = null;
        return new Set();
      });
  }
  return leagueMemberIdsPromise;
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
const statsEtaValueEl = document.getElementById("stats-eta-value");
const statsEtaCaptionEl = document.getElementById("stats-eta-caption");
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
  setScheduleButtonVisible(false);
  statsSheetBackdrop.hidden = false;
  statsSheet.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      statsSheetBackdrop.classList.add("is-open");
      statsSheet.classList.add("is-open");
    });
  });

  if (statsEtaCardEl) {
    statsEtaCardEl.classList.remove("is-expanded");
    statsEtaCardEl.setAttribute("aria-expanded", "false");
  }
  loadWorldStats();
  loadLeaderboard();
}

function closeStatsSheet() {
  setScheduleButtonVisible(true);
  statsSheetBackdrop.classList.remove("is-open");
  statsSheet.classList.remove("is-open");
  const onTransitionEnd = () => {
    statsSheetBackdrop.hidden = true;
    statsSheet.hidden = true;
    statsSheet.removeEventListener("transitionend", onTransitionEnd);
  };
  statsSheet.addEventListener("transitionend", onTransitionEnd);
}

beerCounterEl.addEventListener("click", () => {
  setActiveMenuIcon("stats");
  openStatsSheet();
});
statsSheetBackdrop.addEventListener("click", closeStatsSheet);
document.getElementById("stats-back-btn").addEventListener("click", () => {
  closeStatsSheet();
  setActiveMenuIcon("home");
});

// Fetches every entry's lightweight fields and tallies them client-side
// — simplest approach while the table stays small; swap for a Postgres
// view/RPC (avg, count, group by) if the table grows large.

// Turns an hours-from-now duration into a short, human "in about …"
// phrase for the ETA card's caption line.
function formatEtaDuration(hours) {
  const days = hours / 24;
  if (days < 1) return "less than a day";
  if (days < 60) {
    const n = Math.round(days);
    return `about ${n} day${n === 1 ? "" : "s"}`;
  }
  const months = days / 30.44;
  if (months < 24) {
    const n = Math.round(months);
    return `about ${n} month${n === 1 ? "" : "s"}`;
  }
  const years = days / 365.25;
  const n = years < 10 ? Math.round(years * 10) / 10 : Math.round(years);
  return `about ${n} year${n === 1 ? "" : "s"}`;
}

// Persists the last successfully computed ETA (value + caption text)
// across reloads/sessions, so a quiet stretch with no last-24h
// activity — pace would divide by zero — can still show the most
// recent real estimate instead of a "not enough data" placeholder.
const STATS_ETA_STORAGE_KEY = "statsEtaLastEstimate";

function loadStoredStatsEta() {
  try {
    const raw = localStorage.getItem(STATS_ETA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.value && parsed.caption ? parsed : null;
  } catch (err) {
    return null;
  }
}

function storeStatsEta(value, caption, etaIso) {
  try {
    localStorage.setItem(STATS_ETA_STORAGE_KEY, JSON.stringify({ value, caption, etaIso }));
  } catch (err) {
    // Best-effort — a stale/missing cache just means the next quiet
    // stretch falls back to the "not enough data" placeholder.
  }
}

// Projects when the worldwide counter (capped at COUNTER_MAX) will hit
// its cap, from the current total and the pace over the last 24h.
// Paints the full-width ETA card above the stat grid with the result.
function updateStatsEtaCard(total, loggedToday, rows) {
  if (!statsEtaValueEl) return;

  const remaining = COUNTER_MAX - total;
  if (remaining <= 0) {
    statsEtaValueEl.textContent = "Already there! 🎉";
    statsEtaCaptionEl.textContent = `${COUNTER_MAX.toLocaleString("en-US")} beers logged worldwide`;
    renderStatsEtaChart(rows, total, null);
    return;
  }

  const ratePerHour = loggedToday / 24;
  if (!ratePerHour) {
    // No activity in the last 24h to compute a fresh pace — keep
    // showing the last real calculation rather than a placeholder.
    const stored = loadStoredStatsEta();
    if (stored) {
      statsEtaValueEl.textContent = stored.value;
      statsEtaCaptionEl.textContent = stored.caption;
      renderStatsEtaChart(rows, total, stored.etaIso ? new Date(stored.etaIso) : null);
    } else {
      statsEtaValueEl.textContent = "Not enough data yet";
      statsEtaCaptionEl.textContent = "Needs more recent activity to estimate the millionth beer";
      renderStatsEtaChart(rows, total, null);
    }
    return;
  }

  const hoursRemaining = remaining / ratePerHour;
  const etaDate = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000);
  const formattedDate = etaDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const caption = `The millionth beer, in ${formatEtaDuration(hoursRemaining)} at the current pace`;

  statsEtaValueEl.textContent = formattedDate;
  statsEtaCaptionEl.textContent = caption;
  storeStatsEta(formattedDate, caption, etaDate.toISOString());
  renderStatsEtaChart(rows, total, etaDate);
}

// Tapping the ETA card grows it downward to reveal a small chart:
// years along the x-axis, cumulative beers logged along the y-axis,
// a solid line for the real history and a dashed line projecting
// forward to the 1,000,000 mark at the current pace.
const statsEtaCardEl = document.getElementById("stats-eta-card");
const statsEtaChartEl = document.getElementById("stats-eta-chart");

function toggleStatsEtaChart() {
  if (!statsEtaCardEl) return;
  const expanded = statsEtaCardEl.classList.toggle("is-expanded");
  statsEtaCardEl.setAttribute("aria-expanded", expanded ? "true" : "false");
}

if (statsEtaCardEl) {
  statsEtaCardEl.addEventListener("click", toggleStatsEtaChart);
  statsEtaCardEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleStatsEtaChart();
    }
  });
}

// Buckets raw entries into a cumulative "beers logged by end of year"
// series, e.g. [{year: 2023, total: 4200}, {year: 2024, total: 15300}, ...]
function computeYearlyCumulative(rows) {
  const counts = new Map();
  rows.forEach((r) => {
    if (!r.created_at) return;
    const year = new Date(r.created_at).getFullYear();
    if (Number.isNaN(year)) return;
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  const years = Array.from(counts.keys()).sort((a, b) => a - b);
  let cumulative = 0;
  return years.map((year) => {
    cumulative += counts.get(year);
    return { year, total: cumulative };
  });
}

function renderStatsEtaChart(rows, total, etaDate) {
  if (!statsEtaChartEl) return;
  const points = computeYearlyCumulative(rows || []);
  if (!points.length) {
    statsEtaChartEl.innerHTML = "";
    return;
  }

  // Make sure the most recent point reflects the live total (today),
  // not just whatever was logged by Dec 31 of the current year.
  const nowYear = new Date().getFullYear();
  if (points[points.length - 1].year === nowYear) {
    points[points.length - 1].total = total;
  } else {
    points.push({ year: nowYear, total });
  }

  // The dashed "supposed predictability" line runs from today's point
  // straight to the 1,000,000 mark on the ETA date, per the same pace
  // used for the headline date above.
  const projectionEnd = etaDate
    ? { year: etaDate.getFullYear() + etaDate.getMonth() / 12, total: COUNTER_MAX }
    : null;

  const years = points.map((p) => p.year).concat(projectionEnd ? [projectionEnd.year] : []);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const maxTotal = COUNTER_MAX;

  const width = 300;
  const height = 150;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const xFor = (year) => padL + ((year - minYear) / (maxYear - minYear || 1)) * innerW;
  const yFor = (val) => padT + innerH - (Math.min(val, maxTotal) / maxTotal) * innerH;

  const solidPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.year).toFixed(1)},${yFor(p.total).toFixed(1)}`)
    .join(" ");

  const last = points[points.length - 1];
  const dashedPath = projectionEnd
    ? `M${xFor(last.year).toFixed(1)},${yFor(last.total).toFixed(1)} L${xFor(projectionEnd.year).toFixed(1)},${yFor(projectionEnd.total).toFixed(1)}`
    : "";

  const yTicks = [0, 250000, 500000, 750000, 1000000];
  const gridLines = yTicks
    .map((t) => {
      const y = yFor(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="stats-eta-chart-grid" />`;
    })
    .join("");
  const yLabels = yTicks
    .map((t) => {
      const y = yFor(t).toFixed(1);
      const label = t === 0 ? "0" : t >= 1000000 ? "1M" : `${Math.round(t / 1000)}k`;
      return `<text x="${padL - 6}" y="${y}" class="stats-eta-chart-ylabel" text-anchor="end" dominant-baseline="middle">${label}</text>`;
    })
    .join("");

  const xLabelYears = Array.from(
    new Set([minYear, nowYear, projectionEnd ? Math.round(projectionEnd.year) : null].filter((y) => y !== null && y !== undefined))
  );
  const xLabels = xLabelYears
    .map((year) => {
      const x = xFor(year).toFixed(1);
      return `<text x="${x}" y="${height - 4}" class="stats-eta-chart-xlabel" text-anchor="middle">${year}</text>`;
    })
    .join("");

  const nowDot = `<circle cx="${xFor(last.year).toFixed(1)}" cy="${yFor(last.total).toFixed(1)}" r="3" class="stats-eta-chart-dot" />`;
  const goalDot = projectionEnd
    ? `<circle cx="${xFor(projectionEnd.year).toFixed(1)}" cy="${yFor(projectionEnd.total).toFixed(1)}" r="3" class="stats-eta-chart-goal-dot" />`
    : "";

  statsEtaChartEl.innerHTML = `
    ${gridLines}
    <path d="${solidPath}" class="stats-eta-chart-line" fill="none" />
    ${dashedPath ? `<path d="${dashedPath}" class="stats-eta-chart-projection" fill="none" stroke-dasharray="4 4" />` : ""}
    ${nowDot}
    ${goalDot}
    ${yLabels}
    ${xLabels}
  `;
}

async function loadWorldStats() {
  statsTotalEl.textContent = "–";
  statsTodayEl.textContent = "–";
  statsRatingEl.textContent = "–";
  statsPriceEl.textContent = "–";
  statsStatusEl.hidden = true;
  if (statsEtaValueEl) statsEtaValueEl.textContent = "Calculating…";
  if (statsEtaCaptionEl) statsEtaCaptionEl.textContent = "Estimated date of the 1,000,000th beer";

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
    updateStatsEtaCard(total, loggedToday, rows);
  } catch (err) {
    console.error("Failed to load worldwide stats:", err);
    statsStatusEl.hidden = false;
    statsStatusEl.classList.add("field-hint-error");
    statsStatusEl.textContent = "Couldn't load stats — try again.";
    if (statsEtaValueEl) statsEtaValueEl.textContent = "–";
    if (statsEtaCaptionEl) statsEtaCaptionEl.textContent = "Estimated date of the 1,000,000th beer";
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
    .select("id, username")
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
      emoji: "🍺",
      count,
      isYou: Boolean(currentUser && currentUser.id === id),
    };
  });
}

async function computeVenuesLeaderboard(cutoffIso) {
  let query = supabaseClient.from("beer_entries").select("venue_id, created_at").not("venue_id", "is", null);
  if (cutoffIso) query = query.gte("created_at", cutoffIso);
  const { data, error } = await query;
  if (error) throw error;

  const tally = {};
  (data || []).forEach((row) => {
    tally[row.venue_id] = (tally[row.venue_id] || 0) + 1;
  });
  const top = topTallyEntries(tally, LEADERBOARD_TOP_N);
  if (!top.length) return [];

  const ids = top.map(([id]) => id);
  const { data: venues, error: venuesError } = await supabaseClient
    .from("venues")
    .select("id, name")
    .in("id", ids);
  if (venuesError) throw venuesError;

  const venueById = {};
  (venues || []).forEach((v) => {
    venueById[v.id] = v;
  });

  return top.map(([id, count]) => ({
    name: (venueById[id] && venueById[id].name) || "Unknown bar",
    count,
  }));
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
 *  each one. Bars are grouped by beer_entries.venue_id (resolved to a
 *  venue name via the venues table); countries
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
  setScheduleButtonVisible(false);
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
  setScheduleButtonVisible(true);
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
document.getElementById("battlefield-back-btn").addEventListener("click", () => {
  closeBattlefieldSheet();
  setActiveMenuIcon("home");
});

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

// Tallies venue claims (one entry per distinct venue, keyed by
// venue_id rather than the free-text bar name), each carrying
// whichever user logged the most beers there and that winning count.
function tallyBarClaims(rows) {
  const byVenue = {}; // venue_id -> { userId -> count }
  rows.forEach((row) => {
    if (!row.venue_id || !row.user_id) return;
    if (!byVenue[row.venue_id]) byVenue[row.venue_id] = {};
    byVenue[row.venue_id][row.user_id] = (byVenue[row.venue_id][row.user_id] || 0) + 1;
  });

  return Object.entries(byVenue).map(([venueId, byUser]) => {
    const [claimantId, count] = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0];
    return { type: "bar", venueId, claimantId, count };
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
    const { data, error } = await supabaseClient.from("beer_entries").select("user_id, venue_id, bar_lat, bar_lng");
    if (error) throw error;
    const rows = data || [];

    const barClaims = tallyBarClaims(rows);
    const countryClaims = await tallyCountryClaims(rows);
    if (requestId !== battlefieldRequestId) return; // superseded by a later open

    const venueIds = Array.from(new Set(barClaims.map((c) => c.venueId)));
    const venueById = {};
    if (venueIds.length) {
      const { data: venues, error: venuesError } = await supabaseClient
        .from("venues")
        .select("id, name")
        .in("id", venueIds);
      if (venuesError) throw venuesError;
      (venues || []).forEach((v) => {
        venueById[v.id] = v;
      });
    }

    const resolvedBarClaims = barClaims.map((c) => ({
      type: c.type,
      name: (venueById[c.venueId] && venueById[c.venueId].name) || "Unknown bar",
      claimantId: c.claimantId,
      count: c.count,
    }));

    const allClaims = [...countryClaims, ...resolvedBarClaims].sort((a, b) => b.count - a.count);

    const claimantIds = Array.from(new Set(allClaims.map((c) => c.claimantId)));
    const profileById = {};
    if (claimantIds.length) {
      const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("id, username")
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
        claimantEmoji: "🍺",
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
