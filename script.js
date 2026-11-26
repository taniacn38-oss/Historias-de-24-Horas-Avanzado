const STORAGE_KEY = "stories_24h_data_v1";

// Duración de vida de la historia: 24 horas en milisegundos.
// Para probar la expiración rápida, cambia temporalmente a por ejemplo: 15 * 1000 (15 segundos).
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Duración de cada historia en el visor
const STORY_DURATION_MS = 3000;

// Dimensiones máximas permitidas
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;

// Intervalo de limpieza automática en segundo plano (cada 10 segundos)
const CLEANUP_INTERVAL_MS = 10000;

const addStoryBtn = document.getElementById("add-story-btn");
const fileInput = document.getElementById("story-file-input");
const storiesListEl = document.getElementById("stories-list");
const emptyStateEl = document.getElementById("empty-state");

const viewerEl = document.getElementById("story-viewer");
const progressBarsEl = document.getElementById("progress-bars");
const viewerTimerInfoEl = document.getElementById("viewer-timer-info");
const closeViewerBtn = document.getElementById("close-viewer-btn");
const swipeAreaEl = document.getElementById("swipe-area");
const viewerImageEl = document.getElementById("viewer-image");
const prevStoryBtn = document.getElementById("prev-story-btn");
const nextStoryBtn = document.getElementById("next-story-btn");

let stories = [];
let activeIndex = 0;
let rafId = null;
let storyStartTime = 0;
let pointerStartX = null;

function readRawStories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStories(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    alert(
      "No se pudo guardar en localStorage (posible límite de espacio alcanzado). Intenta con otra imagen.",
    );
  }
}

// Elimina historias vencidas según expiresAt
function purgeExpiredStories() {
  const now = Date.now();
  const currentList = readRawStories();
  const validStories = currentList.filter(
    (item) =>
      item && typeof item.expiresAt === "number" && item.expiresAt > now,
  );

  if (validStories.length !== currentList.length) {
    saveStories(validStories);
  }

  stories = validStories;
  renderStoriesBar();

  // Si el visor está abierto y la historia activa ya expiró
  if (!viewerEl.classList.contains("hidden")) {
    if (stories.length === 0) {
      closeViewer();
    } else if (activeIndex >= stories.length) {
      openStoryAt(stories.length - 1);
    }
  }
}

function formatRemainingTime(expiresAt) {
  const diffMs = Math.max(0, expiresAt - Date.now());
  const totalSec = Math.ceil(diffMs / 1000);
  if (totalSec < 60) return `Expira en ${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `Expira en ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `Expira en ${hrs}h`;
}

function renderStoriesBar() {
  storiesListEl.innerHTML = "";
  emptyStateEl.classList.toggle("hidden", stories.length > 0);

  stories.forEach((story, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "story-item";
    btn.setAttribute("aria-label", `Ver historia ${index + 1}`);

    const ring = document.createElement("div");
    ring.className = "story-ring";

    const img = document.createElement("img");
    img.className = "story-thumb";
    img.src = story.imageBase64;
    img.alt = `Historia ${index + 1}`;

    const label = document.createElement("span");
    label.className = "story-label";
    label.textContent = `Historia ${index + 1}`;

    ring.appendChild(img);
    btn.appendChild(ring);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      purgeExpiredStories();
      if (stories[index]) {
        openViewer(index);
      }
    });

    storiesListEl.appendChild(btn);
  });
}

// Convierte un archivo de imagen a Base64 limitando dimensiones a máx. 1080x1920 px
function fileToConstrainedBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Error al leer el archivo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(new Error("El archivo no es una imagen válida."));
      img.onload = () => {
        const scale = Math.min(
          1,
          MAX_WIDTH / img.width,
          MAX_HEIGHT / img.height,
        );
        const targetWidth = Math.max(1, Math.round(img.width * scale));
        const targetHeight = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const base64 =
          mimeType === "image/jpeg"
            ? canvas.toDataURL("image/jpeg", 0.85)
            : canvas.toDataURL("image/png");

        resolve(base64);
      };
      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function stopProgressLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function buildProgressBars() {
  progressBarsEl.innerHTML = "";
  stories.forEach((_, idx) => {
    const track = document.createElement("div");
    track.className = "progress-track";
    if (idx < activeIndex) {
      track.classList.add("done");
    }

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    if (idx < activeIndex) {
      fill.style.width = "100%";
    }

    track.appendChild(fill);
    progressBarsEl.appendChild(track);
  });
}

