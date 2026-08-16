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

function getBeerCount() {
  const stored = parseInt(localStorage.getItem(COUNTER_STORAGE_KEY), 10);
  return Number.isFinite(stored) ? Math.min(stored, COUNTER_MAX) : 0;
}

function setBeerCount(value) {
  const clamped = Math.min(Math.max(0, value), COUNTER_MAX);
  localStorage.setItem(COUNTER_STORAGE_KEY, String(clamped));
  return clamped;
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
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// On load, animate up from 0 to whatever this user has already logged.
animateBeerCounter(0, getBeerCount(), COUNTER_LOAD_DURATION_MS);

// Call this whenever a beer is successfully saved.
function incrementBeerCounter() {
  const before = getBeerCount();
  const after = setBeerCount(before + 1);
  if (after !== before) {
    animateBeerCounter(before, after, COUNTER_INCREMENT_DURATION_MS);
  }
}

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

// Renders every beer this user has already logged, from localStorage.
function initBeerLights() {
  beerLights = getStoredBeerLightLocations().map(({ lat, lng }) => createBeerLightMarker(lat, lng));
  updateBeerLightFade();
}

// Called right after a beer is saved: persists the spot and drops a
// new light there immediately.
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
 *  "Add my beer" flow: camera -> confirm -> drawer (nearby bar,
 *  beer, price, rating — every field optional).
 * ---------------------------------------------------------------- */

const addBeerBtn = document.getElementById("add-beer-btn");
const beerPhotoInput = document.getElementById("beer-photo-input");
const photoConfirmBackdrop = document.getElementById("photo-confirm-backdrop");
const photoConfirm = document.getElementById("photo-confirm");
const photoConfirmImg = document.getElementById("photo-confirm-img");
const photoRetakeBtn = document.getElementById("photo-retake-btn");
const photoUseBtn = document.getElementById("photo-use-btn");

const sheetBackdrop = document.getElementById("sheet-backdrop");
const beerSheet = document.getElementById("beer-sheet");
const sheetCloseBtn = document.getElementById("sheet-close-btn");
const beerForm = document.getElementById("beer-form");
const beerPhotoThumb = document.getElementById("beer-photo-thumb");

const barChipRow = document.getElementById("bar-chip-row");
const barSearch = document.getElementById("bar-search");
const barSearchInput = document.getElementById("bar-search-input");
const barSearchResults = document.getElementById("bar-search-results");
const nearbyOptionalTag = document.getElementById("nearby-optional-tag");
const barRequiredHint = document.getElementById("bar-required-hint");

const beerChipRow = document.getElementById("beer-chip-row");
const beerSearch = document.getElementById("beer-search");
const beerSearchInput = document.getElementById("beer-search-input");
const beerSearchResults = document.getElementById("beer-search-results");

const priceCarousel = document.getElementById("price-carousel");

const starButtons = Array.from(document.querySelectorAll(".star"));
const saveBeerBtn = document.getElementById("save-beer-btn");

let currentRating = 0;
let capturedPhotoDataUrl = null;

/* ---------------------------------------------------------------- *
 *  Step 1: tapping the CTA opens the camera directly (via a hidden
 *  file input with capture="environment") instead of the drawer.
 * ---------------------------------------------------------------- */

addBeerBtn.addEventListener("click", () => {
  // Reset the input first so choosing/retaking the "same" photo twice
  // in a row still fires a change event.
  beerPhotoInput.value = "";
  beerPhotoInput.click();
});

beerPhotoInput.addEventListener("change", () => {
  const file = beerPhotoInput.files && beerPhotoInput.files[0];
  if (!file) return; // user cancelled the camera/picker

  const reader = new FileReader();
  reader.onload = () => {
    photoConfirmImg.src = reader.result;
    openPhotoConfirm();
  };
  reader.readAsDataURL(file);
});

/* ---------------------------------------------------------------- *
 *  Step 2: "Is this photo good?" confirm screen.
 * ---------------------------------------------------------------- */

function openPhotoConfirm() {
  photoConfirmBackdrop.hidden = false;
  photoConfirm.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      photoConfirmBackdrop.classList.add("is-open");
      photoConfirm.classList.add("is-open");
    });
  });
}