function startStoryTimer() {
  stopProgressLoop();
  storyStartTime = performance.now();

  const tracks = progressBarsEl.querySelectorAll(".progress-track");
  const currentFill = tracks[activeIndex]?.querySelector(".progress-fill");

  function step(now) {
    purgeExpiredStories();
    if (!stories[activeIndex]) return;

    viewerTimerInfoEl.textContent = formatRemainingTime(
      stories[activeIndex].expiresAt,
    );

    const elapsed = now - storyStartTime;
    const progress = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);

    if (currentFill) {
      currentFill.style.width = `${progress}%`;
    }

    if (elapsed >= STORY_DURATION_MS) {
      if (activeIndex + 1 < stories.length) {
        openStoryAt(activeIndex + 1);
      } else {
        closeViewer();
      }
      return;
    }

    rafId = requestAnimationFrame(step);
  }

  rafId = requestAnimationFrame(step);
}

function openStoryAt(index) {
  if (index < 0 || index >= stories.length) {
    closeViewer();
    return;
  }

  activeIndex = index;
  const story = stories[activeIndex];
  viewerImageEl.src = story.imageBase64;
  viewerTimerInfoEl.textContent = formatRemainingTime(story.expiresAt);
  buildProgressBars();
  startStoryTimer();
}

function openViewer(index) {
  viewerEl.classList.remove("hidden");
  openStoryAt(index);
}

function closeViewer() {
  stopProgressLoop();
  viewerEl.classList.add("hidden");
  viewerImageEl.src = "";
}

addStoryBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const base64 = await fileToConstrainedBase64(file);
    const now = Date.now();
    const newStory = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      imageBase64: base64,
      createdAt: now,
      expiresAt: now + STORY_LIFETIME_MS,
    };

    purgeExpiredStories();
    stories.push(newStory);
    saveStories(stories);
    renderStoriesBar();
  } catch (err) {
    alert(err.message || "No se pudo cargar la imagen.");
  }
});

closeViewerBtn.addEventListener("click", closeViewer);

prevStoryBtn.addEventListener("click", () => {
  if (activeIndex > 0) {
    openStoryAt(activeIndex - 1);
  } else {
    openStoryAt(0);
  }
});

nextStoryBtn.addEventListener("click", () => {
  if (activeIndex + 1 < stories.length) {
    openStoryAt(activeIndex + 1);
  } else {
    closeViewer();
  }
});

// Soporte para swipe (táctil y arrastre con mouse)
swipeAreaEl.addEventListener("pointerdown", (e) => {
  pointerStartX = e.clientX;
});

swipeAreaEl.addEventListener("pointerup", (e) => {
  if (pointerStartX === null) return;
  const deltaX = e.clientX - pointerStartX;
  pointerStartX = null;

  const SWIPE_THRESHOLD = 45;
  if (deltaX <= -SWIPE_THRESHOLD) {
    // Deslizar a la izquierda -> siguiente historia
    if (activeIndex + 1 < stories.length) {
      openStoryAt(activeIndex + 1);
    } else {
      closeViewer();
    }
  } else if (deltaX >= SWIPE_THRESHOLD) {
    // Deslizar a la derecha -> historia anterior
    if (activeIndex > 0) {
      openStoryAt(activeIndex - 1);
    }
  }
});

// Inicialización y limpieza periódica
purgeExpiredStories();
setInterval(purgeExpiredStories, CLEANUP_INTERVAL_MS);