function closePhotoConfirm() {
  photoConfirmBackdrop.classList.remove("is-open");
  photoConfirm.classList.remove("is-open");
  const onTransitionEnd = () => {
    photoConfirmBackdrop.hidden = true;
    photoConfirm.hidden = true;
    photoConfirm.removeEventListener("transitionend", onTransitionEnd);
  };
  photoConfirm.addEventListener("transitionend", onTransitionEnd);
}

photoRetakeBtn.addEventListener("click", () => {
  closePhotoConfirm();
  // Give the confirm card's close transition a beat before relaunching
  // the camera so the two overlays don't visibly overlap.
  setTimeout(() => {
    beerPhotoInput.value = "";
    beerPhotoInput.click();
  }, 300);
});

// Tapping outside the confirm card cancels the whole flow (no photo
// kept, drawer never opens) rather than silently accepting it.
photoConfirmBackdrop.addEventListener("click", () => {
  capturedPhotoDataUrl = null;
  closePhotoConfirm();
});

photoUseBtn.addEventListener("click", () => {
  capturedPhotoDataUrl = photoConfirmImg.src;
  closePhotoConfirm();
  // Same beat as retake, so the drawer's slide-up isn't fighting the
  // confirm card's fade-out.
  setTimeout(openBeerSheet, 300);
});

/* ---------------------------------------------------------------- *
 *  Step 3: the drawer itself.
 * ---------------------------------------------------------------- */

function openBeerSheet() {
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
  renderBarChips();
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

sheetCloseBtn.addEventListener("click", closeBeerSheet);
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
 *  Nearby: with location access, the closest 2 bars/pubs (Overpass,
 *  narrow radius) show as chips, plus "Other…" for a wider search
 *  that also covers restaurants and clubs. Without location access,
 *  a bar/pub is required, and the search box (live text search
 *  against OpenStreetMap by name) is shown directly instead of chips.
 * ---------------------------------------------------------------- */

let userLat = null;
let userLng = null;
let locationStatus = "pending"; // "pending" | "granted" | "denied"
let nearbyBars = []; // [{ name, lat, lon }], closest bar/pub only
let barCandidates = null; // wider bar/pub/restaurant/club list, fetched lazily
let selectedBarName = null;
let selectedBarIsOther = false;
let selectedBarLat = null;
let selectedBarLng = null;
let barTextSearchTimer = null;

function resetBarState() {
  userLat = null;
  userLng = null;
  locationStatus = "pending";
  nearbyBars = [];
  barCandidates = null;
  selectedBarName = null;
  selectedBarIsOther = false;
  selectedBarLat = null;
  selectedBarLng = null;
  clearTimeout(barTextSearchTimer);
  barSearchInput.value = "";
  barSearch.hidden = true;
  barSearchResults.innerHTML = "";
  barRequiredHint.hidden = true;
  barRequiredHint.classList.remove("field-hint-error");
  nearbyOptionalTag.textContent = "(optional)";
}

function locateUserForBars() {
  if (!navigator.geolocation) {
    locationStatus = "denied";
    renderBarChips();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      locationStatus = "granted";
      try {
        nearbyBars = await fetchNearbyPlaces(userLat, userLng, "^(bar|pub)$", 500, 2);
      } catch (err) {
        console.error("Nearby bar lookup failed:", err);
      }
      renderBarChips();
    },
    () => {
      locationStatus = "denied";
      renderBarChips();
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function renderBarChips() {
  if (locationStatus === "denied") {
    // No location to base "nearby" on: skip chips entirely and make
    // the search box itself the (now required) field.
    barChipRow.hidden = true;
    barChipRow.innerHTML = "";
    barSearch.hidden = false;
    nearbyOptionalTag.textContent = "(required — location is off)";
    updateBarRequiredHint();
    return;
  }

  barChipRow.hidden = false;
  nearbyOptionalTag.textContent = "(optional)";
  barChipRow.innerHTML = "";

  if (locationStatus === "pending") {
    const loading = createChip("Finding nearby spots…", false);
    loading.disabled = true;
    loading.classList.add("chip-loading");
    barChipRow.appendChild(loading);
  }

  nearbyBars.forEach((bar) => {
    const chip = createChip(bar.name, !selectedBarIsOther && selectedBarName === bar.name);
    chip.addEventListener("click", () => selectBar(bar.name, false, bar.lat, bar.lon));
    barChipRow.appendChild(chip);
  });

  const otherLabel = selectedBarIsOther && selectedBarName ? selectedBarName : "Other…";
  const otherChip = createChip(otherLabel, selectedBarIsOther);
  otherChip.classList.add("chip-other");
  otherChip.addEventListener("click", toggleBarSearch);
  barChipRow.appendChild(otherChip);
}

function selectBar(name, isOther, lat = null, lon = null) {
  selectedBarName = name;
  selectedBarIsOther = isOther;
  selectedBarLat = lat;
  selectedBarLng = lon;
  if (locationStatus === "denied") {
    barSearchInput.value = name;
    barSearchResults.innerHTML = "";
    updateBarRequiredHint();
  } else {
    barSearch.hidden = true;
    renderBarChips();
  }
}

// Message under the search box in the required (location-denied)
// state: shows what's currently entered, or the requirement, or a
// validation error once the user's tried to save without one.
function updateBarRequiredHint() {
  if (locationStatus !== "denied") return;
  barRequiredHint.hidden = false;
  barRequiredHint.classList.remove("field-hint-error");
  barRequiredHint.textContent = selectedBarName
    ? `Selected: ${selectedBarName}`
    : "Location is off — search for your bar or pub to continue.";
}

async function toggleBarSearch() {
  const opening = barSearch.hidden;
  barSearch.hidden = !opening;
  if (!opening) return;

  barSearchInput.focus();
  renderBarSearchResults("");

  if (!barCandidates && userLat !== null) {
    barSearchResults.innerHTML = '<li class="search-hint">Loading nearby places…</li>';
    try {
      barCandidates = await fetchNearbyPlaces(userLat, userLng, "^(bar|pub|restaurant|nightclub)$", 1500, 40);
    } catch (err) {
      console.error("Nearby place search failed:", err);
      barCandidates = [];
    }
    renderBarSearchResults(barSearchInput.value);
  }
}

barSearchInput.addEventListener("input", () => {
  const value = barSearchInput.value;
  if (locationStatus === "denied") {
    // Every keystroke counts as the entered name, so simply typing
    // (without picking a suggestion) still satisfies the requirement.
    selectedBarName = value.trim() || null;
    selectedBarIsOther = true;
    selectedBarLat = null;
    selectedBarLng = null;
    updateBarRequiredHint();
    debounceBarTextSearch(value);
  } else {
    renderBarSearchResults(value);
  }
});

// Location-granted "Other…" search: filters the wider candidate list
// already fetched for this session — no network call per keystroke.
function renderBarSearchResults(query) {
  const q = query.trim().toLowerCase();
  barSearchResults.innerHTML = "";

  if (barCandidates === null) {
    barSearchResults.innerHTML = userLat === null
      ? '<li class="search-hint">Enable location to see nearby places, or just type a name below.</li>'
      : '<li class="search-hint">Loading nearby places…</li>';
  }

  if (q) {
    const useCustom = document.createElement("li");
    useCustom.className = "search-result search-result-custom";
    useCustom.textContent = `Use “${query.trim()}”`;
    useCustom.addEventListener("click", () => selectBar(query.trim(), true));
    barSearchResults.appendChild(useCustom);
  }

  const matches = (barCandidates || [])
    .filter((place) => !q || place.name.toLowerCase().includes(q))
    .slice(0, 8);

  matches.forEach((place) => {
    const li = document.createElement("li");
    li.className = "search-result";
    li.textContent = place.name;
    li.addEventListener("click", () => selectBar(place.name, true, place.lat, place.lon));
    barSearchResults.appendChild(li);
  });
}

// Location-denied required search: no coordinates to search around,
// so this looks places up by name via Nominatim instead, debounced
// so it's one request per pause in typing, not per keystroke.
function debounceBarTextSearch(query) {
  clearTimeout(barTextSearchTimer);
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    barSearchResults.innerHTML = "";
    return;
  }
  barSearchResults.innerHTML = '<li class="search-hint">Searching…</li>';
  barTextSearchTimer = setTimeout(async () => {
    try {
      const matches = await fetchPlacesByName(trimmed);
      renderBarTextSearchResults(matches);
    } catch (err) {
      console.error("Bar name search failed:", err);
      barSearchResults.innerHTML = '<li class="search-hint">Search failed — what you typed will still be used.</li>';
    }
  }, 400);
}

function renderBarTextSearchResults(matches) {
  barSearchResults.innerHTML = "";
  if (matches.length === 0) {
    barSearchResults.innerHTML = '<li class="search-hint">No matches — what you typed will still be used.</li>';
    return;
  }
  matches.slice(0, 8).forEach((place) => {
    const li = document.createElement("li");
    li.className = "search-result";
    li.textContent = place.name;
    li.addEventListener("click", () => selectBar(place.name, true, place.lat, place.lon));
    barSearchResults.appendChild(li);
  });
}

// Amenity types we treat as "a place you could have a beer" — used to
// filter both the Nominatim (location-off) and Overpass (location-on)
// results. Kept a little wider than just bar/pub so a real-world venue
// (a cafe that also serves beer, a biergarten, a food-hall stall) isn't
// silently dropped from the dropdown.
const DRINK_VENUE_TYPES = [
  "bar", "pub", "restaurant", "nightclub", "biergarten", "cafe", "food_court", "pub;bar",
];

// Free-text place search (no proximity bias, no radius — there's no
// location to search around), used only when location access was
// denied. Nominatim, same free OpenStreetMap data as the rest of the
// app; results are filtered down to bar/pub-like venues.
async function fetchPlacesByName(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=0&namedetails=1&limit=15`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter((r) => DRINK_VENUE_TYPES.includes(r.type))
    .map((r) => ({
      name: (r.namedetails && r.namedetails.name) || r.display_name.split(",")[0],
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
}

// A couple of public Overpass mirrors, tried in order — overpass-api.de
// alone has been known to reject/CORS-fail browser requests outright,
// so a fallback keeps "nearby bars" working even when the primary is
// down or blocking us.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// Shared Overpass helper: nodes matching an amenity regex within
// radiusMeters of (lat, lon), named, sorted by distance, capped at
// `limit`. Free, no-API-key OpenStreetMap data — same source as the
// map tiles.
//
// The query is sent as a proper `application/x-www-form-urlencoded`
// body (data=<query>) rather than a raw text body: Overpass's public
// endpoints are picky about this and will hand back a 406 with no
// CORS header at all for a plain-text POST, which the browser then
// reports as an opaque "Failed to fetch"/CORS error rather than the
// real 406. Encoding it properly avoids that, and trying the mirrors
// below covers the rest.
async function fetchNearbyPlaces(lat, lon, amenityRegex, radiusMeters, limit) {
  const query = `[out:json][timeout:8];node(around:${radiusMeters},${lat},${lon})[amenity~"${amenityRegex}"];out;`;
  const body = new URLSearchParams({ data: query });

  let data = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", body });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch (err) {
      // Try the next mirror.
      continue;
    }
  }
  if (!data) return [];

  return (data.elements || [])
    .filter((el) => el.tags && el.tags.name)
    .map((el) => ({
      name: el.tags.name,
      lat: el.lat,
      lon: el.lon,
      distance: angularDistanceDeg(lat, lon, el.lat, el.lon),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
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

beerForm.addEventListener("submit", (e) => {
  e.preventDefault();

  // The only field that isn't optional: without location access we
  // have no other way to know where this beer was had.
  if (locationStatus === "denied" && !selectedBarName) {
    barRequiredHint.hidden = false;
    barRequiredHint.classList.add("field-hint-error");
    barRequiredHint.textContent = "Please enter a bar or pub to continue.";
    barSearchInput.focus();
    return;
  }

  const entry = {
    photo: capturedPhotoDataUrl, // null if the user skipped/cancelled the camera step
    barName: selectedBarName,
    beerName: selectedBeerName,
    price: selectedPrice, // null if untouched
    rating: currentRating, // 0 means "no rating given"
  };
  // No backend wired up yet — this is where a save request would go.
  console.log("New beer entry:", entry);
  recordBeerName(selectedBeerName);
  const lightLat = userLat !== null ? userLat : selectedBarLat;
  const lightLng = userLng !== null ? userLng : selectedBarLng;
  if (lightLat !== null && lightLng !== null) {
    addBeerLight(lightLat, lightLng);
  }
  incrementBeerCounter();
  closeBeerSheet();
  resetBeerForm();
});
